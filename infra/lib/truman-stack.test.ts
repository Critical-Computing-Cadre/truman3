import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STAGES, type Stage } from "./stages.ts";
import { EDGE_LOG_FIELDS, routerCode, TrumanStack } from "./truman-stack.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const staging = STAGES.staging as Stage;
const real: Stage = { ...staging, name: "production", holdsRealData: true };
let work: string;
let files: { imageDirectory: string; participantDist: string; adminDist: string };

const build = (stage: Stage) =>
  Template.fromStack(
    new TrumanStack(new App(), "Test", {
      env: { account: stage.account, region: stage.region },
      stage,
      ...files,
    }),
  );

let template: Template;
let realTemplate: Template;

beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), "truman-infra-"));
  const dist = (name: string) => {
    const folder = path.join(work, name);
    mkdirSync(path.join(folder, "assets"), { recursive: true });
    writeFileSync(path.join(folder, "index.html"), "<html></html>");
    writeFileSync(path.join(folder, "assets/app.js"), "");
    return folder;
  };
  const imageDirectory = path.join(work, "image");
  mkdirSync(imageDirectory);
  writeFileSync(path.join(imageDirectory, "Dockerfile"), "FROM scratch\n");
  files = { imageDirectory, participantDist: dist("participant"), adminDist: dist("admin") };
  template = build(staging);
  realTemplate = build(real);
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

const resources = (from: Template, type: string) => Object.values(from.findResources(type));
const containers = (from: Template) =>
  resources(from, "AWS::ECS::TaskDefinition").map(
    (task) =>
      task.Properties.ContainerDefinitions[0] as {
        Environment?: { Name: string; Value: unknown }[];
        Secrets?: { Name: string }[];
        EntryPoint: string[];
        Command: string[];
      },
  );

describe("what can be reached from outside", () => {
  it("keeps the database private and encrypted", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      PubliclyAccessible: false,
      StorageEncrypted: true,
    });
  });

  it("puts the database and load balancer where the internet has no route", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internal",
    });
    // Private subnets get no default route, which is what makes them private.
    const routes = resources(template, "AWS::EC2::Route");
    expect(routes.length).toBe(staging.availabilityZones.length);
    for (const route of routes) {
      expect(JSON.stringify(route.Properties.RouteTableId)).toMatch(/public/i);
    }
  });

  it("blocks all public access to both buckets, and requires HTTPS", () => {
    const buckets = resources(template, "AWS::S3::Bucket");
    expect(buckets).toHaveLength(2);
    for (const bucket of buckets) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  it("lets nothing in from the whole internet, through any firewall", () => {
    const inbound = [
      ...resources(template, "AWS::EC2::SecurityGroup").flatMap(
        (group) => group.Properties.SecurityGroupIngress ?? [],
      ),
      ...resources(template, "AWS::EC2::SecurityGroupIngress").map((rule) => rule.Properties),
    ];
    expect(inbound.length).toBeGreaterThan(0);
    for (const rule of inbound) {
      expect(rule.CidrIp).toBeUndefined();
      expect(rule.CidrIpv6).toBeUndefined();
    }
  });

  it("describes firewalls only in characters AWS accepts", () => {
    const allowed = /^[a-zA-Z0-9. _\-:/()#,@[\]+=&;{}!$*]*$/;
    const groups = template.findResources("AWS::EC2::SecurityGroup");
    const rules = template.findResources("AWS::EC2::SecurityGroupIngress");
    const descriptions = [
      ...Object.values(groups).map((group) => group.Properties.GroupDescription),
      ...Object.values(rules).map((rule) => rule.Properties.Description ?? ""),
    ];
    expect(descriptions.length).toBeGreaterThan(0);
    for (const description of descriptions) {
      expect(description).toMatch(allowed);
    }
  });

  it("lets only CloudFront into the load balancer, and only that into the API", () => {
    const rules = resources(template, "AWS::EC2::SecurityGroupIngress").map(
      ({ Properties }) => Properties,
    );
    const fromCloudFront = rules.filter((rule) => rule.SourcePrefixListId);
    expect(fromCloudFront).toEqual([
      expect.objectContaining({ SourcePrefixListId: "pl-3b927c52", FromPort: 80, ToPort: 80 }),
    ]);
    const api = rules.filter((rule) => rule.FromPort === 3000);
    expect(api).toHaveLength(1);
    expect(JSON.stringify(api[0]?.SourceSecurityGroupId)).toContain("BalancerFirewall");
    // The API's firewall is the only one that's let into anything else: the database.
    const fromApi = rules.filter((rule) =>
      JSON.stringify(rule.SourceSecurityGroupId ?? "").includes("ApiFirewall"),
    );
    expect(fromApi).toHaveLength(1);
    expect(JSON.stringify(fromApi[0]?.GroupId)).toContain("Database");
  });

  it("reaches the load balancer through a private connection, and sends HTTP to HTTPS", () => {
    template.resourceCountIs("AWS::CloudFront::VpcOrigin", 1);
    const [edge] = resources(template, "AWS::CloudFront::Distribution");
    const config = edge?.Properties.DistributionConfig;
    for (const behavior of [config.DefaultCacheBehavior, ...config.CacheBehaviors]) {
      expect(behavior.ViewerProtocolPolicy).toBe("redirect-to-https");
    }
  });
});

describe("what the edge does", () => {
  const behavior = (pattern: string) =>
    resources(
      template,
      "AWS::CloudFront::Distribution",
    )[0]?.Properties.DistributionConfig.CacheBehaviors.find(
      (item: { PathPattern: string }) => item.PathPattern === pattern,
    );

  it("never caches the API, and passes it everything", () => {
    expect(behavior("/api/*")).toMatchObject({
      // AWS's managed policies: CachingDisabled and AllViewer.
      CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
      OriginRequestPolicyId: "216adef6-5c7f-47e4-b989-5492eafa07d3",
    });
    expect(behavior("/api/*").AllowedMethods).toContain("POST");
  });

  it("doesn't turn the API's errors into a web page", () => {
    const [edge] = resources(template, "AWS::CloudFront::Distribution");
    expect(edge?.Properties.DistributionConfig.CustomErrorResponses).toBeUndefined();
  });

  it("serves media from where the app says it is", () => {
    // This is the prefix in apps/api/src/actions/images.ts and packages/study-import.
    expect(behavior("/media/*")).toBeDefined();
  });

  it("has no way to reach what participants upload, except through the API", () => {
    expect(behavior("/uploads/*")).toBeUndefined();
    const statements = resources(template, "AWS::S3::BucketPolicy")
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
      .filter((statement) => statement.Principal?.Service === "cloudfront.amazonaws.com");
    const media = statements.filter((statement) =>
      JSON.stringify(statement.Resource).includes("media/*"),
    );
    expect(media).toHaveLength(1);
    // The apps' bucket is the only other one CloudFront reads, all of it.
    const others = statements.filter((statement) => !media.includes(statement));
    for (const statement of others) {
      expect(JSON.stringify(statement.Resource)).toContain("Apps");
    }
  });

  it("leaves what could identify someone out of its logs", () => {
    template.hasResourceProperties("AWS::Logs::Delivery", { RecordFields: EDGE_LOG_FIELDS });
    for (const field of [
      "cs-uri-query",
      "cs-uri-stem",
      "c-ip",
      "x-forwarded-for",
      "c-port",
      "cs(Referer)",
      "cs(Cookie)",
      "cs(User-Agent)",
      "asn",
      "c-country",
    ]) {
      expect(EDGE_LOG_FIELDS).not.toContain(field);
    }
    const [edge] = resources(template, "AWS::CloudFront::Distribution");
    // The older kind of log can't choose fields, so it stays off.
    expect(edge?.Properties.DistributionConfig.Logging).toBeUndefined();
  });

  it("names the log group the way log delivery needs", () => {
    const [destination] = resources(template, "AWS::Logs::DeliveryDestination");
    expect(JSON.stringify(destination?.Properties.DestinationResourceArn)).toContain("log-group:");
    expect(JSON.stringify(destination?.Properties.DestinationResourceArn)).not.toContain(":*");
    expect(destination?.Properties.Name).toMatch(/^[\w-]+$/);
  });

  it("has no load balancer logs, which would hold whole addresses", () => {
    const [balancer] = resources(template, "AWS::ElasticLoadBalancingV2::LoadBalancer");
    const attributes: { Key: string; Value: string }[] =
      balancer?.Properties.LoadBalancerAttributes ?? [];
    expect(attributes.find(({ Key }) => Key === "access_logs.s3.enabled")?.Value ?? "false").toBe(
      "false",
    );
  });

  it("works with no domains, and takes them when there are some", () => {
    const [edge] = resources(template, "AWS::CloudFront::Distribution");
    expect(edge?.Properties.DistributionConfig.Aliases).toBeUndefined();

    const withDomains = build({
      ...staging,
      domains: {
        names: ["one.example.org", "two.example.org"],
        certificateArn: "arn:aws:acm:us-east-1:966038456825:certificate/abc",
      },
    });
    withDomains.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: { Aliases: ["one.example.org", "two.example.org"] },
    });
    const api = containers(withDomains).find(({ Command }) => Command[1]?.includes("server.ts"));
    expect(api?.Environment?.find(({ Name }) => Name === "PARTICIPANT_APP_URL")?.Value).toBe(
      "https://one.example.org",
    );
  });
});

describe("the app router", () => {
  const route = (uri: string, host = "app.truman.test", participantHosts: string[] = []) => {
    const context = vm.createContext({});
    vm.runInContext(routerCode(participantHosts), context);
    return (
      context as { handler: (event: unknown) => { uri?: string; statusCode?: number } }
    ).handler({ request: { uri, headers: { host: { value: host } } } });
  };

  it.each([
    ["/", "/index.html"],
    ["/join/eatsnap", "/index.html"],
    ["/u/some.name", "/index.html"],
    ["/assets/app-abc.js", "/assets/app-abc.js"],
    ["/admin/", "/admin/index.html"],
    ["/admin/studies/new", "/admin/index.html"],
    ["/admin/assets/app-abc.js", "/admin/assets/app-abc.js"],
    ["/administrator", "/index.html"],
  ])("sends %s to %s", (from, to) => {
    expect(route(from).uri).toBe(to);
  });

  it("redirects /admin to /admin/", () => {
    expect(route("/admin").statusCode).toBe(301);
  });

  it("passes the API through untouched", () => {
    expect(route("/api/feed").uri).toBe("/api/feed");
    expect(route("/api/admin/studies").uri).toBe("/api/admin/studies");
  });

  describe("on a participant domain (ADR 74)", () => {
    const participants = ["eatsnap.test"];
    it.each([
      "/admin",
      "/admin/",
      "/admin/studies/new",
      "/admin/assets/app-abc.js",
      "/api/admin",
      "/api/admin/login",
    ])("doesn't answer %s", (uri) => {
      expect(route(uri, "eatsnap.test", participants).statusCode).toBe(404);
    });

    it("answers everything a participant uses", () => {
      expect(route("/join/study", "eatsnap.test", participants).uri).toBe("/index.html");
      expect(route("/api/feed", "eatsnap.test", participants).uri).toBe("/api/feed");
      expect(route("/assets/app-abc.js", "eatsnap.test", participants).uri).toBe(
        "/assets/app-abc.js",
      );
    });

    it("still answers the admin app at the researchers' own address", () => {
      expect(route("/admin/", "app.truman.test", participants).uri).toBe("/admin/index.html");
    });
  });
});

describe("secrets", () => {
  const SECRET_NAMES = [
    "DATABASE_APP_PASSWORD",
    "DATABASE_OWNER_PASSWORD",
    "TRUMAN_SECRET_KEY",
    "DATABASE_URL",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ];

  it("keeps them out of containers' plain settings", () => {
    const all = containers(template);
    expect(all).toHaveLength(3);
    for (const container of all) {
      const plain = (container.Environment ?? []).map(({ Name }) => Name);
      for (const name of SECRET_NAMES) {
        expect(plain).not.toContain(name);
      }
      expect(JSON.stringify(container.Environment ?? [])).not.toMatch(/password/i);
    }
  });

  it("gives the owner's login only to the database update", () => {
    const named = (name: string) =>
      containers(template).filter(({ Secrets }) =>
        (Secrets ?? []).some((secret) => secret.Name === name),
      );
    const owners = named("DATABASE_OWNER_PASSWORD");
    expect(owners).toHaveLength(1);
    expect(owners[0]?.Command.join(" ")).toContain("migrate-cli");
    for (const { EntryPoint, Command } of containers(template)) {
      const usesOwner = EntryPoint.join(" ").includes("truman_owner");
      expect(usesOwner).toBe(Command.join(" ").includes("migrate-cli"));
    }
  });

  it("gives the encryption key only to the API", () => {
    const holders = containers(template).filter(({ Secrets }) =>
      (Secrets ?? []).some(({ Name }) => Name === "TRUMAN_SECRET_KEY"),
    );
    expect(holders.map(({ Command }) => Command.at(-1))).toEqual(["apps/api/src/server.ts"]);
  });

  it("connects to the database with encryption", () => {
    for (const { EntryPoint } of containers(template)) {
      expect(EntryPoint.join(" ")).toContain("sslmode=require");
    }
  });

  it("puts the database address together inside the container", () => {
    const api = containers(template).find(({ Command }) => Command.at(-1)?.includes("server.ts"));
    const [shell, flag, script, name] = api!.EntryPoint as [string, string, string, string];
    const address = execFileSync(shell, [flag, script, name, "printenv", "DATABASE_URL"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        DATABASE_APP_PASSWORD: "abc",
        DATABASE_HOST: "db",
        DATABASE_PORT: "5432",
      },
    });
    expect(address.trim()).toBe("postgres://truman_app:abc@db:5432/truman?sslmode=require");
  });

  it("makes a key the right length, in characters that read as base64", () => {
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "truman3-staging/truman-secret-key",
      GenerateSecretString: { PasswordLength: 43, ExcludePunctuation: true },
    });
    expect(Buffer.from("a".repeat(43), "base64")).toHaveLength(32);
  });

  it("keeps passwords to characters that are safe in a database address", () => {
    const owner = resources(template, "AWS::SecretsManager::Secret").find(
      (secret) => secret.Properties.Name === "truman3-staging/database-owner",
    );
    const excluded: string = owner?.Properties.GenerateSecretString.ExcludeCharacters;
    for (const character of ":/@?#%&=+ ") {
      expect(excluded).toContain(character);
    }
  });

  it("uses a role for storage, and limits it to the media bucket", () => {
    const api = containers(template).find(({ Command }) => Command.at(-1)?.includes("server.ts"));
    const plain = (api?.Environment ?? []).map(({ Name }) => Name);
    expect(plain).toEqual(expect.arrayContaining(["S3_REGION", "S3_BUCKET"]));
    expect(plain).not.toContain("S3_ENDPOINT");

    const apiPolicies = Object.entries(template.findResources("AWS::IAM::Policy"))
      .filter(([id]) => id.startsWith("ApiTaskTaskRole"))
      .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);
    expect(apiPolicies.length).toBeGreaterThan(0);
    const named = JSON.stringify(apiPolicies.map(({ Resource }) => Resource));
    expect(named).toContain("Media");
    expect(named).not.toContain("Apps");
    expect(named).not.toContain('"*"');
  });
});

describe("when it's removed", () => {
  const removal = (from: Template, type: string) =>
    Object.values(from.findResources(type)).map((resource) => resource.DeletionPolicy);

  it("lets staging be deleted", () => {
    expect(removal(template, "AWS::RDS::DBInstance")).toEqual(["Delete"]);
    template.hasResourceProperties("AWS::RDS::DBInstance", { DeletionProtection: false });
  });

  it("doesn't keep deleted files for long when it holds real participants", () => {
    realTemplate.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ NoncurrentVersionExpiration: { NoncurrentDays: 7 } }),
        ]),
      },
    });
  });

  it("keeps a stage's data when it holds real participants", () => {
    expect(removal(realTemplate, "AWS::RDS::DBInstance")).toEqual(["Retain"]);
    realTemplate.hasResourceProperties("AWS::RDS::DBInstance", { DeletionProtection: true });
    realTemplate.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
    });
    expect(removal(realTemplate, "AWS::S3::Bucket")).toContain("Retain");
    expect(removal(realTemplate, "AWS::SecretsManager::Secret")).toEqual([
      "Retain",
      "Retain",
      "Retain",
    ]);
    // Nothing goes around and empties a bucket that holds data.
    const buckets = Object.entries(realTemplate.findResources("AWS::S3::Bucket"));
    const media = buckets.filter(([id]) => id.startsWith("Media"));
    expect(media[0]?.[1].Properties.Tags ?? []).not.toContainEqual(
      expect.objectContaining({ Key: "aws-cdk:auto-delete-objects" }),
    );
  });
});

describe("costs and labels", () => {
  it("has no NAT gateway, one container with one CPU, and a small database", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.micro",
      MultiAZ: false,
      AllocatedStorage: "20",
      StorageType: "gp3",
    });
    template.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 1 });
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      // A quarter of a CPU wasn't enough for 50 people in one shared world (ADR 69).
      Cpu: "1024",
      Memory: "2048",
      RuntimePlatform: { CpuArchitecture: "ARM64" },
    });
  });

  it("keeps logs for a short time", () => {
    for (const group of resources(template, "AWS::Logs::LogGroup")) {
      expect(group.Properties.RetentionInDays).toBeLessThanOrEqual(14);
    }
  });

  it("says it's staging, with no real participants", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      Tags: Match.arrayWith([
        { Key: "RealParticipants", Value: "no" },
        { Key: "Stage", Value: "staging" },
      ]),
    });
    expect(staging.holdsRealData).toBe(false);
  });
});

describe("building it for real", () => {
  it("asks AWS nothing, and leaves .env out of the image", () => {
    const outdir = path.join(work, "real");
    const app = new App({ outdir });
    new TrumanStack(app, "Real", {
      env: { account: staging.account, region: staging.region },
      stage: staging,
      imageDirectory: ROOT,
      participantDist: files.participantDist,
      adminDist: files.adminDist,
    });
    const assembly = app.synth();
    // A value AWS would have had to be asked for shows up here.
    expect(assembly.manifest.missing ?? []).toEqual([]);

    const copied = execFileSync(
      "find",
      [outdir, "-name", ".env*", "-not", "-path", "*/node_modules/*"],
      {
        encoding: "utf8",
      },
    );
    expect(copied).toBe("");
  });
});

describe("email to researchers (ADR 72)", () => {
  it("sets up the stage's sending domain, and lets only the API send from it", () => {
    template.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "staging.truman-research.org",
    });
    const grants = Object.values(template.findResources("AWS::IAM::Policy")).filter((policy) =>
      JSON.stringify(policy).includes("ses:SendEmail"),
    );
    expect(grants).toHaveLength(1);
    expect(JSON.stringify(grants[0])).toContain("ApiTask");
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            { Name: "MAIL_FROM", Value: "Truman <no-reply@staging.truman-research.org>" },
          ]),
        }),
      ]),
    });
  });

  it("sends nothing from a stage without a mail domain", () => {
    const { mail: _, ...withoutMail } = staging;
    build(withoutMail).resourceCountIs("AWS::SES::EmailIdentity", 0);
  });
});

describe("production (ADR 73)", () => {
  let production: Template;
  beforeAll(() => {
    production = build(STAGES.production as Stage);
  });

  it("is its own account, keeps real data, and keeps its backups for 30 days", () => {
    expect(STAGES.production?.account).not.toBe(staging.account);
    production.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.small",
      BackupRetentionPeriod: 30,
      DeletionProtection: true,
    });
    production.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Retain" });
  });

  it("answers at app.truman-research.org, with a certificate checked through its own zone", () => {
    production.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "app.truman-research.org",
      ValidationMethod: "DNS",
      DomainValidationOptions: Match.arrayWith([
        { DomainName: "app.truman-research.org", HostedZoneId: "Z0760791OM9Y8AHGYNE6" },
      ]),
    });
    production.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["app.truman-research.org", "clikbrite.com"],
      }),
    });
    for (const type of ["A", "AAAA"]) {
      production.hasResourceProperties("AWS::Route53::RecordSet", {
        Name: "app.truman-research.org.",
        Type: type,
        HostedZoneId: "Z0760791OM9Y8AHGYNE6",
      });
    }
  });

  it("runs studies at clikbrite.com unless they choose otherwise (ADR 74)", () => {
    production.hasResourceProperties("AWS::CertificateManager::Certificate", {
      SubjectAlternativeNames: ["clikbrite.com"],
      DomainValidationOptions: Match.arrayWith([
        { DomainName: "clikbrite.com", HostedZoneId: "Z033394513YLTT9F3EV6U" },
      ]),
    });
    production.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            { Name: "PARTICIPANT_DOMAINS", Value: "clikbrite.com" },
            { Name: "PARTICIPANT_DOMAIN_DEFAULT", Value: "clikbrite.com" },
          ]),
        }),
      ]),
    });
  });

  it("sends email from truman-research.org, adding its DKIM records to the zone itself", () => {
    production.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "truman-research.org",
    });
    const dkim = Object.values(production.findResources("AWS::Route53::RecordSet")).filter(
      (record) => JSON.stringify(record).includes("DkimDNSTokenName"),
    );
    expect(dkim).toHaveLength(3);
    expect(Object.keys(production.findOutputs("MailDkimRecord*"))).toEqual([]);
  });

  it("raises alarms and a budget to one topic, and staging has none", () => {
    production.resourceCountIs("AWS::SNS::Topic", 1);
    for (const name of [
      "api-errors",
      "api-slow",
      "api-down",
      "api-busy",
      "database-busy",
      "database-full",
    ]) {
      production.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: `truman3-production-${name}`,
        AlarmActions: [Match.anyValue()],
      });
    }
    production.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 150, Unit: "USD" } }),
    });
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  });

  it("leaves out the alarm for no healthy API while the API is stopped for a database update", () => {
    const stopped = build({ ...(STAGES.production as Stage), apiTasks: 0 });
    expect(
      Object.values(stopped.findResources("AWS::CloudWatch::Alarm")).some((alarm) =>
        JSON.stringify(alarm).includes("api-down"),
      ),
    ).toBe(false);
  });
});

describe("participant domains (ADR 74)", () => {
  const withDomains: Stage = {
    ...(STAGES.production as Stage),
    participantDomains: [
      { name: "eatsnap.test", hostedZoneId: "ZEATSNAP" },
      { name: "clickbright.test", hostedZoneId: "ZCLICKBRIGHT" },
    ],
  };
  let built: Template;
  beforeAll(() => {
    built = build(withDomains);
  });

  it("puts them on the certificate and the distribution, each checked through its own zone", () => {
    built.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "app.truman-research.org",
      SubjectAlternativeNames: ["eatsnap.test", "clickbright.test"],
      DomainValidationOptions: Match.arrayWith([
        { DomainName: "eatsnap.test", HostedZoneId: "ZEATSNAP" },
        { DomainName: "clickbright.test", HostedZoneId: "ZCLICKBRIGHT" },
      ]),
    });
    built.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: ["app.truman-research.org", "eatsnap.test", "clickbright.test"],
      }),
    });
    for (const zone of ["ZEATSNAP", "ZCLICKBRIGHT"]) {
      for (const type of ["A", "AAAA"]) {
        built.hasResourceProperties("AWS::Route53::RecordSet", { HostedZoneId: zone, Type: type });
      }
    }
  });

  it("tells the API and the router about them, and links images to the page's own address", () => {
    built.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            { Name: "MEDIA_PUBLIC_URL", Value: "/" },
            { Name: "PARTICIPANT_DOMAINS", Value: "eatsnap.test,clickbright.test" },
          ]),
        }),
      ]),
    });
    const [router] = Object.values(built.findResources("AWS::CloudFront::Function"));
    expect(JSON.stringify(router)).toContain(
      'PARTICIPANT_HOSTS = [\\"eatsnap.test\\",\\"clickbright.test\\"]',
    );
  });

  it("puts the router on the API too, so the admin API doesn't answer on them", () => {
    const [distribution] = Object.values(built.findResources("AWS::CloudFront::Distribution"));
    const behaviors = (
      distribution as {
        Properties: {
          DistributionConfig: {
            CacheBehaviors: { PathPattern: string; FunctionAssociations?: unknown[] }[];
          };
        };
      }
    ).Properties.DistributionConfig.CacheBehaviors;
    expect(
      behaviors.find(({ PathPattern }) => PathPattern === "/api/*")?.FunctionAssociations,
    ).toHaveLength(1);
  });

  it("needs a stage whose own addresses are in a zone, for one certificate", () => {
    const { domains: _, ...withoutZone } = withDomains;
    expect(() => build(withoutZone)).toThrow(/hosted zone/);
  });
});
