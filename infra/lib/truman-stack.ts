import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ArnFormat,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Tags,
} from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as alarmActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sns from "aws-cdk-lib/aws-sns";
import { IgnoreMode } from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import type { Stage } from "./stages.ts";

/**
 * CloudFront's addresses, as a list AWS maintains, for one region. It's written here so that
 * building this needs no call to AWS. A wrong ID fails the deployment, rather than opening anything.
 */
const CLOUDFRONT_PREFIX_LISTS: Record<string, string> = { "us-east-1": "pl-3b927c52" };

/**
 * What CloudFront records about a request. It's a list of what's in, so nothing new appears by
 * itself. Left out on purpose: the query (study links carry recruitment IDs), the path (it can hold
 * a username), the viewer's address (no addresses unless a study opts in), the referrer (it's a
 * whole study link), and cookies. Logs can't be cleaned when someone withdraws.
 */
export const EDGE_LOG_FIELDS = [
  "date",
  "time",
  "x-edge-location",
  "cs-method",
  "sc-status",
  "sc-bytes",
  "cs-bytes",
  "time-taken",
  "time-to-first-byte",
  "x-edge-result-type",
  "x-edge-response-result-type",
  "x-edge-detailed-result-type",
  "sc-content-type",
  "cache-behavior-path-pattern",
];

/** These don't need escaping in a database address, so a password can go straight into one. */
const NOT_SAFE_IN_ADDRESS = " !\"#$%&'()*+,/:;<=>?@[\\]^`{|}~";

/** The database's name, and its two logins (ADR 21). */
const DATABASE_NAME = "truman";
const APP_LOGIN = "truman_app";
const OWNER_LOGIN = "truman_owner";
const API_PORT = 3000;

export interface TrumanStackProps extends StackProps {
  stage: Stage;
  /** Where the Dockerfile is. */
  imageDirectory: string;
  /** The apps' built files. */
  participantDist: string;
  adminDist: string;
  /** The public site's built files. Needed when the stage has a `site`. */
  siteDist?: string;
}

/** One deployment of Truman. See docs/guides/deploying.md and ADR 23. */
/** The CloudFront router, with the stage's participant domains written in (ADR 74). */
export function routerCode(participantHosts: string[]) {
  const code = readFileSync(path.join(import.meta.dirname, "app-router.js"), "utf8");
  const line = "var PARTICIPANT_HOSTS = [];";
  if (!code.includes(line)) {
    throw new Error(`app-router.js has to have the line ${line}`);
  }
  return code.replace(line, `var PARTICIPANT_HOSTS = ${JSON.stringify(participantHosts)};`);
}

export class TrumanStack extends Stack {
  private readonly zones: string[];

  /** CDK would otherwise ask AWS for these, and building this should ask AWS nothing. */
  override get availabilityZones(): string[] {
    return this.zones;
  }

  constructor(scope: Construct, id: string, props: TrumanStackProps) {
    const { stage } = props;
    const prefix = `truman3-${stage.name}`;
    super(scope, id, {
      ...props,
      stackName: prefix,
      description: stage.holdsRealData
        ? `Truman 3 ${stage.name}. Holds real participants' data.`
        : `Truman 3 ${stage.name}. For testing. No real participants.`,
      terminationProtection: stage.holdsRealData,
    });

    this.zones = stage.availabilityZones;

    Tags.of(this).add("Project", "truman3");
    Tags.of(this).add("Stage", stage.name);
    Tags.of(this).add("RealParticipants", stage.holdsRealData ? "yes" : "no");

    /** Whether something that holds data survives being removed from here. */
    const removalPolicy = stage.holdsRealData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // The network. There's no NAT gateway, which would cost more than the API does: the API sits in
    // a public subnet so it can reach AWS and Prolific, and its firewall lets in only the load
    // balancer. The load balancer and database have no route to the internet at all.
    const vpc = new ec2.Vpc(this, "Network", {
      availabilityZones: stage.availabilityZones,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    const privateSubnets = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED };
    const publicSubnets = { subnetType: ec2.SubnetType.PUBLIC };

    // Secrets. Each of these goes to a container by reference, and never as a plain setting.
    const appPassword = new secrets.Secret(this, "AppDatabasePassword", {
      secretName: `${prefix}/database-app-password`,
      description: `The password for ${APP_LOGIN}, the database login the API uses.`,
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
      removalPolicy,
    });
    // 43 of these characters read as base64 make the 32 bytes TRUMAN_SECRET_KEY has to be.
    const secretKey = new secrets.Secret(this, "SecretKey", {
      secretName: `${prefix}/truman-secret-key`,
      description: "TRUMAN_SECRET_KEY, which encrypts researchers' Prolific tokens.",
      generateSecretString: { excludePunctuation: true, passwordLength: 43 },
      removalPolicy,
    });

    // What AWS sends with each report that a lab's key was used or changed, so nobody else can
    // send one (ADR 83).
    const keyEventsHookKey = stage.hosted
      ? new secrets.Secret(this, "KeyEventsHookKey", {
          secretName: `${prefix}/key-events-hook-key`,
          description: "Sent with reports to the API that a lab's key was used or changed.",
          generateSecretString: { excludePunctuation: true, passwordLength: 48 },
          removalPolicy,
        })
      : undefined;

    const ownerSecret = new rds.DatabaseSecret(this, "OwnerDatabaseLogin", {
      secretName: `${prefix}/database-owner`,
      username: OWNER_LOGIN,
      excludeCharacters: NOT_SAFE_IN_ADDRESS,
    });
    // A kept database is no use without the password that opens it.
    ownerSecret.applyRemovalPolicy(removalPolicy);

    const tasksFirewall = new ec2.SecurityGroup(this, "ApiFirewall", {
      vpc,
      description: "API containers and one-off tasks. Only the load balancer gets in.",
    });

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_18 }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        stage.databaseSize === "small" ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: privateSubnets,
      publiclyAccessible: false,
      multiAz: false,
      databaseName: DATABASE_NAME,
      credentials: rds.Credentials.fromSecret(ownerSecret),
      storageEncrypted: true,
      storageType: rds.StorageType.GP3,
      allocatedStorage: stage.databaseStorageGb,
      backupRetention: Duration.days(stage.backupDays),
      deletionProtection: stage.holdsRealData,
      removalPolicy,
      deleteAutomatedBackups: !stage.holdsRealData,
    });
    database.connections.allowDefaultPortFrom(tasksFirewall, "From the API and one-off tasks");

    // Files. Neither bucket can be read directly, only through CloudFront below.
    const bucketDefaults = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    };
    const appsBucket = new s3.Bucket(this, "Apps", {
      ...bucketDefaults,
      // Only built files are here, and a deployment puts them back.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const mediaBucket = new s3.Bucket(this, "Media", {
      ...bucketDefaults,
      versioned: stage.holdsRealData,
      // A deleted file stays as an old version, which would outlast a withdrawal.
      ...(stage.holdsRealData
        ? { lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(7) }] }
        : {}),
      removalPolicy,
      autoDeleteObjects: !stage.holdsRealData,
    });

    // The load balancer has no public address. CloudFront reaches it from inside the network.
    const balancerFirewall = new ec2.SecurityGroup(this, "BalancerFirewall", {
      vpc,
      description: "The load balancer for the API. Only CloudFront gets in.",
      allowAllOutbound: false,
    });
    const prefixList = CLOUDFRONT_PREFIX_LISTS[stage.region];
    if (!prefixList) {
      throw new Error(`Add CloudFront's prefix list for ${stage.region} to truman-stack.ts.`);
    }
    balancerFirewall.addIngressRule(
      ec2.Peer.prefixList(prefixList),
      ec2.Port.tcp(80),
      "From CloudFront",
    );
    const balancer = new elb.ApplicationLoadBalancer(this, "Balancer", {
      vpc,
      vpcSubnets: privateSubnets,
      internetFacing: false,
      securityGroup: balancerFirewall,
      dropInvalidHeaderFields: true,
    });

    // CloudFront is the one way in, and it holds the apps, the API, and media at one address.
    const allOrigins = {
      apps: origins.S3BucketOrigin.withOriginAccessControl(appsBucket),
      // Imported, so CloudFront's automatic grant doesn't cover the whole bucket. It gets media/* below,
      // and never uploads/, which only the API reads. See ADR 25.
      media: origins.S3BucketOrigin.withOriginAccessControl(
        s3.Bucket.fromBucketName(this, "MediaForEdge", mediaBucket.bucketName),
      ),
      api: origins.VpcOrigin.withApplicationLoadBalancer(balancer, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        httpPort: 80,
        readTimeout: Duration.seconds(60),
      }),
    };
    const router = new cloudfront.Function(this, "AppRouter", {
      functionName: `${prefix}-app-router`,
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        routerCode((stage.participantDomains ?? []).map(({ name }) => name)),
      ),
    });
    const mediaBehavior: cloudfront.BehaviorOptions = {
      origin: allOrigins.media,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      // Media shares an address with the apps, so browsers shouldn't guess at what a file is.
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
    };
    // With a zone in this account, the stack makes the certificate and the records itself (ADR 73).
    const zone =
      stage.domains && "hostedZone" in stage.domains
        ? route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
            hostedZoneId: stage.domains.hostedZone.id,
            zoneName: stage.domains.hostedZone.name,
          })
        : null;
    // Participant domains each have a zone of their own (ADR 74).
    const participantZones = (stage.participantDomains ?? []).map(({ name, hostedZoneId }) => ({
      name,
      zone: route53.HostedZone.fromHostedZoneAttributes(this, `ParticipantZone-${name}`, {
        hostedZoneId,
        zoneName: name,
      }),
    }));
    if (participantZones.length > 0 && !zone) {
      throw new Error(
        "Participant domains need `domains` with a hosted zone, for one certificate.",
      );
    }
    const allNames = [
      ...(stage.domains?.names ?? []),
      ...participantZones.map(({ name }) => name),
    ] as [string, ...string[]];
    const certificate = !stage.domains
      ? null
      : "certificateArn" in stage.domains
        ? acm.Certificate.fromCertificateArn(this, "Certificate", stage.domains.certificateArn)
        : new acm.Certificate(this, "Certificate", {
            domainName: allNames[0],
            subjectAlternativeNames: allNames.slice(1),
            validation: acm.CertificateValidation.fromDnsMultiZone(
              Object.fromEntries([
                ...stage.domains.names.map((name) => [name, zone as route53.IHostedZone]),
                ...participantZones.map(({ name, zone: own }) => [name, own]),
              ]),
            ),
          });
    const distribution = new cloudfront.Distribution(this, "Edge", {
      comment: `Truman 3 ${stage.name}`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      ...(stage.domains && certificate
        ? {
            domainNames: allNames,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            certificate,
          }
        : {}),
      defaultBehavior: {
        origin: allOrigins.apps,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Its cache key leaves out the query, so a recruitment ID in a link never reaches S3.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: router },
        ],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: allOrigins.api,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          // So the admin API doesn't answer on participant domains (ADR 74).
          functionAssociations: [
            { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: router },
          ],
        },
        "/media/*": mediaBehavior,
      },
    });
    const address = `https://${stage.domains?.names[0] ?? distribution.distributionDomainName}`;
    for (const { name, zone: own } of participantZones) {
      const target = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      );
      new route53.ARecord(this, `Participants-${name}`, { zone: own, target });
      new route53.AaaaRecord(this, `Participants-${name}-Ipv6`, { zone: own, target });
    }
    if (zone && stage.domains) {
      for (const [index, name] of stage.domains.names.entries()) {
        const target = route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(distribution),
        );
        new route53.ARecord(this, `Address${index + 1}`, { zone, recordName: name, target });
        new route53.AaaaRecord(this, `Address${index + 1}Ipv6`, {
          zone,
          recordName: name,
          target,
        });
      }
    }

    // What CloudFront can read of the media bucket: study images, and not what participants upload.
    mediaBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        resources: [mediaBucket.arnForObjects("media/*")],
        conditions: { StringEquals: { "AWS:SourceArn": distribution.distributionArn } },
      }),
    );

    // What CloudFront records, in CloudWatch. See EDGE_LOG_FIELDS. The name can only have letters,
    // numbers, dashes, and underscores.
    const edgeLogs = new logs.LogGroup(this, "EdgeLogs", {
      logGroupName: `${prefix}-edge`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const logSource = new logs.CfnDeliverySource(this, "EdgeLogSource", {
      name: `${prefix}-edge`,
      resourceArn: distribution.distributionArn,
      logType: "ACCESS_LOGS",
    });
    const logDestination = new logs.CfnDeliveryDestination(this, "EdgeLogDestination", {
      name: `${prefix}-edge`,
      // The log group's own Arn attribute ends in ":*", which this doesn't take.
      destinationResourceArn: this.formatArn({
        service: "logs",
        resource: "log-group",
        resourceName: edgeLogs.logGroupName,
        arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      }),
      outputFormat: "json",
    });
    const logDelivery = new logs.CfnDelivery(this, "EdgeLogDelivery", {
      deliverySourceName: logSource.name,
      deliveryDestinationArn: logDestination.attrArn,
      recordFields: EDGE_LOG_FIELDS,
    });
    logDelivery.addDependency(logSource);

    // The API's image, built on this computer and sent to AWS by `cdk deploy`. .dockerignore keeps
    // to a list of what's needed, so .env can't get in.
    const image = ecs.ContainerImage.fromAsset(props.imageDirectory, {
      platform: Platform.LINUX_ARM64,
      ignoreMode: IgnoreMode.DOCKER,
    });
    const cluster = new ecs.Cluster(this, "Cluster", { clusterName: prefix, vpc });
    const apiLogs = new logs.LogGroup(this, "ApiLogs", {
      logGroupName: `/${prefix}/api`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // Shortest, because creating a researcher writes their first password here.
    const taskLogs = new logs.LogGroup(this, "TaskLogs", {
      logGroupName: `/${prefix}/tasks`,
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /**
     * The app reads one database address, and Secrets Manager holds only the password, so the
     * address gets put together inside the container. ECS leaves `${...}` alone for the shell.
     */
    const withDatabaseAddress = (login: string, passwordVariable: string) => [
      "sh",
      "-c",
      `export DATABASE_URL="postgres://${login}:\${${passwordVariable}}@\${DATABASE_HOST}:\${DATABASE_PORT}/${DATABASE_NAME}?sslmode=require"; exec "$@"`,
      "sh",
    ];
    const taskDefinition = (id: string, family: string) =>
      new ecs.FargateTaskDefinition(this, id, {
        family,
        cpu: stage.apiCpu,
        memoryLimitMiB: stage.apiMemoryMb,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
    const databaseLocation = {
      DATABASE_HOST: database.instanceEndpoint.hostname,
      DATABASE_PORT: database.instanceEndpoint.port.toString(),
    };

    const apiTask = taskDefinition("ApiTask", `${prefix}-api`);

    // The host's emergency way to a lab's data (ADR 83). An administrator has to take this role on
    // purpose, which AWS records, and every use of a lab's key through it is reported to the lab.
    // It can use labs' keys and read what participants uploaded, and nothing else.
    const emergencyRole = stage.hosted
      ? new iam.Role(this, "EmergencyRole", {
          roleName: `${prefix}-emergency`,
          description:
            "Emergency access to labs' data. Every use is recorded and the lab is told. See docs/guides/hosting.md.",
          assumedBy: new iam.AccountRootPrincipal(),
          maxSessionDuration: Duration.hours(1),
        })
      : undefined;
    if (emergencyRole) {
      emergencyRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["kms:Decrypt", "kms:DescribeKey"],
          resources: [`arn:aws:kms:${stage.region}:${this.account}:key/*`],
          conditions: { StringEquals: { "aws:ResourceTag/truman-stage": prefix } },
        }),
      );
      mediaBucket.grantRead(emergencyRole, "uploads/*");
    }
    mediaBucket.grantReadWrite(apiTask.taskRole);
    mediaBucket.grantDelete(apiTask.taskRole);
    // Scanning the photos participants upload (ADR 79). Rekognition reads each one from the bucket
    // with the task's own permission to. The call has no resource to narrow it to.
    if (stage.hosted) {
      apiTask.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ["rekognition:DetectModerationLabels"],
          resources: ["*"],
        }),
      );
      // Labs' own keys (ADR 82). The API makes a key for a lab, and may only make and use keys
      // tagged for this stage. A key isn't known until it's made, so these can't name one.
      const taggedForThisStage = { "aws:ResourceTag/truman-stage": prefix };
      const taggingForThisStage = { "aws:RequestTag/truman-stage": prefix };
      apiTask.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ["kms:CreateKey", "kms:TagResource"],
          resources: ["*"],
          conditions: { StringEquals: taggingForThisStage },
        }),
      );
      apiTask.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: [
            "kms:CreateAlias",
            "kms:Decrypt",
            "kms:DescribeKey",
            "kms:Encrypt",
            "kms:GenerateDataKey",
          ],
          resources: [`arn:aws:kms:${stage.region}:${this.account}:key/*`],
          conditions: { StringEquals: taggedForThisStage },
        }),
      );
      apiTask.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ["kms:CreateAlias"],
          resources: [`arn:aws:kms:${stage.region}:${this.account}:alias/${prefix}-lab-*`],
        }),
      );
    }
    const apiContainer = apiTask.addContainer("api", {
      image,
      entryPoint: withDatabaseAddress(APP_LOGIN, "DATABASE_APP_PASSWORD"),
      command: ["node", "apps/api/src/server.ts"],
      environment: {
        ...databaseLocation,
        S3_REGION: stage.region,
        S3_BUCKET: mediaBucket.bucketName,
        // The same address as the page, so images load from a participant domain too (ADR 74).
        MEDIA_PUBLIC_URL: "/",
        PARTICIPANT_DOMAINS: (stage.participantDomains ?? []).map(({ name }) => name).join(","),
        ...(stage.participantDomains?.find((domain) => domain.default)
          ? {
              PARTICIPANT_DOMAIN_DEFAULT: stage.participantDomains.find((domain) => domain.default)
                ?.name,
            }
          : {}),
        PARTICIPANT_APP_URL: address,
        HOSTED: stage.hosted ? "true" : "false",
        // A hosted Truman has the example studies open for anyone to try (ADR 78).
        DEMO_STUDIES: stage.hosted ? "true" : "false",
        PHOTO_SCANNING: stage.hosted ? "rekognition" : "off",
        // Each lab's own key, made when it first opens a study to participants (ADR 82).
        ...(stage.hosted
          ? {
              LAB_KEYS: "kms",
              LAB_KEY_STAGE: prefix,
              // Who may use a lab's key: the API, and the emergency role.
              LAB_KEY_ROLES: `${apiTask.taskRole.roleArn},${emergencyRole?.roleArn}`,
            }
          : {}),
        ADMIN_APP_URL: `${address}/admin/`,
        ...(stage.mail ? { MAIL_FROM: stage.mail.from, MAIL_REGION: stage.region } : {}),
        // CloudFront, then the load balancer.
        TRUSTED_PROXIES: "2",
      },
      secrets: {
        DATABASE_APP_PASSWORD: ecs.Secret.fromSecretsManager(appPassword),
        TRUMAN_SECRET_KEY: ecs.Secret.fromSecretsManager(secretKey),
        ...(keyEventsHookKey
          ? { KEY_EVENTS_HOOK_KEY: ecs.Secret.fromSecretsManager(keyEventsHookKey) }
          : {}),
        // Made by hand, so the key never passes through the repo or a deploy.
        ...(stage.anthropicKeySecret
          ? {
              ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(
                secrets.Secret.fromSecretNameV2(this, "AnthropicKey", stage.anthropicKeySecret),
              ),
            }
          : {}),
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup: apiLogs, streamPrefix: "api" }),
      portMappings: [{ containerPort: API_PORT }],
    });

    const service = new ecs.FargateService(this, "Api", {
      serviceName: `${prefix}-api`,
      cluster,
      taskDefinition: apiTask,
      desiredCount: stage.apiTasks,
      assignPublicIp: true,
      vpcSubnets: publicSubnets,
      securityGroups: [tasksFirewall],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(60),
    });
    const listener = balancer.addListener("Http", {
      port: 80,
      protocol: elb.ApplicationProtocol.HTTP,
      open: false,
    });
    const apiTargets = listener.addTargets("Api", {
      port: API_PORT,
      protocol: elb.ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: apiContainer.containerName })],
      healthCheck: { path: "/health/ready", interval: Duration.seconds(30) },
      deregistrationDelay: Duration.seconds(30),
    });

    // One-off tasks, run by hand. The database update is the only thing that gets the owner's login.
    const updateTask = taskDefinition("UpdateTask", `${prefix}-update-database`);
    updateTask.addContainer("task", {
      image,
      entryPoint: withDatabaseAddress(OWNER_LOGIN, "DATABASE_OWNER_PASSWORD"),
      command: ["node", "packages/db/src/migrate-cli.ts"],
      environment: databaseLocation,
      secrets: {
        DATABASE_OWNER_PASSWORD: ecs.Secret.fromSecretsManager(ownerSecret, "password"),
        DATABASE_APP_PASSWORD: ecs.Secret.fromSecretsManager(appPassword),
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup: taskLogs, streamPrefix: "update-database" }),
    });
    const adminTask = taskDefinition("AdminTask", `${prefix}-admin`);
    adminTask.addContainer("task", {
      image,
      entryPoint: withDatabaseAddress(APP_LOGIN, "DATABASE_APP_PASSWORD"),
      command: ["node", "apps/cli/src/admin.ts"],
      environment: databaseLocation,
      secrets: { DATABASE_APP_PASSWORD: ecs.Secret.fromSecretsManager(appPassword) },
      logging: ecs.LogDrivers.awsLogs({ logGroup: taskLogs, streamPrefix: "admin" }),
    });

    // The apps' files. The hashed ones first and kept for a long time, then index.html, which isn't
    // cached, so a browser never gets an index.html whose files aren't there yet. Older hashed files
    // stay, for anyone who already has the page open.
    const publish = (name: string, dist: string, keyPrefix: string) => {
      const assets = new deploy.BucketDeployment(this, `${name}Assets`, {
        sources: [deploy.Source.asset(path.join(dist, "assets"))],
        destinationBucket: appsBucket,
        destinationKeyPrefix: `${keyPrefix}assets`,
        cacheControl: [
          deploy.CacheControl.setPublic(),
          deploy.CacheControl.maxAge(Duration.days(365)),
          deploy.CacheControl.immutable(),
        ],
        prune: false,
      });
      const pages = new deploy.BucketDeployment(this, `${name}Pages`, {
        sources: [deploy.Source.asset(dist, { exclude: ["assets", "assets/**"] })],
        destinationBucket: appsBucket,
        ...(keyPrefix ? { destinationKeyPrefix: keyPrefix } : {}),
        cacheControl: [deploy.CacheControl.noCache()],
        prune: false,
        distribution,
        distributionPaths: [`/${keyPrefix}index.html`],
      });
      pages.node.addDependency(assets);
    };
    publish("Participant", props.participantDist, "");
    publish("Admin", props.adminDist, "admin/");

    // The public site (ADR 75): static pages in a bucket of their own, behind their own
    // distribution, so nothing about the apps or the API is reachable from the site's address.
    if (stage.site) {
      if (!props.siteDist) {
        throw new Error("This stage has a site, so it needs the site's built files (siteDist).");
      }
      const siteZone = route53.HostedZone.fromHostedZoneAttributes(this, "SiteZone", {
        hostedZoneId: stage.site.hostedZone.id,
        zoneName: stage.site.hostedZone.name,
      });
      const siteBucket = new s3.Bucket(this, "Site", {
        ...bucketDefaults,
        // Only built files are here, and a deployment puts them back.
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
      const siteRouter = new cloudfront.Function(this, "SiteRouter", {
        functionName: `${prefix}-site-router`,
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        code: cloudfront.FunctionCode.fromInline(
          readFileSync(path.join(import.meta.dirname, "site-router.js"), "utf8"),
        ),
      });
      const siteEdge = new cloudfront.Distribution(this, "SiteEdge", {
        comment: `Truman 3 ${stage.name} public site`,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        domainNames: stage.site.names,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        certificate: new acm.Certificate(this, "SiteCertificate", {
          domainName: stage.site.names[0],
          subjectAlternativeNames: stage.site.names.slice(1),
          validation: acm.CertificateValidation.fromDns(siteZone),
        }),
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          functionAssociations: [
            { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: siteRouter },
          ],
        },
        // A page that isn't there gets the site's own "not found" page.
        errorResponses: [
          { httpStatus: 403, responseHttpStatus: 404, responsePagePath: "/404.html" },
        ],
      });
      for (const [index, name] of stage.site.names.entries()) {
        const target = route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(siteEdge),
        );
        new route53.ARecord(this, `SiteAddress${index + 1}`, {
          zone: siteZone,
          recordName: name,
          target,
        });
        new route53.AaaaRecord(this, `SiteAddress${index + 1}Ipv6`, {
          zone: siteZone,
          recordName: name,
          target,
        });
      }
      // Hashed files first and kept for a long time, then the pages, which aren't cached.
      const siteAssets = new deploy.BucketDeployment(this, "SiteAssets", {
        sources: [deploy.Source.asset(path.join(props.siteDist, "assets"))],
        destinationBucket: siteBucket,
        destinationKeyPrefix: "assets",
        cacheControl: [
          deploy.CacheControl.setPublic(),
          deploy.CacheControl.maxAge(Duration.days(365)),
          deploy.CacheControl.immutable(),
        ],
        prune: false,
      });
      const sitePages = new deploy.BucketDeployment(this, "SitePages", {
        sources: [deploy.Source.asset(props.siteDist, { exclude: ["assets", "assets/**"] })],
        destinationBucket: siteBucket,
        cacheControl: [deploy.CacheControl.noCache()],
        prune: false,
        distribution: siteEdge,
        distributionPaths: ["/*"],
      });
      sitePages.node.addDependency(siteAssets);
      new CfnOutput(this, "SiteAddress", {
        value: `https://${stage.site.names[0]}`,
        description: "The public site",
      });
    }

    const taskNetwork = `awsvpcConfiguration={subnets=[${vpc.publicSubnets
      .map(({ subnetId }) => subnetId)
      .join(",")}],securityGroups=[${tasksFirewall.securityGroupId}],assignPublicIp=ENABLED}`;
    const runTask = (family: string) =>
      `aws ecs run-task --cluster ${cluster.clusterName} --launch-type FARGATE --task-definition ${family} --network-configuration "${taskNetwork}"`;

    // Email to researchers (ADR 72). SES checks the domain through DKIM records, which go wherever
    // the domain's DNS is kept, so they're printed rather than made here.
    // When the mail domain is the zone this stack has, it adds the records itself.
    if (stage.mail) {
      const inZone = zone?.zoneName === stage.mail.domain;
      const mailDomain = new ses.EmailIdentity(this, "MailDomain", {
        identity:
          inZone && zone
            ? ses.Identity.publicHostedZone(zone)
            : ses.Identity.domain(stage.mail.domain),
      });
      mailDomain.grantSendEmail(apiTask.taskRole);
      (inZone ? [] : mailDomain.dkimRecords).forEach((record, index) => {
        new CfnOutput(this, `MailDkimRecord${index + 1}`, {
          value: `${record.name} CNAME ${record.value}`,
          description: `DKIM record ${index + 1} of ${mailDomain.dkimRecords.length} for ${stage.mail?.domain}. Add it as a CNAME where the domain's DNS is kept.`,
        });
      });
    }

    // Alarms and a budget, sent to a topic whose subscribers are added by hand (ADR 73).
    if (stage.alerts) {
      const topic = new sns.Topic(this, "Alerts", {
        topicName: `${prefix}-alerts`,
        displayName: `Truman 3 ${stage.name}`,
      });
      topic.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ["sns:Publish"],
          principals: [new iam.ServicePrincipal("budgets.amazonaws.com")],
          resources: [topic.topicArn],
        }),
      );
      const alarm = (
        id: string,
        description: string,
        metric: cloudwatch.IMetric,
        threshold: number,
        comparisonOperator: cloudwatch.ComparisonOperator,
        evaluationPeriods = 3,
      ) => {
        new cloudwatch.Alarm(this, id, {
          alarmName: `${prefix}-${id}`,
          alarmDescription: description,
          metric,
          threshold,
          comparisonOperator,
          evaluationPeriods,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }).addAlarmAction(new alarmActions.SnsAction(topic));
      };
      const fiveMinutes = { period: Duration.minutes(5) };
      const above = cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD;
      const below = cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD;
      alarm(
        "api-errors",
        "The API answered with more than 10 server errors in 5 minutes.",
        balancer.metrics.httpCodeTarget(elb.HttpCodeTarget.TARGET_5XX_COUNT, {
          ...fiveMinutes,
          statistic: "Sum",
        }),
        10,
        above,
        1,
      );
      alarm(
        "api-slow",
        "The slowest 5% of API requests took over a second, for 15 minutes.",
        apiTargets.metrics.targetResponseTime({ ...fiveMinutes, statistic: "p95" }),
        1,
        above,
      );
      // Stopped on purpose for a database update, it has no healthy hosts, so this is left out then.
      if (stage.apiTasks > 0) {
        alarm(
          "api-down",
          "No API container has been healthy for 10 minutes.",
          apiTargets.metrics.healthyHostCount({ ...fiveMinutes, statistic: "Maximum" }),
          1,
          below,
          2,
        );
      }
      alarm(
        "api-busy",
        "The API's CPU has been over 85% for 15 minutes.",
        service.metricCpuUtilization(fiveMinutes),
        85,
        above,
      );
      alarm(
        "database-busy",
        "The database's CPU has been over 80% for 15 minutes.",
        database.metricCPUUtilization(fiveMinutes),
        80,
        above,
      );
      alarm(
        "database-full",
        "The database has under 2 GB of space left.",
        database.metricFreeStorageSpace(fiveMinutes),
        2 * 1024 ** 3,
        below,
        1,
      );
      const notify = (notificationType: string, threshold: number) => ({
        notification: {
          notificationType,
          comparisonOperator: "GREATER_THAN",
          threshold,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [{ subscriptionType: "SNS", address: topic.topicArn }],
      });
      new budgets.CfnBudget(this, "Budget", {
        budget: {
          budgetName: `${prefix}-monthly`,
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: stage.alerts.monthlyBudgetUsd, unit: "USD" },
        },
        notificationsWithSubscribers: [notify("ACTUAL", 80), notify("FORECASTED", 100)],
      });
      new CfnOutput(this, "AlertsTopic", {
        value: topic.topicArn,
        description:
          "Where alarms and the budget are sent. Subscribe your email with: aws sns subscribe --topic-arn <this> --protocol email --notification-endpoint <your email>",
      });
    }

    // Telling a lab when its key is used or changed (ADR 83). AWS's record of every call made in
    // the account is what reports it, so that record is kept here.
    if (emergencyRole && keyEventsHookKey) {
      const trailBucket = new s3.Bucket(this, "Trail", {
        ...bucketDefaults,
        lifecycleRules: [{ expiration: Duration.days(365) }],
        // Kept with a stage that holds real data. A test stage's goes with it.
        removalPolicy,
        autoDeleteObjects: !stage.holdsRealData,
      });
      new cloudtrail.Trail(this, "Calls", {
        trailName: `${prefix}-calls`,
        bucket: trailBucket,
        // This region's calls, which is where the keys are. Signed, so a changed record shows.
        isMultiRegionTrail: false,
        enableFileValidation: true,
      });

      const hook = new events.ApiDestination(this, "KeyEventsHook", {
        connection: new events.Connection(this, "KeyEventsConnection", {
          description: "The Truman API, for reports that a lab's key was used or changed.",
          authorization: events.Authorization.apiKey(
            "x-truman-hook-key",
            keyEventsHookKey.secretValue,
          ),
        }),
        endpoint: `${address}/api/hooks/key-events`,
        httpMethod: events.HttpMethod.POST,
        // A restore reads many files. The API records each and emails once an hour.
        rateLimitPerSecond: 10,
      });
      const fromTheKeyService = {
        source: ["aws.kms"],
        detailType: ["AWS API Call via CloudTrail"],
      };
      // Anything read with a key through the emergency role.
      new events.Rule(this, "KeyUsedInEmergency", {
        description: "A key was used through the emergency role.",
        eventPattern: {
          ...fromTheKeyService,
          detail: {
            eventSource: ["kms.amazonaws.com"],
            userIdentity: { sessionContext: { sessionIssuer: { arn: [emergencyRole.roleArn] } } },
          },
        },
        targets: [new eventTargets.ApiDestination(hook)],
      });
      // A key changed, or who may use it, by anyone at all. The API ignores keys that aren't a
      // lab's.
      new events.Rule(this, "KeyChanged", {
        description: "A key, or who may use it, was changed.",
        eventPattern: {
          ...fromTheKeyService,
          detail: {
            eventSource: ["kms.amazonaws.com"],
            eventName: [
              "PutKeyPolicy",
              "CreateGrant",
              "DisableKey",
              "ScheduleKeyDeletion",
              "DeleteImportedKeyMaterial",
            ],
          },
        },
        targets: [new eventTargets.ApiDestination(hook)],
      });
      new CfnOutput(this, "EmergencyRoleArn", {
        value: emergencyRole.roleArn,
        description: "For emergencies only. Every use is recorded, and the lab is told.",
      });
    }

    new CfnOutput(this, "Address", { value: address, description: "The participant app" });
    new CfnOutput(this, "AdminAddress", {
      value: `${address}/admin/`,
      description: "The admin app",
    });
    new CfnOutput(this, "UpdateDatabaseCommand", {
      value: runTask(updateTask.family),
      description: "Brings the database up to date. Add your --profile.",
    });
    new CfnOutput(this, "AdminCommand", {
      value: runTask(adminTask.family),
      description: "Runs apps/cli/src/admin.ts. See docs/guides/deploying.md for the --overrides.",
    });
  }
}
