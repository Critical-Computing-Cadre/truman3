import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { deleteItem, freezeDraft, loadDraft, openDraft } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const POSTS = `id,title,body,actor,space,link,tags,crosspostOf,time
kept,Kept,Stays here,ann,cooking,,,,-5:00
gone,Gone title,Gone body,ann,cooking,https://example.org/secret,spoiler,,-5:00
later,Later,Not yet,ann,cooking,,,,-5:00
b_only,Only in b,Removed in b only,ann,cooking,,,,-5:00
shared,Shared,,ann,other,,,gone,-5:00
`;
const COMMENTS = `id,body,actor,postID,time
good,A good comment,ann,kept,-4:00
bad,A bad comment,ann,kept,-4:00
under,A reply under the bad one,ann,kept,-3:00
`;
const REMOVALS = `on,target,actor,time,reason,condition
post,gone,sam,-1:00,Rule 2,
comment,bad,sam,-1:00,,
post,later,sam,50:00,Rule 4,
post,b_only,sam,-1:00,Rule 5,b
`;

async function study({
  features = "",
  reactions = "",
  arms = "[{ key: a }, { key: b }]",
}: {
  features?: string;
  reactions?: string;
  arms?: string;
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-removal-"));
  dirs.push(dir);
  const slug = `removal-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Removal
site: { name: Demo }
length: { days: 5 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: ${arms}
platform: { style: mixed, template: forum ${features} }
feed: { ranker: chronological }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name,moderator\nann,Ann,\nsam,Sam the Mod,yes\n",
    "spaces.csv": "key,name\ncooking,Cooking\nother,Other\n",
    "posts.csv": POSTS,
    "comments.csv": COMMENTS,
    "removals.csv": REMOVALS,
    ...(reactions ? { "reactions.csv": reactions } : {}),
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return { slug, versionId: imported.studyVersionId };
}

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });
const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function join(slug: string, externalId = randomUUID()) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const list = async (cookie: string, query = "") =>
  ((await (await call(cookie, "GET", `/feed${query}`)).json()) as FeedResponse).posts;
const withId = async (versionId: string, ref: string) => {
  const rows = await database.db
    .select()
    .from(schema.content)
    .where(eq(schema.content.studyVersionId, versionId));
  return rows.find(({ sourceRef }) => sourceRef === ref)?.id as string;
};
const byId = (posts: FeedPost[], id: string) => posts.find((post) => post.id === id) as FeedPost;
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  call(cookie, "POST", `/content/${id}/${action}`, { ...meta(), ...body });

function postForm(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), ...fields })) {
    form.set(key, value);
  }
  return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
}

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  });
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

describe("a moderator removing what the study wrote", () => {
  it("sends none of what it said, and says who and why", async () => {
    const { slug, versionId } = await study();
    const posts = await list(await join(slug));
    const gone = byId(posts, await withId(versionId, "gone"));

    expect(gone.removed).toEqual({ by: "Sam the Mod", reason: "Rule 2" });
    expect(gone.body).toBe("");
    expect(gone.title).toBeUndefined();
    expect(gone.link).toBeUndefined();
    expect(gone.tags).toBeUndefined();
    expect(JSON.stringify(gone)).not.toContain("secret");
    expect(gone.author.name).toBe("Ann");
  });

  it("waits for its time, and applies only to its condition", async () => {
    const { slug, versionId } = await study();
    const posts = await list(await join(slug));
    const later = byId(posts, await withId(versionId, "later"));
    expect(later.removed).toBeUndefined();
    expect(later.body).toBe("Not yet");
    const [assigned] = await database.db
      .select({ key: schema.conditions.key })
      .from(schema.assignments)
      .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
      .where(eq(schema.assignments.studyVersionId, versionId));
    const onlyB = byId(posts, await withId(versionId, "b_only"));
    expect(onlyB.removed !== undefined).toBe(assigned?.key === "b");
    expect(onlyB.body).toBe(assigned?.key === "b" ? "" : "Removed in b only");
  });

  it("removes one comment and keeps the replies around it", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const keptId = await withId(versionId, "kept");
    const [post] = await list(cookie, `?surface=post&post=${keptId}`);
    const badId = await withId(versionId, "bad");
    const bad = post?.comments.find(({ id }) => id === badId);
    expect(bad?.removed).toEqual({ by: "Sam the Mod" });
    expect(bad?.body).toBe("");
    expect(post?.comments.map(({ body }) => body)).toContain("A good comment");
    expect(post?.comments.map(({ body }) => body)).toContain("A reply under the bad one");
  });

  it("refuses acting on it, adding to it, and crossposting it", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const gone = await withId(versionId, "gone");
    const bad = await withId(versionId, "bad");

    for (const [id, action, body] of [
      [gone, "like", { active: true }],
      [gone, "vote", { value: "up" }],
      [gone, "flag", { active: true }],
      [gone, "comments", { body: "Still?" }],
      [bad, "comments", { body: "Replying to it" }],
      [gone, "crosspost", { space: "other", title: "Again" }],
    ] as const) {
      const response = await act(cookie, id, action, body);
      expect([action, response.status]).toEqual([action, 403]);
    }
    // Comments on the same post as a removed comment still work.
    const fine = await act(cookie, await withId(versionId, "kept"), "comments", { body: "Fine" });
    expect(fine.status).toBe(200);
  });

  it("keeps a crosspost from showing it", async () => {
    const { slug, versionId } = await study();
    const posts = await list(await join(slug));
    const shared = byId(posts, await withId(versionId, "shared"));
    expect(shared.removed).toBeUndefined();
    expect(shared.crosspost).toEqual({ original: null });
    expect(shared.tags).toBeUndefined();
  });

  it("does nothing with the feature off, and validation says so", async () => {
    const { slug, versionId } = await study({ features: ", features: { removal: false }" });
    const posts = await list(await join(slug));
    const gone = byId(posts, await withId(versionId, "gone"));
    expect(gone.removed).toBeUndefined();
    expect(gone.body).toBe("Gone body");
  });

  it("freezes with its version", async () => {
    const { versionId } = await study();
    await expect(
      database.db
        .update(schema.scriptedRemovals)
        .set({ reason: "Changed" })
        .where(eq(schema.scriptedRemovals.studyVersionId, versionId)),
    ).rejects.toThrow();
  });
});

describe("a moderator removing what a participant wrote", () => {
  const REMOVE_FIRST = "on,nth,type,actor,after,body\npost,0,remove,sam,0:00,Rule 3\n";

  it("leaves them what they wrote, tells them, and records it", async () => {
    const { slug } = await study({ reactions: REMOVE_FIRST });
    const cookie = await join(slug);
    const made = await postForm(cookie, { title: "Mine", body: "I wrote this", space: "cooking" });
    const { id } = (await made.json()) as { id: string };

    const mine = byId(await list(cookie), id);
    expect(mine.removed).toEqual({ by: "Sam the Mod", reason: "Rule 3" });
    expect(mine.body).toBe("I wrote this");
    expect(mine.title).toBe("Mine");
    expect((await act(cookie, id, "comments", { body: "More" })).status).toBe(403);

    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string; reason: string | null; actors: { name: string }[] }[];
    };
    expect(notifications).toEqual([
      expect.objectContaining({
        type: "remove",
        reason: "Rule 3",
        actors: [expect.objectContaining({ name: "Sam the Mod" })],
      }),
    ]);

    const [event] = await database.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "reaction.scheduled"))
      .orderBy(desc(schema.events.id))
      .limit(1);
    expect(event?.payload).toMatchObject({ reaction: "remove", reason: "Rule 3" });
    expect(event?.targetContentId).toBe(id);
  });

  it("waits for its delay", async () => {
    const { slug } = await study({
      reactions: "on,nth,type,actor,after,body\npost,0,remove,sam,1:00,Later\n",
    });
    const cookie = await join(slug);
    const made = await postForm(cookie, { title: "Mine", body: "Text", space: "cooking" });
    const { id } = (await made.json()) as { id: string };
    expect(byId(await list(cookie), id).removed).toBeUndefined();
    expect((await act(cookie, id, "vote", { value: "up" })).status).toBe(200);
  });

  it("doesn't happen with the feature off, and withdrawal takes it away", async () => {
    const off = await study({
      reactions: REMOVE_FIRST,
      features: ", features: { removal: false }",
    });
    const offCookie = await join(off.slug);
    const made = await postForm(offCookie, { title: "Mine", body: "Text", space: "cooking" });
    const { id: offId } = (await made.json()) as { id: string };
    expect(byId(await list(offCookie), offId).removed).toBeUndefined();

    const { slug } = await study({ reactions: REMOVE_FIRST });
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    const mine = await postForm(cookie, { title: "Mine", body: "Text", space: "cooking" });
    const { id } = (await mine.json()) as { id: string };
    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });
    expect(result.status).toBe("withdrawn");
    const left = await database.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.targetContentId, id));
    expect(left).toEqual([]);
  });
});

describe("the record of a removal", () => {
  it("says what was on screen, and lists what a study removes", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    await list(cookie);
    const keptId = await withId(versionId, "kept");
    await list(cookie, `?surface=post&post=${keptId}`);

    const folder = mkdtempSync(path.join(tmpdir(), "truman-removal-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);

    const impressions = parse(readFileSync(path.join(folder, "impressions.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    const gone = await withId(versionId, "gone");
    const bad = await withId(versionId, "bad");
    expect(impressions.find(({ content_id }) => content_id === gone)?.removed).toBe("1");
    const page = impressions.find(
      ({ surface, content_id }) => surface === "post" && content_id === keptId,
    );
    expect(page?.removed).toBe("");
    expect(page?.removed_comment_ids).toBe(bad);

    const removals = readFileSync(path.join(folder, "removals.csv"), "utf8");
    expect(removals).toContain(gone);
    expect(removals).toContain("Rule 2");
    expect(removals).toContain("sam");
    expect(readFileSync(path.join(folder, "codebook.md"), "utf8")).toContain("removed_comment_ids");
  });
});

describe("a draft of a study with removals", () => {
  async function aResearcher() {
    const email = `${randomUUID()}@example.edu`;
    await setUpTeam(database.db, {
      teamName: "Lab",
      slug: `lab-${randomUUID().slice(0, 8)}`,
      email,
      name: "R",
    });
    const [researcher] = await database.db
      .select({ id: schema.researchers.id })
      .from(schema.researchers)
      .where(eq(schema.researchers.email, email));
    return researcher?.id as string;
  }

  it("keeps them through a new version, and loses one with what it removes", async () => {
    const { versionId } = await study();
    const researcherId = await aResearcher();
    const opened = await openDraft(database.db, versionId, researcherId);
    const draftId = opened?.draftId as string;

    const loaded = await loadDraft(database.db, draftId);
    const removalItems = loaded?.items.filter(({ kind }) => kind === "removal") ?? [];
    expect(removalItems).toHaveLength(4);

    const laterItem = loaded?.items.find(
      ({ kind, data }) => kind === "post" && (data as { ref: string }).ref === "later",
    );
    const deleted = await deleteItem(database.db, draftId, laterItem?.id as string, researcherId);
    expect(deleted).toEqual({ deleted: 2 });

    const reloaded = await loadDraft(database.db, draftId);
    const frozen = await freezeDraft(database.db, reloaded as NonNullable<typeof reloaded>);
    expect(frozen.status).toBe("frozen");
    const newVersionId = (frozen as { studyVersionId: string }).studyVersionId;
    expect(newVersionId).not.toBe(versionId);
    const rows = await database.db
      .select()
      .from(schema.scriptedRemovals)
      .where(eq(schema.scriptedRemovals.studyVersionId, newVersionId));
    expect(new Set(rows.map(({ reason }) => reason))).toEqual(new Set([null, "Rule 2", "Rule 5"]));
  });
});
