import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { type Database, schema, type Transaction } from "@truman3/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * A key for each lab (ADR 82). What ties a lab's data to real people is stored under it: its
 * participants' recruitment IDs, their IP addresses where a study keeps them, and the photos they
 * upload.
 *
 * The lab's key lives in a key service, such as AWS KMS, and never leaves it. It wraps a data key,
 * which is kept wrapped beside the team. This server asks the service to unwrap it, and seals and
 * opens values with it in memory.
 */

/** Where labs' keys live. AWS KMS on a hosted Truman (lab-keys-kms.ts), and a stand-in in tests. */
export interface KeyService {
  /** Makes a key for a lab, and a data key wrapped by it. */
  create(team: { id: string; slug: string }): Promise<{ keyId: string; wrappedDataKey: string }>;
  /** The data key, unwrapped. */
  unwrap(keyId: string, wrappedDataKey: string): Promise<Buffer>;
  /** Whether its keys can also encrypt files in storage, as KMS keys can for S3. */
  encryptsStorage: boolean;
}

/** Seals and opens values with one lab's data key. */
export interface Sealer {
  /**
   * The lab's key, where it's one storage can encrypt a file with: a key in AWS KMS, with the files
   * in S3. Left out, the lab's photos are stored as everyone's are.
   */
  storageKeyId?: string | undefined;
  seal(text: string): string;
  /** Opens what `seal` made. Anything else is given back as it is, so older values still read. */
  open(sealed: string): string;
  /**
   * What stands in for a recruitment ID where it has to be looked up or be unique: the same for the
   * same ID, and no use to anyone without the key.
   */
  lookup(text: string): string;
}

const SEALED = "sealed:v1:";
const LOOKUP = "id:v1:";

/** Whether a stored value is one a lab's key sealed. */
export const isSealed = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(SEALED);

export function sealerFor(dataKey: Buffer, storageKeyId?: string): Sealer {
  return {
    storageKeyId,
    seal(text) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
      const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return SEALED + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },
    open(sealed) {
      if (!isSealed(sealed)) {
        return sealed;
      }
      const bytes = Buffer.from(sealed.slice(SEALED.length), "base64url");
      const decipher = createDecipheriv("aes-256-gcm", dataKey, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
        "utf8",
      );
    },
    lookup(text) {
      return LOOKUP + createHmac("sha256", dataKey).update(text).digest("base64url");
    },
  };
}

export interface LabKeys {
  /** Makes the team's key if it has none. Called when a lab first opens a study to participants. */
  ensure(db: Database | Transaction, teamId: string): Promise<void>;
  /** The team's sealer, or null if it has no key yet. */
  forTeam(db: Database | Transaction, teamId: string | null | undefined): Promise<Sealer | null>;
  /** The sealer of the team that owns a study. */
  forStudy(db: Database | Transaction, studyId: string): Promise<Sealer | null>;
  /** The same, from one of the study's versions. */
  forStudyVersion(db: Database | Transaction, studyVersionId: string): Promise<Sealer | null>;
}

/** Teams that never get a key: the demos, where nothing ties to a person (ADR 78). */
const NO_KEY_FOR = ["demos"];

export function createLabKeys(service: KeyService): LabKeys {
  // Unwrapped data keys, kept for as long as the server runs, so a page isn't a call to the service.
  const sealers = new Map<string, Sealer>();

  const forTeam: LabKeys["forTeam"] = async (db, teamId) => {
    if (!teamId) {
      return null;
    }
    const known = sealers.get(teamId);
    if (known) {
      return known;
    }
    const [team] = await db
      .select({ keyId: schema.teams.keyId, dataKey: schema.teams.dataKeyWrapped })
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId));
    if (!team?.keyId || !team.dataKey) {
      return null;
    }
    const sealer = sealerFor(
      await service.unwrap(team.keyId, team.dataKey),
      service.encryptsStorage ? team.keyId : undefined,
    );
    sealers.set(teamId, sealer);
    return sealer;
  };

  return {
    forTeam,
    async forStudy(db, studyId) {
      const [study] = await db
        .select({ teamId: schema.studies.teamId })
        .from(schema.studies)
        .where(eq(schema.studies.id, studyId));
      return forTeam(db, study?.teamId);
    },
    async forStudyVersion(db, studyVersionId) {
      const [version] = await db
        .select({ teamId: schema.studies.teamId })
        .from(schema.studyVersions)
        .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
        .where(eq(schema.studyVersions.id, studyVersionId));
      return forTeam(db, version?.teamId);
    },
    async ensure(db, teamId) {
      const [team] = await db
        .select({ id: schema.teams.id, slug: schema.teams.slug, keyId: schema.teams.keyId })
        .from(schema.teams)
        .where(eq(schema.teams.id, teamId));
      if (!team || team.keyId || NO_KEY_FOR.includes(team.slug)) {
        return;
      }
      const made = await service.create(team);
      // Only if it still has none, so two launches at once can't leave a team with two keys in use.
      await db
        .update(schema.teams)
        .set({ keyId: made.keyId, dataKeyWrapped: made.wrappedDataKey })
        .where(and(eq(schema.teams.id, teamId), isNull(schema.teams.keyId)));
    },
  };
}

/** A key service that keeps everything in memory, for tests and for trying this on a laptop. */
export function memoryKeyService(): KeyService & { made: string[] } {
  const keys = new Map<string, Buffer>();
  const made: string[] = [];
  return {
    made,
    encryptsStorage: false,
    async create(team) {
      const keyId = `memory-${team.slug}`;
      const master = randomBytes(32);
      keys.set(keyId, master);
      made.push(keyId);
      const dataKey = randomBytes(32);
      // "Wrapped" by XOR with the master key: enough to show the data key isn't stored as it is.
      const wrapped = Buffer.from(dataKey.map((byte, i) => byte ^ (master[i] as number)));
      return { keyId, wrappedDataKey: wrapped.toString("base64") };
    },
    async unwrap(keyId, wrappedDataKey) {
      const master = keys.get(keyId);
      if (!master) {
        throw new Error(`There's no key ${keyId}.`);
      }
      const wrapped = Buffer.from(wrappedDataKey, "base64");
      return Buffer.from(wrapped.map((byte, i) => byte ^ (master[i] as number)));
    },
  };
}
