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
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadVersion, previewFeed } from "./admin/preview.ts";
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
  flagAnswers = "",
  bans = "",
  reportAnswers = "",
  extraPosts = "",
  autoRules = "",
  appealAnswers = "",
}: {
  features?: string;
  reactions?: string;
  arms?: string;
  flagAnswers?: string;
  bans?: string;
  reportAnswers?: string;
  extraPosts?: string;
  autoRules?: string;
  appealAnswers?: string;
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
    "actors.csv": "username,name,moderator\nann,Ann,\nsam,Sam the Mod,yes\nben,Ben,\n",
    "spaces.csv": "key,name\ncooking,Cooking\nother,Other\n",
    "posts.csv": POSTS + extraPosts,
    "comments.csv": COMMENTS,
    "removals.csv": REMOVALS,
    ...(reactions ? { "reactions.csv": reactions } : {}),
    ...(flagAnswers ? { "flag-answers.csv": flagAnswers } : {}),
    ...(bans ? { "bans.csv": bans } : {}),
    ...(autoRules ? { "auto-rules.csv": autoRules } : {}),
    ...(appealAnswers ? { "appeal-answers.csv": appealAnswers } : {}),
    ...(reportAnswers ? { "report-answers.csv": reportAnswers } : {}),
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
    expect(mine.removed).toEqual({ by: "Sam the Mod", reason: "Rule 3", appeal: "open" });
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

describe("a moderator's warning", () => {
  const WARN = "on,nth,type,actor,after,body\npost,0,warn,sam,0:00,Keep it civil\n";
  const write = async (cookie: string) => {
    const made = await postForm(cookie, { title: "Mine", body: "Text", space: "cooking" });
    return ((await made.json()) as { id: string }).id;
  };
  const warnings = async (cookie: string) =>
    (
      (await (await call(cookie, "GET", "/warnings")).json()) as {
        warnings: { id: string; by: string; message: string; kind: string }[];
      }
    ).warnings;

  it("stays until acknowledged, once, and leaves their post alone", async () => {
    const { slug } = await study({ reactions: WARN });
    const cookie = await join(slug);
    const postId = await write(cookie);

    const [warning] = await warnings(cookie);
    expect(warning).toMatchObject({ by: "Sam the Mod", message: "Keep it civil", kind: "post" });
    expect(byId(await list(cookie), postId).removed).toBeUndefined();
    expect(await warnings(cookie)).toHaveLength(1);

    const id = warning?.id as string;
    expect((await call(cookie, "POST", `/warnings/${id}/acknowledge`, meta())).status).toBe(200);
    expect((await call(cookie, "POST", `/warnings/${id}/acknowledge`, meta())).status).toBe(200);
    expect(await warnings(cookie)).toEqual([]);

    const events = await database.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.targetContentId, postId));
    const types = events.map(({ type }) => type);
    expect(types.filter((type) => type === "moderation.warning_acknowledged")).toHaveLength(1);
    expect(events.find(({ type }) => type === "reaction.scheduled")?.payload).toMatchObject({
      reaction: "warn",
      reason: "Keep it civil",
    });

    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string; reason: string | null }[];
    };
    expect(notifications).toEqual([
      expect.objectContaining({ type: "warn", reason: "Keep it civil" }),
    ]);
  });

  it("can't be acknowledged by someone else, or before it's due", async () => {
    const { slug } = await study({ reactions: WARN });
    const cookie = await join(slug);
    await write(cookie);
    const [warning] = await warnings(cookie);
    const other = await join(slug);
    const url = `/warnings/${warning?.id}/acknowledge`;
    expect((await call(other, "POST", url, meta())).status).toBe(404);

    const later = await study({
      reactions: "on,nth,type,actor,after,body\npost,0,warn,sam,1:00,Later\n",
    });
    const laterCookie = await join(later.slug);
    await write(laterCookie);
    expect(await warnings(laterCookie)).toEqual([]);
  });

  it("does nothing with the feature off", async () => {
    const { slug } = await study({ reactions: WARN, features: ", features: { warnings: false }" });
    const cookie = await join(slug);
    await write(cookie);
    expect((await call(cookie, "GET", "/warnings")).status).toBe(403);
    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: unknown[];
    };
    expect(notifications).toEqual([]);
  });
});

describe("the mod log", () => {
  const logOf = async (cookie: string, query = "") =>
    (
      (await (await call(cookie, "GET", `/mod-log${query}`)).json()) as {
        entries: {
          id: string;
          by: string;
          kind: string;
          authorName: string | null;
          reason?: string;
          space?: { key: string };
          postId: string;
          commentId?: string;
        }[];
      }
    ).entries;

  it("lists what's come due, without what it said, and only what this person could see", async () => {
    const { slug, versionId } = await study();
    const REMOVED_TEXT = ["Gone title", "Gone body", "A bad comment", "secret"];
    const entries = await logOf(await join(slug));

    const gone = await withId(versionId, "gone");
    const bad = await withId(versionId, "bad");
    const kept = await withId(versionId, "kept");
    // Which condition someone lands in is random, and "b_only" depends on it. See above for that.
    const onlyB = await withId(versionId, "b_only");
    expect(
      entries
        .map(({ id }) => id)
        .filter((id) => id !== onlyB)
        .sort(),
    ).toEqual([gone, bad].sort());
    expect(entries.find(({ id }) => id === gone)).toMatchObject({
      by: "Sam the Mod",
      kind: "post",
      authorName: "Ann",
      reason: "Rule 2",
      space: { key: "cooking" },
      postId: gone,
    });
    expect(entries.find(({ id }) => id === bad)).toMatchObject({
      kind: "comment",
      postId: kept,
      commentId: bad,
    });
    for (const text of REMOVED_TEXT) {
      expect(JSON.stringify(entries)).not.toContain(text);
    }
  });

  it("includes their own, and not anyone else's, and can show one community", async () => {
    const { slug } = await study({
      reactions: "on,nth,type,actor,after,body\npost,0,remove,sam,0:00,Rule 3\n",
    });
    const mine = await join(slug);
    const made = await postForm(mine, { title: "Mine", body: "Text", space: "other" });
    const { id } = (await made.json()) as { id: string };

    const own = await logOf(mine);
    expect(own.find((entry) => entry.id === id)).toMatchObject({
      authorName: null,
      reason: "Rule 3",
    });
    expect((await logOf(await join(slug))).map((entry) => entry.id)).not.toContain(id);

    const inOther = await logOf(mine, "?space=other");
    expect(inOther.map((entry) => entry.id)).toEqual([id]);
    expect((await logOf(mine, "?space=cooking")).map((entry) => entry.id)).not.toContain(id);
  });

  it("is refused with the feature off", async () => {
    const { slug } = await study({ features: ", features: { modLog: false }" });
    expect((await call(await join(slug), "GET", "/mod-log")).status).toBe(403);
  });
});

describe("previewing removals", () => {
  it("shows a saved version's removals when they're due, as a participant would see them", async () => {
    const { versionId } = await study();
    const loaded = await loadVersion(database.db, versionId);
    const version = {
      id: versionId,
      seed: loaded?.version.seed as number,
      settings: loaded?.settings as NonNullable<typeof loaded>["settings"],
    };
    const gone = await withId(versionId, "gone");
    const later = await withId(versionId, "later");

    const { posts } = await previewFeed(database.db, "http://media.test", version, "a", 0);
    const removed = byId(posts, gone);
    expect(removed.removed).toEqual({ by: "Sam the Mod", reason: "Rule 2" });
    expect(removed.body).toBe("");
    expect(removed.title).toBeUndefined();
    expect(byId(posts, later).removed).toBeUndefined();

    const afterwards = await previewFeed(
      database.db,
      "http://media.test",
      version,
      "a",
      51 * 3_600_000,
    );
    expect(byId(afterwards.posts, later).removed).toEqual({
      by: "Sam the Mod",
      reason: "Rule 4",
    });
  });
});

describe("answering a flag", () => {
  const ANSWERS = `on,target,action,actor,after,message
post,kept,remove,sam,0:00,Thanks for telling us
,,answer,sam,0:00,No rule was broken
`;
  const flag = (cookie: string, id: string, active = true) => act(cookie, id, "flag", { active });
  const notificationsOf = async (cookie: string) =>
    (
      (await (await call(cookie, "GET", "/notifications")).json()) as {
        notifications: {
          type: string;
          reason: string | null;
          targetIsTheirs: boolean;
          targetBody: string;
        }[];
      }
    ).notifications;

  it("answers with what names it first, and otherwise what's for anything", async () => {
    const { slug, versionId } = await study({ flagAnswers: ANSWERS });
    const cookie = await join(slug);
    const kept = await withId(versionId, "kept");
    const later = await withId(versionId, "later");

    expect((await flag(cookie, kept)).status).toBe(200);
    expect((await flag(cookie, later)).status).toBe(200);

    const posts = await list(cookie);
    const removed = byId(posts, kept);
    expect(removed.removed).toEqual({ by: "Sam the Mod", reason: "Thanks for telling us" });
    expect(removed.body).toBe("");
    expect(removed.flagged).toBe(false);
    const answered = byId(posts, later);
    expect(answered.removed).toBeUndefined();
    expect(answered.flagged).toBe(true);

    const notifications = await notificationsOf(cookie);
    expect(notifications).toHaveLength(2);
    const remove = notifications.find(({ type }) => type === "remove");
    expect(remove).toMatchObject({ reason: "Thanks for telling us", targetIsTheirs: false });
    // What was removed doesn't come back through a notification.
    expect(remove?.targetBody).toBe("");
    expect(notifications.find(({ type }) => type === "answer")).toMatchObject({
      reason: "No rule was broken",
      targetBody: "Not yet",
    });
  });

  it("answers once, even if they unflag it and flag it again", async () => {
    const { slug, versionId } = await study({
      flagAnswers: "action,actor,after,message\nanswer,sam,0:00,No rule was broken\n",
    });
    const cookie = await join(slug);
    const later = await withId(versionId, "later");
    await flag(cookie, later);
    await flag(cookie, later, false);
    await flag(cookie, later);
    expect(await notificationsOf(cookie)).toHaveLength(1);
  });

  it("waits for its delay", async () => {
    const { slug, versionId } = await study({
      flagAnswers: "action,actor,after,message\nremove,sam,1:00,Later\n",
    });
    const cookie = await join(slug);
    const later = await withId(versionId, "later");
    await flag(cookie, later);
    expect(byId(await list(cookie), later).removed).toBeUndefined();
    expect(await notificationsOf(cookie)).toEqual([]);
  });

  it("records it, and lists a removal in the mod log", async () => {
    const { slug, versionId } = await study({ flagAnswers: ANSWERS });
    const cookie = await join(slug);
    const kept = await withId(versionId, "kept");
    await flag(cookie, kept);
    const events = await database.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.targetContentId, kept));
    expect(events.find(({ type }) => type === "reaction.scheduled")?.payload).toMatchObject({
      reaction: "remove",
      reason: "Thanks for telling us",
    });
    const log = (await (await call(cookie, "GET", "/mod-log")).json()) as {
      entries: { id: string }[];
    };
    expect(log.entries.map(({ id }) => id)).toContain(kept);

    const folder = mkdtempSync(path.join(tmpdir(), "truman-flag-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const answers = readFileSync(path.join(folder, "flag_answers.csv"), "utf8");
    expect(answers).toContain("No rule was broken");
    expect(answers).toContain(kept);
  });

  it("doesn't happen with the feature off, or remove with removal off", async () => {
    const off = await study({
      flagAnswers: ANSWERS,
      features: ", features: { flagAnswers: false }",
    });
    const offCookie = await join(off.slug);
    await flag(offCookie, await withId(off.versionId, "kept"));
    expect(await notificationsOf(offCookie)).toEqual([]);

    const noRemoval = await study({
      flagAnswers: ANSWERS,
      features: ", features: { removal: false }",
    });
    const cookie = await join(noRemoval.slug);
    await flag(cookie, await withId(noRemoval.versionId, "kept"));
    // The one naming it can't happen, so the one for anything answers instead.
    expect(await notificationsOf(cookie)).toEqual([
      expect.objectContaining({ type: "answer", reason: "No rule was broken" }),
    ]);
  });

  it("freezes with its version, and stays through a draft", async () => {
    const { versionId } = await study({ flagAnswers: ANSWERS });
    await expect(
      database.db
        .update(schema.scriptedFlagAnswers)
        .set({ message: "Changed" })
        .where(eq(schema.scriptedFlagAnswers.studyVersionId, versionId)),
    ).rejects.toThrow();

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
    const researcherId = researcher?.id as string;
    const opened = await openDraft(database.db, versionId, researcherId);
    const draftId = opened?.draftId as string;
    const loaded = await loadDraft(database.db, draftId);
    const answers = loaded?.items.filter(({ kind }) => kind === "flagAnswer") ?? [];
    expect(answers).toHaveLength(2);

    // The one naming "kept" goes with it, and the one for anything stays.
    const keptItem = loaded?.items.find(
      ({ kind, data }) => kind === "post" && (data as { ref: string }).ref === "kept",
    );
    await deleteItem(database.db, draftId, keptItem?.id as string, researcherId);
    const after = await loadDraft(database.db, draftId);
    const frozen = await freezeDraft(database.db, after as NonNullable<typeof after>);
    expect(frozen.status).toBe("frozen");
    const rows = await database.db
      .select()
      .from(schema.scriptedFlagAnswers)
      .where(
        eq(
          schema.scriptedFlagAnswers.studyVersionId,
          (frozen as { studyVersionId: string }).studyVersionId,
        ),
      );
    expect(rows).toEqual([expect.objectContaining({ contentId: null, action: "answer" })]);
  });
});

describe("a moderator banning someone in the cast", () => {
  const BEN = `before,Before,Ben before,ben,cooking,,,,-5:00
after,After,Ben after,ben,cooking,,,,-1:00
elsewhere,Elsewhere,Ben elsewhere,ben,other,,,,-1:00
ann_later,Ann later,Ann after,ann,cooking,,,,-1:00
`;
  const EVERYWHERE = "user,actor,time,reason\nben,sam,-3:00,Rule 5\n";

  it("keeps what they wrote before, hides what comes after, and tags them", async () => {
    const { slug, versionId } = await study({ extraPosts: BEN, bans: EVERYWHERE });
    const cookie = await join(slug);
    const posts = await list(cookie);
    const ids = posts.map(({ id }) => id);

    const before = byId(posts, await withId(versionId, "before"));
    expect(before.author.banned).toBe(true);
    expect(before.body).toBe("Ben before");
    const after = await withId(versionId, "after");
    expect(ids).not.toContain(after);
    expect(ids).not.toContain(await withId(versionId, "elsewhere"));
    expect(byId(posts, await withId(versionId, "ann_later")).author.banned).toBeUndefined();

    // It can't be reached by its address, or acted on either.
    const page = await call(cookie, "GET", `/feed?surface=post&post=${after}`);
    expect(page.status).toBe(404);
    expect((await act(cookie, after, "vote", { value: "up" })).status).toBe(404);
  });

  it("can be from one community, which leaves the rest alone", async () => {
    const { slug, versionId } = await study({
      extraPosts: BEN,
      bans: "user,actor,time,space\nben,sam,-3:00,cooking\n",
    });
    const posts = await list(await join(slug));
    const ids = posts.map(({ id }) => id);
    expect(ids).not.toContain(await withId(versionId, "after"));
    const elsewhere = byId(posts, await withId(versionId, "elsewhere"));
    expect(elsewhere.body).toBe("Ben elsewhere");
    expect(elsewhere.author.banned).toBeUndefined();
    expect(byId(posts, await withId(versionId, "before")).author.banned).toBe(true);
  });

  it("waits for its time, and applies only to its condition", async () => {
    const later = await study({
      extraPosts: BEN,
      bans: "user,actor,time\nben,sam,50:00\n",
    });
    const posts = await list(await join(later.slug));
    expect(byId(posts, await withId(later.versionId, "after")).body).toBe("Ben after");
    expect(byId(posts, await withId(later.versionId, "after")).author.banned).toBeUndefined();

    const inOne = await study({
      extraPosts: BEN,
      bans: "user,actor,time,condition\nben,sam,-3:00,b\n",
    });
    const cookie = await join(inOne.slug);
    const [assigned] = await database.db
      .select({ key: schema.conditions.key })
      .from(schema.assignments)
      .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
      .where(eq(schema.assignments.studyVersionId, inOne.versionId));
    const ids = (await list(cookie)).map(({ id }) => id);
    expect(ids.includes(await withId(inOne.versionId, "after"))).toBe(assigned?.key !== "b");
  });

  it("stops their scripted reactions, and nobody else's", async () => {
    const { slug } = await study({
      extraPosts: BEN,
      bans: EVERYWHERE,
      reactions:
        "on,nth,type,actor,after,body\npost,0,reply,ben,0:00,From Ben\npost,0,reply,ann,0:00,From Ann\n",
    });
    const cookie = await join(slug);
    const made = await postForm(cookie, { title: "Mine", body: "Text", space: "cooking" });
    const { id } = (await made.json()) as { id: string };
    const [post] = await list(cookie, `?surface=post&post=${id}`);
    expect(post?.comments.map(({ body }) => body)).toEqual(["From Ann"]);
  });

  it("is in the mod log and on their profile, and is off with the feature off", async () => {
    const { slug } = await study({ extraPosts: BEN, bans: EVERYWHERE });
    const cookie = await join(slug);
    const log = (await (await call(cookie, "GET", "/mod-log")).json()) as {
      entries: { kind: string; authorName: string; by: string; reason?: string }[];
    };
    expect(log.entries.find(({ kind }) => kind === "person")).toMatchObject({
      authorName: "Ben",
      by: "Sam the Mod",
      reason: "Rule 5",
    });
    const profile = (await (await call(cookie, "GET", "/actors/ben")).json()) as {
      bans: unknown[];
      posts: FeedPost[];
    };
    expect(profile.bans).toEqual([{ by: "Sam the Mod", reason: "Rule 5" }]);
    expect(profile.posts.map(({ body }) => body)).toEqual(["Ben before"]);

    const off = await study({
      extraPosts: BEN,
      bans: EVERYWHERE,
      features: ", features: { bans: false }",
    });
    const offPosts = await list(await join(off.slug));
    expect(byId(offPosts, await withId(off.versionId, "after")).body).toBe("Ben after");
  });

  it("freezes, shows in a version's preview, stays through a draft, and is exported", async () => {
    const { slug, versionId } = await study({ extraPosts: BEN, bans: EVERYWHERE });
    await expect(
      database.db
        .update(schema.scriptedBans)
        .set({ reason: "Changed" })
        .where(eq(schema.scriptedBans.studyVersionId, versionId)),
    ).rejects.toThrow();

    const loaded = await loadVersion(database.db, versionId);
    const { posts } = await previewFeed(
      database.db,
      "http://media.test",
      {
        id: versionId,
        seed: loaded?.version.seed as number,
        settings: loaded?.settings as NonNullable<typeof loaded>["settings"],
      },
      "a",
      0,
    );
    expect(posts.map(({ id }) => id)).not.toContain(await withId(versionId, "after"));

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
    const researcherId = researcher?.id as string;
    const opened = await openDraft(database.db, versionId, researcherId);
    const draftId = opened?.draftId as string;
    const draft = await loadDraft(database.db, draftId);
    expect(draft?.items.filter(({ kind }) => kind === "ban")).toHaveLength(1);

    // Someone banned can't be taken out of the cast while the ban names them.
    const ben = draft?.items.find(
      ({ kind, data }) => kind === "actor" && (data as { username: string }).username === "ben",
    );
    const refused = await deleteItem(database.db, draftId, ben?.id as string, researcherId);
    expect(refused).toMatchObject({ problem: "in-use" });

    const folder = mkdtempSync(path.join(tmpdir(), "truman-ban-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const exported = readFileSync(path.join(folder, "bans.csv"), "utf8");
    expect(exported).toContain("ben");
    expect(exported).toContain("Rule 5");
  });
});

describe("answering a report of a person", () => {
  const ANSWERS = `user,action,actor,after,message
ann,ban,sam,0:00,Thanks for telling us
,answer,sam,0:00,No rule was broken
`;
  const report = (cookie: string, username: string) =>
    call(cookie, "POST", `/actors/${username}/relation`, {
      ...meta(),
      action: "report",
      reason: "spam",
    });
  const notificationsOf = async (cookie: string) =>
    (
      (await (await call(cookie, "GET", "/notifications")).json()) as {
        notifications: {
          type: string;
          reason: string | null;
          targetKind: string;
          targetName: string;
          postId: string | null;
        }[];
      }
    ).notifications;

  it("answers with what names them first, and a ban is only for this person", async () => {
    const { slug, versionId } = await study({ reportAnswers: ANSWERS });
    const cookie = await join(slug);
    expect((await report(cookie, "ann")).status).toBe(200);
    expect((await report(cookie, "ben")).status).toBe(200);

    const notifications = await notificationsOf(cookie);
    expect(notifications).toHaveLength(2);
    expect(notifications.find(({ type }) => type === "ban")).toMatchObject({
      targetKind: "person",
      targetName: "Ann",
      reason: "Thanks for telling us",
      postId: null,
    });
    expect(notifications.find(({ type }) => type === "answer")).toMatchObject({
      targetName: "Ben",
      reason: "No rule was broken",
    });

    const profile = (await (await call(cookie, "GET", "/actors/ann")).json()) as {
      bans: unknown[];
    };
    expect(profile.bans).toEqual([{ by: "Sam the Mod", reason: "Thanks for telling us" }]);
    const kept = await withId(versionId, "kept");
    expect(byId(await list(cookie), kept).author.banned).toBe(true);

    const someoneElse = await join(slug);
    expect(byId(await list(someoneElse), kept).author.banned).toBeUndefined();

    const [event] = await database.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "reaction.scheduled"))
      .orderBy(desc(schema.events.id))
      .limit(1);
    expect(event?.targetActorId).toBeDefined();
  });

  it("answers once for each person, and not with the feature off", async () => {
    const { slug } = await study({
      reportAnswers: "action,actor,after,message\nanswer,sam,0:00,No rule was broken\n",
    });
    const cookie = await join(slug);
    await report(cookie, "ben");
    await report(cookie, "ben");
    expect(await notificationsOf(cookie)).toHaveLength(1);

    const off = await study({
      reportAnswers: ANSWERS,
      features: ", features: { reportAnswers: false }",
    });
    const offCookie = await join(off.slug);
    await report(offCookie, "ben");
    expect(await notificationsOf(offCookie)).toEqual([]);
  });

  it("falls back to the answer for anyone when a ban can't happen", async () => {
    const { slug } = await study({
      reportAnswers: ANSWERS,
      features: ", features: { bans: false }",
    });
    const cookie = await join(slug);
    await report(cookie, "ann");
    expect(await notificationsOf(cookie)).toEqual([
      expect.objectContaining({ type: "answer", targetName: "Ann" }),
    ]);
  });

  it("goes with a withdrawal", async () => {
    const { slug } = await study({ reportAnswers: ANSWERS });
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    await report(cookie, "ann");
    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });
    expect(result.status).toBe("withdrawn");
  });
});

describe("automatic rules", () => {
  const HEAD = "id,on,match,action,actor,after,message,holdOutcome\n";
  const write = async (cookie: string, title: string, fields: Record<string, string> = {}) => {
    const made = await postForm(cookie, { title, body: "Text", space: "cooking", ...fields });
    return (await made.json()) as {
      id?: string;
      confirm?: { rule: string; message: string; by: string };
    };
  };
  const firedFor = async (versionId: string) =>
    database.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.studyVersionId, versionId),
          eq(schema.events.type, "moderation.rule_fired"),
        ),
      );

  it("asks if they're sure first, posts nothing, and records what they do", async () => {
    const { slug, versionId } = await study({
      autoRules: `${HEAD}ask,post,badword,confirm,sam,0:00,Are you sure?,\n`,
    });
    const cookie = await join(slug);

    const asked = await write(cookie, "A badword here");
    expect(asked.id).toBeUndefined();
    expect(asked.confirm).toEqual({ rule: "ask", message: "Are you sure?", by: "Sam the Mod" });
    const before = await list(cookie);
    expect(before.some(({ title }) => title === "A badword here")).toBe(false);

    const [fired] = await firedFor(versionId);
    expect(fired?.payload).toEqual({ rule: "ask", action: "confirm" });
    expect(fired?.targetContentId).toBeNull();

    const back = await call(cookie, "POST", "/moderation/confirm-answered", {
      ...meta(),
      rule: "ask",
    });
    expect(back.status).toBe(200);

    const posted = await write(cookie, "A badword here", { confirmedRule: "ask" });
    expect(posted.id).toBeDefined();
    const answers = await database.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.studyVersionId, versionId),
          eq(schema.events.type, "moderation.confirm_answered"),
        ),
      );
    expect(answers.map(({ payload }) => payload)).toEqual(
      expect.arrayContaining([
        { rule: "ask", choice: "went_back" },
        { rule: "ask", choice: "posted" },
      ]),
    );
    expect((await write(cookie, "Nothing wrong")).id).toBeDefined();
  });

  it("keeps text someone didn't post only if the study turns that on", async () => {
    const rules = `${HEAD}ask,post,badword,confirm,sam,0:00,Sure?,\n`;
    const off = await study({ autoRules: rules });
    await write(await join(off.slug), "A badword here");
    const [notKept] = await firedFor(off.versionId);
    expect(JSON.stringify(notKept?.payload)).not.toContain("badword");

    const on = await study({ autoRules: rules, features: ", recordUnpostedText: true" });
    await write(await join(on.slug), "A badword here");
    const [kept] = await firedFor(on.versionId);
    expect(kept?.payload).toMatchObject({ unpostedText: "A badword here\nText" });
  });

  it("removes or warns once posted, and checks comments too", async () => {
    const { slug, versionId } = await study({
      autoRules: `${HEAD}gone,post,removeme,remove,sam,0:00,Rule 1,
warned,comment,warnme,warn,sam,0:00,Careful,
`,
    });
    const cookie = await join(slug);
    const { id } = await write(cookie, "Please removeme");
    expect(byId(await list(cookie), id as string).removed).toMatchObject({ reason: "Rule 1" });

    const kept = await withId(versionId, "kept");
    await act(cookie, kept, "comments", { body: "warnme now" });
    const warnings = (await (await call(cookie, "GET", "/warnings")).json()) as {
      warnings: { message: string }[];
    };
    expect(warnings.warnings.map(({ message }) => message)).toEqual(["Careful"]);
    expect((await firedFor(versionId)).map(({ payload }) => payload)).toEqual(
      expect.arrayContaining([
        { rule: "gone", action: "remove" },
        { rule: "warned", action: "warn" },
      ]),
    );
  });

  it("uses the first that matches, and can ask and then act", async () => {
    const { slug } = await study({
      autoRules: `${HEAD}ask,post,word,confirm,sam,0:00,Sure?,
first,post,word,remove,sam,0:00,First,
second,post,word,warn,sam,0:00,Second,
`,
    });
    const cookie = await join(slug);
    const { id } = await write(cookie, "A word here", { confirmedRule: "ask" });
    expect(byId(await list(cookie), id as string).removed?.reason).toBe("First");
    const { warnings } = (await (await call(cookie, "GET", "/warnings")).json()) as {
      warnings: unknown[];
    };
    expect(warnings).toEqual([]);
  });

  it("holds until it's decided, with reactions after, and ends as written", async () => {
    const { slug } = await study({
      autoRules: `${HEAD}wait,post,waiting,hold,sam,5:00,,approve
yes,post,approved,hold,sam,0:00,Looks fine,approve
no,post,refused,hold,sam,0:00,Not allowed,remove
`,
      reactions: "on,nth,type,actor,after,body\npost,0,reply,ann,0:00,From Ann\n",
    });
    const cookie = await join(slug);
    const { id: waiting } = await write(cookie, "Still waiting");
    const posts = await list(cookie);
    expect(byId(posts, waiting as string).held).toBe(true);
    // Reactions wait for it, since nobody could have seen it.
    expect(byId(posts, waiting as string).commentCount).toBe(0);

    const { id: approved } = await write(cookie, "Now approved");
    const { id: refused } = await write(cookie, "Now refused");
    const after = await list(cookie);
    expect(byId(after, approved as string).held).toBeUndefined();
    expect(byId(after, approved as string).removed).toBeUndefined();
    expect(byId(after, refused as string).removed).toMatchObject({ reason: "Not allowed" });

    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string; reason: string | null }[];
    };
    const types = notifications.map(({ type }) => type);
    expect(types).toContain("approve");
    expect(types).toContain("remove");
    expect(types).not.toContain("hold");
  });

  it("does nothing with the feature off, or the action's feature off", async () => {
    const off = await study({
      autoRules: `${HEAD}gone,post,word,remove,sam,0:00,Rule 1,\n`,
      features: ", features: { autoRules: false }",
    });
    const cookie = await join(off.slug);
    const { id } = await write(cookie, "A word");
    expect(byId(await list(cookie), id as string).removed).toBeUndefined();

    const noRemoval = await study({
      autoRules: `${HEAD}gone,post,word,remove,sam,0:00,Rule 1,\n`,
      features: ", features: { removal: false }",
    });
    await write(await join(noRemoval.slug), "A word");
    expect(await firedFor(noRemoval.versionId)).toEqual([]);
  });

  it("freezes, stays through a draft, and is exported", async () => {
    const { slug, versionId } = await study({
      autoRules: `${HEAD}gone,post,word,remove,sam,0:00,Rule 1,\n`,
      appealAnswers: "action,actor,after,message\nuphold,sam,0:00,It stands\n",
    });
    await expect(
      database.db
        .update(schema.scriptedAutoRules)
        .set({ match: "changed" })
        .where(eq(schema.scriptedAutoRules.studyVersionId, versionId)),
    ).rejects.toThrow();

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
    const opened = await openDraft(database.db, versionId, researcher?.id as string);
    const draft = await loadDraft(database.db, opened?.draftId as string);
    expect(draft?.items.filter(({ kind }) => kind === "autoRule")).toHaveLength(1);
    expect(draft?.items.filter(({ kind }) => kind === "appealAnswer")).toHaveLength(1);

    const folder = mkdtempSync(path.join(tmpdir(), "truman-rule-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    expect(readFileSync(path.join(folder, "auto_rules.csv"), "utf8")).toContain("Rule 1");
    expect(readFileSync(path.join(folder, "appeal_answers.csv"), "utf8")).toContain("It stands");
  });
});

describe("appeals", () => {
  const REMOVE_FIRST = "on,nth,type,actor,after,body\npost,0,remove,sam,0:00,Rule 3\n";
  const removedPost = async (cookie: string) => {
    const made = await postForm(cookie, { title: "Mine", body: "Text", space: "cooking" });
    return ((await made.json()) as { id: string }).id;
  };
  const appeal = (cookie: string, id: string, text = "It's fine") =>
    act(cookie, id, "appeal", { text });

  it("lets its author appeal once, and records what they wrote", async () => {
    const { slug, versionId } = await study({ reactions: REMOVE_FIRST });
    const cookie = await join(slug);
    const id = await removedPost(cookie);
    expect(byId(await list(cookie), id).removed?.appeal).toBe("open");

    expect((await appeal(cookie, id)).status).toBe(200);
    expect(byId(await list(cookie), id).removed?.appeal).toBe("sent");
    expect((await appeal(cookie, id)).status).toBe(409);

    const events = await database.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.studyVersionId, versionId),
          eq(schema.events.type, "moderation.appealed"),
        ),
      );
    expect(events.map(({ payload }) => payload)).toEqual([{ text: "It's fine" }]);
  });

  it("puts it back, or keeps the removal, as the study writes", async () => {
    const restored = await study({
      reactions: REMOVE_FIRST,
      appealAnswers: "action,actor,after,message\nrestore,sam,0:00,Back it goes\n",
    });
    const cookie = await join(restored.slug);
    const id = await removedPost(cookie);
    await appeal(cookie, id);
    expect(byId(await list(cookie), id).removed).toBeUndefined();
    expect((await act(cookie, id, "comments", { body: "Back" })).status).toBe(200);
    const log = (await (await call(cookie, "GET", "/mod-log")).json()) as {
      entries: { id: string }[];
    };
    expect(log.entries.map((entry) => entry.id)).not.toContain(id);

    const upheld = await study({
      reactions: REMOVE_FIRST,
      appealAnswers: "action,actor,after,message\nuphold,sam,0:00,It stands\n",
    });
    const other = await join(upheld.slug);
    const stays = await removedPost(other);
    await appeal(other, stays);
    expect(byId(await list(other), stays).removed).toBeDefined();
    const { notifications } = (await (await call(other, "GET", "/notifications")).json()) as {
      notifications: { type: string; reason: string | null }[];
    };
    expect(notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "uphold", reason: "It stands" })]),
    );
  });

  it("is only for what's theirs and removed, and goes with a withdrawal", async () => {
    const { slug, versionId } = await study({ reactions: REMOVE_FIRST });
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    const gone = await withId(versionId, "gone");
    expect((await appeal(cookie, gone)).status).toBe(404);
    const kept = await withId(versionId, "kept");
    expect((await appeal(cookie, kept)).status).toBe(404);
    expect(byId(await list(cookie), gone).removed?.appeal).toBeUndefined();

    const id = await removedPost(cookie);
    await appeal(cookie, id);
    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });
    expect(result.status).toBe("withdrawn");
    const left = await database.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.studyVersionId, versionId),
          eq(schema.events.type, "moderation.appealed"),
        ),
      );
    expect(left).toEqual([]);
  });

  it("is refused with the feature off", async () => {
    const { slug } = await study({
      reactions: REMOVE_FIRST,
      features: ", features: { appeals: false }",
    });
    const cookie = await join(slug);
    const id = await removedPost(cookie);
    expect(byId(await list(cookie), id).removed?.appeal).toBeUndefined();
    expect((await appeal(cookie, id)).status).toBe(403);
  });
});
