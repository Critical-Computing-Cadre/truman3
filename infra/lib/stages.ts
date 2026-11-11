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
  /** Addresses other than the one CloudFront gives out. The certificate has to be in us-east-1. */
  domains?: { names: [string, ...string[]]; certificateArn: string };
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
    // Made by hand in this account and region. The key itself is never in the repo.
    anthropicKeySecret: "truman3-staging/anthropic-api-key",
  },
};
