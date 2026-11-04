import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createRandom,
  freezePlatform,
  hasErrors,
  pickFrom,
  type StudyDefinition,
  type StudyIssue,
} from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { loadStudyFolder, MEDIA_FOLDERS } from "@truman3/study-files";
import { and, desc, eq } from "drizzle-orm";
import { launchVersion } from "./launch.ts";

const UPLOAD_CONCURRENCY = 16;
const INSERT_BATCH_SIZE = 500;

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export type ImportResult =
  | { status: "failed"; issues: StudyIssue[] }
  | {
      status: "imported" | "unchanged";
      studyVersionId: string;
      version: number;
      contentHash: string;
      issues: StudyIssue[];
      mediaUploaded: number;
    };

/** Sorts object keys, so the same study always hashes the same regardless of key order. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/** Where an item came from is only for error messages, so it isn't part of a study's identity. */
function withoutSource<T extends { source?: unknown }>(items: T[]) {
  return items.map(({ source: _source, ...item }) => item);
}

function hashStudy(study: StudyDefinition, mediaKeys: Map<string, string>): string {
  const identity = {
    settings: study.settings,
    pages: study.pages,
    actors: withoutSource(study.actors),
    // Only when there are some, so importing an older study again still finds it unchanged.
    ...(study.spaces.length > 0 ? { spaces: withoutSource(study.spaces) } : {}),
    posts: withoutSource(study.posts),
    comments: withoutSource(study.comments),
    reactions: withoutSource(study.reactions),
    media: [...mediaKeys.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
  return createHash("sha256").update(stableStringify(identity)).digest("hex");
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * Stores each image under a hash of its contents, so identical images are only stored once, and a
 * study version's images can't change later. Hosted media stays where it is.
 */
export async function storeMedia(
  study: StudyDefinition,
  folder: string,
  storage: Storage,
): Promise<{ keys: Map<string, string>; uploaded: number }> {
  const { site, media } = study.settings;
  const files = new Map<string, string>();

  for (const actor of study.actors) {
    if (actor.picture) {
      files.set(path.join(MEDIA_FOLDERS.actors, actor.picture), actor.picture);
    }
  }
  for (const space of study.spaces) {
    if (space.picture) {
      files.set(path.join(MEDIA_FOLDERS.spaces, space.picture), space.picture);
    }
    if (space.banner) {
      files.set(path.join(MEDIA_FOLDERS.spaces, space.banner), space.banner);
    }
  }
  for (const post of study.posts) {
    for (const picture of post.pictures) {
      files.set(path.join(MEDIA_FOLDERS.posts, picture), picture);
    }
  }
  for (const image of [site.logo, site.favicon, site.homepageImage]) {
    if (image) {
      files.set(image, image);
    }
  }

  const keys = new Map<string, string>();

  if (media.baseUrl) {
    const base = media.baseUrl.endsWith("/") ? media.baseUrl : `${media.baseUrl}/`;
    for (const file of files.keys()) {
      keys.set(file, new URL(path.basename(file), base).toString());
    }
    return { keys, uploaded: 0 };
  }

  await storage.ensureBucket();

  let uploaded = 0;
  const pending = [...files.keys()];
  const worker = async () => {
    for (let file = pending.pop(); file; file = pending.pop()) {
      const body = readFileSync(path.join(folder, file));
      const extension = path.extname(file).toLowerCase();
      const key = `media/${createHash("sha256").update(body).digest("hex")}${extension}`;
      keys.set(file, key);

      if (!(await storage.exists(key))) {
        await storage.put(key, body, CONTENT_TYPES[extension] ?? "application/octet-stream");
        uploaded += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));

  return { keys, uploaded };
}

/**
 * Validates a study folder, stores its media, and saves it as a new frozen version. That doesn't
 * open it to participants: launching is a separate step, unless asked for here. Importing the
 * same content again changes nothing. Everything goes in one transaction, so a failure can't leave
 * half a study behind.
 */
export async function importStudyFolder(
  db: Database,
  storage: Storage,
  folder: string,
  { teamId, launch = false }: { teamId?: string | undefined; launch?: boolean } = {},
): Promise<ImportResult> {
  const { definition: study, issues } = loadStudyFolder(folder);
  if (!study || hasErrors(issues)) {
    return { status: "failed", issues };
  }

  const { keys: mediaKeys, uploaded: mediaUploaded } = await storeMedia(study, folder, storage);
  const result = await freezeStudy(db, study, mediaKeys, issues, mediaUploaded, { teamId });
  if (launch && result.status !== "failed") {
    const [row] = await db
      .select({ id: schema.studies.id })
      .from(schema.studies)
      .where(eq(schema.studies.slug, study.settings.slug));
    await launchVersion(db, row?.id as string, result.studyVersionId, "import");
  }
  return result;
}

export interface FreezeOptions {
  teamId?: string | undefined;
  /** Where each post and comment came from. Files are the default. */
  provenanceFor?: (kind: "post" | "comment", ref: string) => object;
}

/**
 * Saves a checked study as a new frozen version. Studies from files and from the builder both come
 * through here, so they get the same treatment. The same content twice changes nothing.
 */
export async function freezeStudy(
  db: Database,
  unfrozen: StudyDefinition,
  mediaKeys: Map<string, string>,
  issues: StudyIssue[],
  mediaUploaded: number,
  { teamId, provenanceFor = () => ({ origin: "file" }) }: FreezeOptions = {},
): Promise<ImportResult> {
  // Before hashing, so the hash covers what the template gave this version.
  const settings = freezePlatform(unfrozen.settings);
  const study: StudyDefinition = { ...unfrozen, settings };
  const contentHash = hashStudy(study, mediaKeys);

  return db.transaction(async (tx) => {
    const [existingStudy] = await tx
      .select()
      .from(schema.studies)
      .where(eq(schema.studies.slug, settings.slug));
    const [newStudy] = existingStudy
      ? []
      : await tx
          .insert(schema.studies)
          .values({ slug: settings.slug, ...(teamId ? { teamId } : {}) })
          .returning();
    const studyRow = existingStudy ?? newStudy;
    if (!studyRow) {
      throw new Error("The study row wasn't created.");
    }

    const [sameContent] = await tx
      .select()
      .from(schema.studyVersions)
      .where(
        and(
          eq(schema.studyVersions.studyId, studyRow.id),
          eq(schema.studyVersions.contentHash, contentHash),
        ),
      );
    if (sameContent) {
      return {
        status: "unchanged",
        studyVersionId: sameContent.id,
        version: sameContent.version,
        contentHash,
        issues,
        mediaUploaded,
      };
    }

    const [latest] = await tx
      .select({ version: schema.studyVersions.version })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.studyId, studyRow.id))
      .orderBy(desc(schema.studyVersions.version))
      .limit(1);
    const versionNumber = (latest?.version ?? 0) + 1;

    // Derived from the content, so the same study always draws the same like counts.
    const seed = Number.parseInt(contentHash.slice(0, 12), 16);
    const random = createRandom(seed);

    const site = { ...settings.site };
    for (const field of ["logo", "favicon", "homepageImage"] as const) {
      const image = site[field];
      if (image) {
        site[field] = mediaKeys.get(image) as string;
      }
    }

    const [version] = await tx
      .insert(schema.studyVersions)
      .values({
        studyId: studyRow.id,
        version: versionNumber,
        settings: { ...settings, site },
        pages: study.pages,
        contentHash,
        seed,
      })
      .returning();
    if (!version) {
      throw new Error("The version row wasn't created.");
    }
    const studyVersionId = version.id;

    await tx.insert(schema.conditions).values(
      settings.conditions.arms.map((arm) => ({
        studyVersionId,
        key: arm.key,
        factors: arm.factors,
        weight: arm.weight,
      })),
    );
    await tx.insert(schema.assignmentCounters).values({ studyVersionId });

    const actorIds = new Map<string, string>();
    for (const batch of chunks(study.actors, INSERT_BATCH_SIZE)) {
      const rows = await tx
        .insert(schema.actors)
        .values(
          batch.map((actor) => ({
            studyVersionId,
            username: actor.username,
            driver: "scripted",
            conditions: actor.conditions,
            class: actor.class,
            profile: {
              name: actor.name,
              gender: actor.gender,
              age: actor.age,
              location: actor.location,
              bio: actor.bio,
              moderator: actor.moderator,
              karma: actor.karma,
              picture:
                actor.picture && mediaKeys.get(path.join(MEDIA_FOLDERS.actors, actor.picture)),
            },
          })),
        )
        .returning({ id: schema.actors.id, username: schema.actors.username });
      for (const row of rows) {
        actorIds.set(row.username, row.id);
      }
    }
    const actorId = (username: string) => actorIds.get(username) as string;

    const drawLikes = (explicit: number | undefined, distribution: number[] | undefined) =>
      explicit ?? (distribution ? pickFrom(distribution, random) : 0);

    const spaceIds = new Map<string, string>();
    if (study.spaces.length > 0) {
      const rows = await tx
        .insert(schema.spaces)
        .values(
          study.spaces.map((space, position) => ({
            studyVersionId,
            key: space.key,
            name: space.name,
            description: space.description,
            rules: space.rules,
            picture: space.picture && mediaKeys.get(path.join(MEDIA_FOLDERS.spaces, space.picture)),
            banner: space.banner && mediaKeys.get(path.join(MEDIA_FOLDERS.spaces, space.banner)),
            accent: space.accent,
            startsJoined: space.startsJoined,
            baseMembers: space.members,
            conditions: space.conditions,
            class: space.class,
            position,
          })),
        )
        .returning({ id: schema.spaces.id, key: schema.spaces.key });
      for (const row of rows) {
        spaceIds.set(row.key, row.id);
      }
    }

    const positions = new Map(study.posts.map((post, index) => [post.ref, index]));
    const postIds = new Map<string, string>();
    for (const batch of chunks(study.posts, INSERT_BATCH_SIZE)) {
      const rows = await tx
        .insert(schema.content)
        .values(
          batch.map((post) => ({
            studyVersionId,
            authorActorId: actorId(post.actor),
            spaceId: post.space ? spaceIds.get(post.space) : undefined,
            kind: "post",
            title: post.title,
            body: post.body,
            attachments: post.pictures.map((picture) => ({
              type: "image" as const,
              key: mediaKeys.get(path.join(MEDIA_FOLDERS.posts, picture)) as string,
            })),
            offsetMs: post.timeMs,
            position: positions.get(post.ref),
            baseLikes: drawLikes(post.likes, settings.likes.posts),
            baseUps: post.ups ?? 0,
            baseDowns: post.downs ?? 0,
            provenance: provenanceFor("post", post.ref),
            conditions: post.conditions,
            class: post.class,
            sourceRef: post.ref,
          })),
        )
        .returning({ id: schema.content.id, sourceRef: schema.content.sourceRef });
      for (const row of rows) {
        postIds.set(row.sourceRef as string, row.id);
      }
    }

    // A reply points at its comment, so that comment has to go in first.
    const commentIds = new Map(study.comments.map(({ ref }) => [ref, crypto.randomUUID()]));
    const commentsByRef = new Map(study.comments.map((comment) => [comment.ref, comment]));
    const depthOf = (comment: (typeof study.comments)[number]): number => {
      const parent = comment.replyTo ? commentsByRef.get(comment.replyTo) : undefined;
      return parent ? depthOf(parent) + 1 : 0;
    };
    const parentsFirst = [...study.comments].sort((a, b) => depthOf(a) - depthOf(b));

    for (const batch of chunks(parentsFirst, INSERT_BATCH_SIZE)) {
      await tx.insert(schema.content).values(
        batch.map((comment) => ({
          id: commentIds.get(comment.ref) as string,
          studyVersionId,
          parentId: comment.replyTo
            ? (commentIds.get(comment.replyTo) as string)
            : (postIds.get(comment.post) as string),
          authorActorId: actorId(comment.actor),
          kind: "comment",
          body: comment.body,
          offsetMs: comment.timeMs,
          baseLikes: drawLikes(comment.likes, settings.likes.comments),
          baseUps: comment.ups ?? 0,
          baseDowns: comment.downs ?? 0,
          provenance: provenanceFor("comment", comment.ref),
          conditions: comment.conditions,
          class: comment.class,
          sourceRef: comment.ref,
        })),
      );
    }

    for (const batch of chunks(study.reactions, INSERT_BATCH_SIZE)) {
      await tx.insert(schema.scriptedReactions).values(
        batch.map((reaction) => ({
          studyVersionId,
          on: reaction.on,
          nth: reaction.nth,
          type: reaction.type,
          actorId: actorId(reaction.actor),
          afterMs: reaction.afterMs,
          body: reaction.body,
          conditions: reaction.conditions,
          class: reaction.class,
        })),
      );
    }

    // Last, because the database refuses changes to the version's contents from here on.
    await tx
      .update(schema.studyVersions)
      .set({ frozenAt: new Date() })
      .where(eq(schema.studyVersions.id, studyVersionId));

    return {
      status: "imported",
      studyVersionId,
      version: versionNumber,
      contentHash,
      issues,
      mediaUploaded,
    };
  });
}
