import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STAGES, type Stage } from "./stages.ts";
import { EDGE_LOG_FIELDS, TrumanStack } from "./truman-stack.ts";

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
  const route = (uri: string) => {
    const context = vm.createContext({});
    vm.runInContext(readFileSync(path.join(import.meta.dirname, "app-router.js"), "utf8"), context);
    return (
      context as { handler: (event: unknown) => { uri?: string; statusCode?: number } }
    ).handler({ request: { uri } });
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
  it("has no NAT gateway, and one small container and database", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      DBInstanceClass: "db.t4g.micro",
      MultiAZ: false,
      AllocatedStorage: "20",
      StorageType: "gp3",
    });
    template.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 1 });
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Memory: "512",
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
