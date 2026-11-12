/** Each place Truman runs, and what differs between them. Nothing here is a secret. */
export interface Stage {
  /** Used in every resource's name. */
  name: string;
  account: string;
  region: string;
  /**
   * Whether real participants' data can be here. It decides what happens to data if something is
   * removed, so that can't be forgotten: with this on, the database and media are kept.
   */
  holdsRealData: boolean;
  /**
   * Named so nothing has to ask AWS at build time. CloudFront can't reach use1-az3, and these names
   * map to different zones in each account, so check them. See docs/guides/deploying.md.
   */
  availabilityZones: [string, string];
  /** Fractions of a CPU, in 1024ths, and memory in MB, in a combination Fargate offers. */
  apiCpu: number;
  apiMemoryMb: number;
  /** How many API containers run. Zero stops them, to save money or before a database update. */
  apiTasks: number;
  databaseStorageGb: number;
  /** Automatic database backups. These are for recovering from a failure. */
  backupDays: number;
  /**
   * The name of a Secrets Manager secret, made by hand, holding an Anthropic API key, so Christof's
   * actors can write live. Leave it out and improvised beats use their fallback lines. The key is
   * never in this file or the repo. See docs/guides/deploying.md.
   */
  anthropicKeySecret?: string;
  /** A hosted Truman, where labs apply and an operator approves them (ADR 70). */
  hosted: boolean;
  /**
   * Email to researchers through Amazon SES (ADR 72): the domain it's sent from, which this stack
   * sets up in SES, and the From address. Its DKIM records are printed after a deploy, to add
   * wherever the domain's DNS is. Leave it out and no email is sent.
   */
  mail?: { domain: string; from: string };
  /**
   * Addresses other than the one CloudFront gives out. Either a certificate made by hand, which
   * has to be in us-east-1, or a Route 53 zone in this account, where the stack makes the
   * certificate and the addresses' records itself (ADR 73).
   */
  domains?:
    | { names: [string, ...string[]]; certificateArn: string }
    | { names: [string, ...string[]]; hostedZone: { id: string; name: string } };
  /** The database's size. A small one has twice the memory of a micro. Defaults to micro. */
  databaseSize?: "micro" | "small";
  /**
   * Alarms, and a monthly budget, sent to an SNS topic the stack makes (ADR 73). Who gets them is
   * subscribed by hand, so no one's email is in the repo.
   */
  alerts?: { monthlyBudgetUsd: number };
}

export const STAGES: Record<string, Stage> = {
  // No real participants. Everything here can be deleted.
  staging: {
    name: "staging",
    account: "966038456825",
    region: "us-east-1",
    holdsRealData: false,
    availabilityZones: ["us-east-1a", "us-east-1b"],
    // A whole CPU: a quarter of one ran flat out with 50 people in one shared world (ADR 69).
    apiCpu: 1024,
    apiMemoryMb: 2048,
    apiTasks: 1,
    databaseStorageGb: 20,
    backupDays: 7,
    // So applying and approving can be tried here before production.
    hosted: true,
    // Its own subdomain, so production can have truman-research.org itself.
    mail: {
      domain: "staging.truman-research.org",
      from: "Truman <no-reply@staging.truman-research.org>",
    },
    // Made by hand in this account and region. The key itself is never in the repo.
    anthropicKeySecret: "truman3-staging/anthropic-api-key",
  },
  // Real participants, so everything that holds their data is kept, even if the stack is removed.
  // Its own account, apart from staging (ADR 73).
  production: {
    name: "production",
    account: "935902555319",
    region: "us-east-1",
    holdsRealData: true,
    // use1-az1 and use1-az2 in this account.
    availabilityZones: ["us-east-1a", "us-east-1b"],
    apiCpu: 1024,
    apiMemoryMb: 2048,
    apiTasks: 1,
    databaseStorageGb: 20,
    databaseSize: "small",
    backupDays: 30,
    // Made by hand in this account and region, before the first deploy.
    anthropicKeySecret: "truman3-production/anthropic-api-key",
    hosted: true,
    mail: { domain: "truman-research.org", from: "Truman <no-reply@truman-research.org>" },
    // The zone was made by hand, and the domain's name servers point to it. truman-research.org
    // itself is kept for the public site.
    domains: {
      names: ["app.truman-research.org"],
      hostedZone: { id: "Z0760791OM9Y8AHGYNE6", name: "truman-research.org" },
    },
    alerts: { monthlyBudgetUsd: 150 },
  },
};
