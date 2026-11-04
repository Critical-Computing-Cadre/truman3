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
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
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
}

/** One deployment of Truman. See docs/guides/deploying.md and ADR 23. */
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
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
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
      media: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
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
        readFileSync(path.join(import.meta.dirname, "app-router.js"), "utf8"),
      ),
    });
    const mediaBehavior: cloudfront.BehaviorOptions = {
      origin: allOrigins.media,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      // Media shares an address with the apps, so browsers shouldn't guess at what a file is.
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
    };
    const distribution = new cloudfront.Distribution(this, "Edge", {
      comment: `Truman 3 ${stage.name}`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      ...(stage.domains
        ? {
            domainNames: stage.domains.names,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            certificate: acm.Certificate.fromCertificateArn(
              this,
              "Certificate",
              stage.domains.certificateArn,
            ),
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
        },
        "/media/*": mediaBehavior,
        "/uploads/*": mediaBehavior,
      },
    });
    const address = `https://${stage.domains?.names[0] ?? distribution.distributionDomainName}`;

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
    mediaBucket.grantReadWrite(apiTask.taskRole);
    mediaBucket.grantDelete(apiTask.taskRole);
    const apiContainer = apiTask.addContainer("api", {
      image,
      entryPoint: withDatabaseAddress(APP_LOGIN, "DATABASE_APP_PASSWORD"),
      command: ["node", "apps/api/src/server.ts"],
      environment: {
        ...databaseLocation,
        S3_REGION: stage.region,
        S3_BUCKET: mediaBucket.bucketName,
        MEDIA_PUBLIC_URL: address,
        PARTICIPANT_APP_URL: address,
        // CloudFront, then the load balancer.
        TRUSTED_PROXIES: "2",
      },
      secrets: {
        DATABASE_APP_PASSWORD: ecs.Secret.fromSecretsManager(appPassword),
        TRUMAN_SECRET_KEY: ecs.Secret.fromSecretsManager(secretKey),
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
    listener.addTargets("Api", {
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

    const taskNetwork = `awsvpcConfiguration={subnets=[${vpc.publicSubnets
      .map(({ subnetId }) => subnetId)
      .join(",")}],securityGroups=[${tasksFirewall.securityGroupId}],assignPublicIp=ENABLED}`;
    const runTask = (family: string) =>
      `aws ecs run-task --cluster ${cluster.clusterName} --launch-type FARGATE --task-definition ${family} --network-configuration "${taskNetwork}"`;

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
