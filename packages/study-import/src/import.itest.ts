import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { importStudyFolder } from "./import.ts";

const YAML = (slug: string, extra = "") => `
schemaVersion: 1
slug: ${slug}
title: Demo
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: Prolific ID, source: prolific }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a, factors: { tone: warm } }, { key: b, weight: 2 }]
feed: { ranker: chronological }
likes:
  posts: [7, 8, 9]
  comments: [5]
flow: [{ step: consent, page: pages/consent.md }, { step: feed }]
${extra}
`;

const FILES = (slug: string) => ({
  "study.yaml": YAML(slug),
  "pages/consent.md": "# Consent",
  "actors.csv": "username,name,age,bio,picture\nann,Ann,30,Hi there,ann.jpg\nbob,Bob,,,\n",
  "posts.csv":
    "id,body,picture,actor,likes,time,condition\n" +
    "1,hello,one.jpg,ann,,0:00,a\n" +
    "2,fixed,,bob,3,-1:00,b\n",
  "comments.csv": "id,body,actor,postID,time\n1,nice,bob,1,0:05\n",
  "reactions.csv": "on,nth,type,actor,after,body,condition\npost,0,reply,ann,0:04,Cool,a\n",
  "media/actors/ann.jpg": "ann's picture",
  "media/posts/one.jpg": "post picture",
});

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const storage = createStorage(storageConfigFromEnv());
const folders: string[] = [];
let counter = 0;

function folder(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-import-"));
  folders.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const uniqueSlug = () => {
  counter += 1;
  return `demo-${counter}`;
};

/** Imports and fails the test with the study's errors if that doesn't work. */
async function imported(dir: string) {
  const result = await importStudyFolder(database.db, storage, dir);
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result;
}

beforeAll(async () => {
  database = await createTestDatabase();
});

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  storage.close();
  await database.destroy();
});

describe("importStudyFolder", () => {
  it("saves everything in the study and freezes the version", async () => {
    const { db } = database;
    const result = await imported(folder(FILES(uniqueSlug())));
    const versionId = result.studyVersionId;

    const [version] = await db
      .select()
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    expect(version?.frozenAt).toBeInstanceOf(Date);
    expect(version?.version).toBe(1);
    expect(version?.pages).toEqual({ "pages/consent.md": "# Consent" });

    const conditions = await db
      .select()
      .from(schema.conditions)
      .where(eq(schema.conditions.studyVersionId, versionId));
    expect(conditions.map(({ key, factors, weight }) => ({ key, factors, weight }))).toEqual(
      expect.arrayContaining([
        { key: "a", factors: { tone: "warm" }, weight: 1 },
        { key: "b", factors: {}, weight: 2 },
      ]),
    );

    const actors = await db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.studyVersionId, versionId));
    const ann = actors.find((actor) => actor.username === "ann");
    expect(ann?.driver).toBe("scripted");
    expect(ann?.profile).toMatchObject({ name: "Ann", age: 30, bio: "Hi there" });

    const content = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.studyVersionId, versionId));
    const post = content.find((item) => item.sourceRef === "1" && item.kind === "post");
    const comment = content.find((item) => item.kind === "comment");
    expect(post).toMatchObject({ offsetMs: 0, conditions: ["a"], authorActorId: ann?.id });
    expect(comment).toMatchObject({ parentId: post?.id, offsetMs: 300_000, baseLikes: 5 });

    const reactions = await db
      .select()
      .from(schema.scriptedReactions)
      .where(eq(schema.scriptedReactions.studyVersionId, versionId));
    expect(reactions).toMatchObject([
      { on: "post", nth: 0, type: "reply", afterMs: 240_000, body: "Cool", conditions: ["a"] },
    ]);
  });

  it("protects reactions in a frozen version, like the rest of its contents", async () => {
    const result = await imported(folder(FILES(uniqueSlug())));

    await expect(
      database.db
        .update(schema.scriptedReactions)
        .set({ body: "changed" })
        .where(eq(schema.scriptedReactions.studyVersionId, result.studyVersionId)),
    ).rejects.toThrow();
  });

  it("keeps a like count the study sets, and draws the rest from its list", async () => {
    const result = await imported(folder(FILES(uniqueSlug())));
    const content = await database.db
      .select()
      .from(schema.content)
      .where(eq(schema.content.studyVersionId, result.studyVersionId));

    expect(content.find((item) => item.sourceRef === "2")?.baseLikes).toBe(3);
    expect([7, 8, 9]).toContain(content.find((item) => item.sourceRef === "1")?.baseLikes);
  });

  it("gives content zero likes when the study doesn't ask for random ones", async () => {
    const files = FILES(uniqueSlug());
    const result = await imported(
      folder({
        ...files,
        "study.yaml": files["study.yaml"].replace(/likes:\n.*\n.*\n/, ""),
      }),
    );
    const content = await database.db
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.studyVersionId, result.studyVersionId),
          eq(schema.content.sourceRef, "1"),
        ),
      );

    expect(content.map((item) => item.baseLikes)).toEqual([0, 0]);
  });

  it("does nothing when the same content is imported again", async () => {
    const dir = folder(FILES(uniqueSlug()));

    const first = await imported(dir);
    const second = await imported(dir);

    expect(first.status).toBe("imported");
    expect(second).toMatchObject({
      status: "unchanged",
      studyVersionId: first.studyVersionId,
      mediaUploaded: 0,
    });
  });

  it("creates a new version when content changes, leaving the old one alone", async () => {
    const slug = uniqueSlug();
    const first = await imported(folder(FILES(slug)));
    const second = await imported(
      folder({
        ...FILES(slug),
        "comments.csv": "id,body,actor,postID,time\n1,changed,bob,1,0:05\n",
      }),
    );

    expect(second.version).toBe(2);
    expect(second.studyVersionId).not.toBe(first.studyVersionId);

    const original = await database.db
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.studyVersionId, first.studyVersionId),
          isNotNull(schema.content.parentId),
        ),
      );
    expect(original[0]?.body).toBe("nice");
  });

  it("makes media available at a URL, stored by its contents", async () => {
    const result = await imported(folder(FILES(uniqueSlug())));
    const [post] = await database.db
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.studyVersionId, result.studyVersionId),
          eq(schema.content.sourceRef, "1"),
          eq(schema.content.kind, "post"),
        ),
      );

    expect(post?.attachments[0]?.key).toMatch(/^media\/[0-9a-f]{64}\.jpg$/);
    const response = await fetch(`${process.env.MEDIA_PUBLIC_URL}/${post?.attachments[0]?.key}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("post picture");
  });

  it("leaves hosted media where it is, and doesn't need local copies", async () => {
    const files = FILES(uniqueSlug());
    const { "media/actors/ann.jpg": _actor, "media/posts/one.jpg": _post, ...withoutMedia } = files;
    const result = await imported(
      folder({
        ...withoutMedia,
        "study.yaml": `${files["study.yaml"]}\nmedia: { baseUrl: "https://cdn.example.com/my-study" }\n`,
      }),
    );
    const [post] = await database.db
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.studyVersionId, result.studyVersionId),
          eq(schema.content.sourceRef, "1"),
          eq(schema.content.kind, "post"),
        ),
      );

    expect(result.mediaUploaded).toBe(0);
    expect(post?.attachments[0]?.key).toBe("https://cdn.example.com/my-study/one.jpg");
  });

  it("refuses a study with errors and saves nothing", async () => {
    const slug = uniqueSlug();
    const result = await importStudyFolder(
      database.db,
      storage,
      folder({ ...FILES(slug), "posts.csv": "id,body,actor,time\n1,hi,nobody,0:00\n" }),
    );

    expect(result.status).toBe("failed");
    expect(
      await database.db.select().from(schema.studies).where(eq(schema.studies.slug, slug)),
    ).toEqual([]);
  });

  it("imports the eatsnap reference study", { timeout: 120_000 }, async () => {
    const eatsnap = path.resolve(import.meta.dirname, "../../../studies/examples/eatsnap");
    const first = await imported(eatsnap);
    const versionId = first.studyVersionId;
    const { db } = database;

    const content = await db
      .select()
      .from(schema.content)
      .where(eq(schema.content.studyVersionId, versionId));
    const posts = content.filter((item) => item.kind === "post");
    const comments = content.filter((item) => item.kind === "comment");
    const actors = await db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.studyVersionId, versionId));
    const reactions = await db
      .select()
      .from(schema.scriptedReactions)
      .where(eq(schema.scriptedReactions.studyVersionId, versionId));

    expect(posts).toHaveLength(284);
    expect(comments).toHaveLength(342);
    expect(actors).toHaveLength(76);
    expect(reactions).toHaveLength(174);
    expect(posts.every((post) => post.attachments[0]?.key?.startsWith("media/"))).toBe(true);
    expect(comments.filter((comment) => comment.conditions.length > 0)).toHaveLength(25);

    const firstLikes = new Map(
      content.map((item) => [`${item.kind}-${item.sourceRef}`, item.baseLikes]),
    );
    expect(new Set(posts.map((post) => post.baseLikes))).toEqual(new Set([1, 2, 3, 4, 5, 6]));

    // Re-importing into a fresh database draws the same like counts, since the seed comes from the content.
    const fresh = await createTestDatabase();
    try {
      const again = await importStudyFolder(fresh.db, storage, eatsnap);
      expect(again.status).toBe("imported");
      const contentAgain = await fresh.db.select().from(schema.content);
      const likesAgain = new Map(
        contentAgain.map((item) => [`${item.kind}-${item.sourceRef}`, item.baseLikes]),
      );
      expect(likesAgain).toEqual(firstLikes);
    } finally {
      await fresh.destroy();
    }
  });
});
