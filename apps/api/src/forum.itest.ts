import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { type FeedPost, type FeedResponse, type SpaceView, TEMPLATES } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createItem, loadDraft, openDraft, saveSection, startStudy } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const POSTS = `id,title,body,actor,space,ups,downs,time
first,Best way to sear a steak?,Long body,ann,cooking,40,0,-5:00
second,Small news,Another,ben,news,3,0,-4:00
`;
const COMMENTS = `id,body,actor,postID,replyToID,ups,downs,time
early,Written first,ben,first,,1,0,-4:30
late,Written last,ann,first,,9,0,-3:00
middle,Written next,ben,first,,12,0,-3:30
reply,A reply to the first one,ann,first,early,20,0,-2:00
`;

const SPACES = "key,name,description,accent\ncooking,Cooking,About food,#1d4ed8\nnews,News,,\n";
const SPACES_WITH_MEMBERS = "key,name,members\ncooking,Cooking,1200\nnews,News,\n";

async function study({
  feed = "",
  template = "forum",
  platform = "",
  arms = "[{ key: main }]",
  spaces = SPACES,
}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-forum-"));
  dirs.push(dir);
  const slug = `forum-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Forum
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: ${arms}
platform: { style: mixed, template: ${template} ${platform} }
feed: { ranker: top ${feed} }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name,karma\nann,Ann,1200\nben,Ben,-3\n",
    "spaces.csv": spaces,
    "posts.csv": POSTS,
    "comments.csv": COMMENTS,
    "reactions.csv": "on,nth,type,actor,after\npost,0,up,ann,0:00\npost,0,up,ben,0:00\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return { slug, dir, versionId: imported.studyVersionId };
}

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });
const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function join(slug: string) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: randomUUID() }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const home = async (cookie: string) =>
  (await (await call(cookie, "GET", "/feed")).json()) as FeedResponse;
const page = async (cookie: string, id: string) => {
  const response = await call(cookie, "GET", `/feed?surface=post&post=${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as FeedResponse;
};
const titled = (posts: FeedPost[], title: string) =>
  posts.find((post) => post.title === title) as FeedPost;

function postForm(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), ...fields })) {
    form.set(key, value);
  }
  return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
}

async function team() {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  const [researcher] = await database.db
    .select({ id: schema.researchers.id })
    .from(schema.researchers)
    .where(eq(schema.researchers.email, email));
  return { teamId, researcherId: researcher?.id as string, slug: `start-${id}` };
}

const lastImpression = async () => {
  const [row] = await database.db
    .select()
    .from(schema.feedImpressions)
    .orderBy(desc(schema.feedImpressions.id))
    .limit(1);
  return row as typeof schema.feedImpressions.$inferSelect;
};

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

describe("a list that leaves comments for each post's page", () => {
  it("sends a count, not the comments, and doesn't record them as shown", async () => {
    const { slug } = await study({});
    const cookie = await join(slug);

    const feed = await home(cookie);
    const post = titled(feed.posts, "Best way to sear a steak?");
    expect(post.comments).toEqual([]);
    expect(post.commentCount).toBe(4);

    const shown = await lastImpression();
    expect(shown.surface).toBe("feed");
    expect((shown.items as { commentIds: string[] }[])[0]?.commentIds).toEqual([]);
  });

  it("gives them on the post's page, recorded separately", async () => {
    const { slug } = await study({});
    const cookie = await join(slug);
    const { id } = titled((await home(cookie)).posts, "Best way to sear a steak?");

    const { posts } = await page(cookie, id);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.comments).toHaveLength(4);

    const shown = await lastImpression();
    expect(shown.surface).toBe("post");
    expect((shown.items as { commentIds: string[] }[])[0]?.commentIds).toHaveLength(4);
  });

  it("shows a post in a space they haven't joined, by its page", async () => {
    const { slug } = await study({});
    const cookie = await join(slug);
    const { id } = titled((await home(cookie)).posts, "Small news");
    const left = await call(cookie, "POST", "/spaces/news/membership", {
      joined: false,
      ...meta(),
    });
    expect(left.status).toBe(200);

    expect((await home(cookie)).posts.map(({ title }) => title)).not.toContain("Small news");
    expect((await page(cookie, id)).posts[0]?.title).toBe("Small news");
  });

  it("keeps comments under posts when the feature's off, as Classic does", async () => {
    const { slug } = await study({ platform: ", features: { postPages: false }" });
    const cookie = await join(slug);
    const post = titled((await home(cookie)).posts, "Best way to sear a steak?");
    expect(post.comments).toHaveLength(4);
    expect((await call(cookie, "GET", `/feed?surface=post&post=${post.id}`)).status).toBe(403);
    const opened = await call(cookie, "POST", `/content/${post.id}/open`, {
      from: "feed",
      ...meta(),
    });
    expect(opened.status).toBe(403);
  });

  it("says so for a post they can't see", async () => {
    const { slug } = await study({});
    const cookie = await join(slug);
    expect((await call(cookie, "GET", `/feed?surface=post&post=${randomUUID()}`)).status).toBe(404);
    const opened = await call(cookie, "POST", `/content/${randomUUID()}/open`, {
      from: "feed",
      ...meta(),
    });
    expect(opened.status).toBe(404);
  });
});

describe("opening a post", () => {
  it("is recorded with where they came from, and a repeat counts once", async () => {
    const { slug, versionId } = await study({});
    const cookie = await join(slug);
    const { id } = titled((await home(cookie)).posts, "Small news");
    const event = meta();
    for (let i = 0; i < 2; i += 1) {
      const opened = await call(cookie, "POST", `/content/${id}/open`, { from: "space", ...event });
      expect(opened.status).toBe(200);
    }

    const events = await database.db
      .select()
      .from(schema.events)
      .where(
        and(eq(schema.events.studyVersionId, versionId), eq(schema.events.type, "content.opened")),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ targetContentId: id, payload: { from: "space" } });
  });
});

describe("the order of comments", () => {
  const order = (post: FeedPost | undefined) => post?.comments.map(({ body }) => body);
  const firstId = async (cookie: string) =>
    titled((await home(cookie)).posts, "Best way to sear a steak?").id;

  it("comes from the template, and is copied in when a study is frozen", async () => {
    const { slug, versionId } = await study({});
    const cookie = await join(slug);
    const { posts } = await page(cookie, await firstId(cookie));

    // Highest score first, and a reply stays under what it replies to.
    expect(order(posts[0])).toEqual([
      "Written next",
      "Written last",
      "Written first",
      "A reply to the first one",
    ]);
    expect(posts[0]?.comments.map(({ depth }) => depth)).toEqual([0, 0, 0, 1]);

    const shown = await lastImpression();
    expect(shown).toMatchObject({ commentOrder: "top", commentOrderVersion: "1" });
    const [version] = await database.db
      .select()
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    const frozen = version?.settings as { feed: { commentOrder: string } };
    expect(frozen.feed.commentOrder).toBe("top");
    expect(TEMPLATES.forum.feed.commentOrder).toBe("top");
  });

  it("can be new or as written, set by the study", async () => {
    const newest = await study({ feed: ", commentOrder: new" });
    const cookie = await join(newest.slug);
    expect(order((await page(cookie, await firstId(cookie))).posts[0])).toEqual([
      "Written last",
      "Written next",
      "Written first",
      "A reply to the first one",
    ]);

    const written = await study({ feed: ", commentOrder: scripted" });
    const other = await join(written.slug);
    expect(order((await page(other, await firstId(other))).posts[0])).toEqual([
      "Written first",
      "A reply to the first one",
      "Written next",
      "Written last",
    ]);
  });

  it("isn't theirs to change unless the study says so", async () => {
    const { slug } = await study({});
    const cookie = await join(slug);
    const refused = await call(cookie, "POST", "/comments/sort", { sort: "new", ...meta() });
    expect(refused.status).toBe(403);
    expect((await page(cookie, await firstId(cookie))).commentSort).toBeNull();
  });

  it("stays as they chose it, is recorded, and goes back", async () => {
    const { slug } = await study({
      feed: ", commentOrder: scripted, participantsCanSortComments: true",
    });
    const cookie = await join(slug);
    const id = await firstId(cookie);

    const chose = await call(cookie, "POST", "/comments/sort", { sort: "top", ...meta() });
    expect(chose.status).toBe(200);
    const { posts, commentSort } = await page(cookie, id);
    expect(commentSort).toBe("top");
    expect(order(posts[0])?.[0]).toBe("Written next");
    expect(await lastImpression()).toMatchObject({ commentOrder: "top", commentSort: "top" });

    await call(cookie, "POST", "/comments/sort", { sort: null, ...meta() });
    const back = await page(cookie, id);
    expect(back.commentSort).toBeNull();
    expect(order(back.posts[0])?.[0]).toBe("Written first");
  });
});

describe("titles", () => {
  it("come from a study folder, and show on a post", async () => {
    const { slug } = await study({});
    const { posts } = await home(await join(slug));
    expect(posts.map(({ title }) => title)).toEqual(["Best way to sear a steak?", "Small news"]);
  });

  it("are required of participants when on", async () => {
    const { slug } = await study({});
    const cookie = await join(slug);
    expect((await postForm(cookie, { body: "No title" })).status).toBe(400);
    expect((await postForm(cookie, { title: "   ", body: "Blank" })).status).toBe(400);
    expect((await postForm(cookie, { title: "Mine", body: "Mine too" })).status).toBe(200);
    expect((await home(cookie)).posts.map(({ title }) => title)).toContain("Mine");
  });

  it("are refused when off", async () => {
    const { slug } = await study({ platform: ", features: { titles: false }" });
    const cookie = await join(slug);
    expect((await postForm(cookie, { title: "Mine", body: "text" })).status).toBe(403);
    expect((await postForm(cookie, { body: "text" })).status).toBe(200);
  });
});

describe("karma", () => {
  it("shows what the study wrote for the cast", async () => {
    const { slug } = await study({});
    const { posts } = await home(await join(slug));
    expect(titled(posts, "Small news").author.karma).toBe(-3);
    expect(titled(posts, "Best way to sear a steak?").author.karma).toBe(1200);
  });

  it("starts a participant where the study says, and adds votes on what they post", async () => {
    const { slug } = await study({ platform: ", startingKarma: 10" });
    const cookie = await join(slug);
    const me = async () =>
      ((await (await call(cookie, "GET", "/me")).json()) as { karma: number }).karma;
    expect(await me()).toBe(10);

    expect((await postForm(cookie, { title: "Mine", body: "text" })).status).toBe(200);
    // The two scripted up votes take effect straight away.
    expect(await me()).toBe(12);
    const mine = titled((await home(cookie)).posts, "Mine");
    expect(mine.author.karma).toBe(12);

    // Their own vote doesn't count toward it.
    await call(cookie, "POST", `/content/${mine.id}/vote`, { value: "up", ...meta() });
    expect(await me()).toBe(12);
  });

  it("isn't sent when off", async () => {
    const { slug } = await study({ platform: ", features: { karma: false }" });
    const cookie = await join(slug);
    const { posts } = await home(cookie);
    expect(titled(posts, "Small news").author).not.toHaveProperty("karma");
    const me = await (await call(cookie, "GET", "/me")).json();
    expect(me).not.toHaveProperty("karma");
    const profile = await (await call(cookie, "GET", "/actors/ann")).json();
    expect(profile).not.toHaveProperty("karma");
  });

  it("shows on a profile", async () => {
    const { slug } = await study({});
    const profile = await (await call(await join(slug), "GET", "/actors/ann")).json();
    expect(profile).toMatchObject({ karma: 1200 });
  });
});

describe("a community's look", () => {
  it("is set values, sent to participants", async () => {
    const { slug } = await study({});
    const { spaces } = (await (await call(await join(slug), "GET", "/spaces")).json()) as {
      spaces: SpaceView[];
    };
    expect(spaces.find(({ key }) => key === "cooking")).toMatchObject({
      accent: "#1d4ed8",
      bannerUrl: null,
    });
    expect(spaces.find(({ key }) => key === "news")).toMatchObject({ accent: null });
  });

  it("won't take anything but a color", async () => {
    const dir = (await study({})).dir;
    writeFileSync(
      path.join(dir, "spaces.csv"),
      "key,name,accent\ncooking,Cooking,red;background:url(x)\nnews,News,\n",
    );
    const imported = await importStudyFolder(database.db, storage, dir, { launch: false });
    expect(imported.status).toBe("failed");
  });

  it("goes through a draft, and is frozen with its version", async () => {
    const { versionId } = await study({});
    const { researcherId } = await team();
    const opened = await openDraft(database.db, versionId, researcherId);
    const draft = await loadDraft(database.db, opened?.draftId as string);
    const space = draft?.items.find(({ kind }) => kind === "space");
    expect(space?.data).toMatchObject({ key: "cooking", accent: "#1d4ed8" });
  });
});

describe("the export", () => {
  it("has titles, comment orders, and opening a post, with what they mean", async () => {
    const { slug, dir } = await study({});
    const cookie = await join(slug);
    const { id } = titled((await home(cookie)).posts, "Small news");
    await page(cookie, id);
    await call(cookie, "POST", `/content/${id}/open`, { from: "feed", ...meta() });

    const folder = mkdtempSync(path.join(dir, "export-"));
    const result = await exportStudy(database.db, slug, folder);
    expect(result.status).toBe("exported");
    const read = (name: string) => readFileSync(path.join(folder, name), "utf8");

    expect(read("content.csv")).toContain("Best way to sear a steak?");
    expect(read("impressions.csv").split("\n")[0]).toContain(
      "comment_order,comment_order_version,comment_sort",
    );
    expect(read("impressions.csv")).toContain(",post,");
    expect(read("events.csv")).toContain("content.opened");
    expect(read("spaces.csv")).toContain("#1d4ed8");
    expect(read("codebook.md")).toContain("opened a post's own page");
  });
});

describe("starting a study from a template", () => {
  it("begins with what the template says, and can't change to another", async () => {
    const { teamId, researcherId, slug } = await team();
    const started = await startStudy(database.db, {
      teamId,
      researcherId,
      slug,
      title: "New forum",
      assignment: "uniform",
      template: "forum",
    });
    if ("problem" in started) {
      throw new Error(started.message);
    }
    const draft = await loadDraft(database.db, started.draftId);
    expect(draft?.settings.platform.template).toBe("forum");
    expect(draft?.settings.feed).toMatchObject({ ranker: "top", commentOrder: "top" });

    if (!draft) {
      throw new Error("The draft wasn't found.");
    }
    const { platform, title, site } = draft.settings;
    const value = { title, site, platform: { ...platform, template: "classic" } };
    const refused = await saveSection(database.db, started.draftId, researcherId, {
      section: "study",
      value,
      baseRevision: 0,
    });
    expect(refused).toMatchObject({ problem: "invalid" });

    const kept = await saveSection(database.db, started.draftId, researcherId, {
      section: "study",
      value: { title, site, platform: { style: "text" } },
      baseRevision: 0,
    });
    expect(kept).not.toHaveProperty("problem");
    const after = await loadDraft(database.db, started.draftId);
    expect(after?.settings.platform).toMatchObject({ style: "text", template: "forum" });
  });

  it("takes a title on a post in the draft", async () => {
    const { teamId, researcherId, slug } = await team();
    const started = await startStudy(database.db, {
      teamId,
      researcherId,
      slug,
      title: "New forum",
      assignment: "uniform",
      template: "forum",
    });
    if ("problem" in started) {
      throw new Error(started.message);
    }
    const actor = await createItem(database.db, started.draftId, researcherId, "actor", {
      username: "ann",
      name: "Ann",
      karma: 5,
      conditions: [],
    });
    if ("problem" in actor) {
      throw new Error(actor.message);
    }
    const created = await createItem(database.db, started.draftId, researcherId, "post", {
      title: "Hello",
      body: "",
      actorId: actor.id,
      timeMs: 0,
      conditions: [],
    });
    expect(created).toHaveProperty("id");
    const tooLong = await createItem(database.db, started.draftId, researcherId, "post", {
      title: "x".repeat(301),
      body: "",
      actorId: actor.id,
      timeMs: 0,
      conditions: [],
    });
    expect(tooLong).toMatchObject({ problem: "invalid" });
  });
});

describe("more orders", () => {
  it("can be set by a study, and each showing records which and why", async () => {
    const { slug } = await study({ feed: ", spaceRanker: rising" });
    const cookie = await join(slug);
    await home(cookie);
    expect((await lastImpression()).ranker).toBe("top");
    await call(cookie, "GET", "/feed?surface=space&space=cooking");
    const shown = await lastImpression();
    expect(shown).toMatchObject({ surface: "space", ranker: "rising", rankerVersion: "1" });
    expect((shown.items as { score?: number }[])[0]?.score).toEqual(expect.any(Number));
  });

  it("can be chosen by a participant where allowed, and stay chosen", async () => {
    const { slug } = await study({
      feed: ", participantsCanSort: true, participantsCanSortComments: true",
    });
    const cookie = await join(slug);
    const chosen = await call(cookie, "POST", "/feed/sort", {
      ...meta(),
      surface: "home",
      sort: "controversial",
    });
    expect(chosen.status).toBe(200);
    expect((await home(cookie)).sort).toBe("controversial");
    expect(await lastImpression()).toMatchObject({
      sort: "controversial",
      ranker: "controversial",
    });

    const commented = await call(cookie, "POST", "/comments/sort", { ...meta(), sort: "best" });
    expect(commented.status).toBe(200);
    const first = titled((await home(cookie)).posts, "Best way to sear a steak?");
    const opened = await page(cookie, first.id);
    expect(opened.commentSort).toBe("best");
    expect(await lastImpression()).toMatchObject({ commentOrder: "best", commentSort: "best" });
    // By share of up votes, and how sure that is, since none of these have any down votes.
    expect(opened.posts[0]?.comments[0]?.body).toBe("Written next");
  });

  it("refuses an order that doesn't apply, and one for comments on a feed", async () => {
    const { slug } = await study({
      feed: ", participantsCanSort: true, participantsCanSortComments: true",
    });
    const cookie = await join(slug);
    const old = await call(cookie, "POST", "/feed/sort", {
      ...meta(),
      surface: "home",
      sort: "old",
    });
    expect(old.status).toBe(400);
    const hot = await call(cookie, "POST", "/comments/sort", { ...meta(), sort: "hot" });
    expect(hot.status).toBe(400);
  });
});

describe("member counts", () => {
  const spacesOf = async (cookie: string) =>
    ((await (await call(cookie, "GET", "/spaces")).json()) as { spaces: SpaceView[] }).spaces;

  it("shows nothing unless the study wrote a number", async () => {
    const { slug } = await study({});
    expect((await spacesOf(await join(slug)))[0]?.memberCount).toBeNull();
  });

  it("adds this person only while they're in it", async () => {
    const { slug } = await study({ spaces: SPACES_WITH_MEMBERS });
    const cookie = await join(slug);
    const count = async () =>
      (await spacesOf(cookie)).find(({ key }) => key === "cooking")?.memberCount;
    expect(await count()).toBe(1201);
    const left = await call(cookie, "POST", "/spaces/cooking/membership", {
      ...meta(),
      joined: false,
    });
    expect(left.status).toBe(200);
    expect(await count()).toBe(1200);
    expect((await spacesOf(cookie)).find(({ key }) => key === "news")?.memberCount).toBeNull();
  });
});

describe("scripted karma changes", () => {
  const CHANGES =
    ", karmaChanges: [{ afterMinutes: 60, change: 500 }, { actor: ann, afterMinutes: 60, change: -200 }, { actor: ben, afterMinutes: 600, change: 50 }]";

  const shiftBack = async (hours: number) => {
    const [row] = await database.db
      .select({ worldId: schema.feedImpressions.worldId })
      .from(schema.feedImpressions)
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    await database.db
      .update(schema.worlds)
      .set({ startedAt: new Date(Date.now() - hours * 60 * 60 * 1000) })
      .where(eq(schema.worlds.id, row?.worldId as string));
  };

  it("applies each at its time, and records what was shown", async () => {
    const { slug } = await study({ platform: CHANGES });
    const cookie = await join(slug);

    const before = titled((await home(cookie)).posts, "Best way to sear a steak?");
    expect(before.author.karma).toBe(1200);
    expect(((await (await call(cookie, "GET", "/me")).json()) as { karma: number }).karma).toBe(0);

    await shiftBack(2);
    const after = titled((await home(cookie)).posts, "Best way to sear a steak?");
    expect(after.author.karma).toBe(1000);
    const small = titled((await home(cookie)).posts, "Small news");
    expect(small.author.karma).toBe(-3);
    expect(((await (await call(cookie, "GET", "/me")).json()) as { karma: number }).karma).toBe(
      500,
    );
    expect((await lastImpression()).karmaShown).toMatchObject({ ann: 1000, ben: -3 });

    const profile = (await (await call(cookie, "GET", "/actors/ann")).json()) as {
      karma?: number;
    };
    expect(profile.karma).toBe(1000);
  });

  it("can differ by condition, replacing the study's list", async () => {
    const { slug } = await study({
      platform: CHANGES,
      arms: "[{ key: main, platform: { karmaChanges: [{ afterMinutes: 0, change: 7 }] } }]",
    });
    const cookie = await join(slug);
    expect(((await (await call(cookie, "GET", "/me")).json()) as { karma: number }).karma).toBe(7);
  });

  it("won't take someone who isn't in the cast", async () => {
    await expect(
      study({ platform: ", karmaChanges: [{ actor: nobody, afterMinutes: 1, change: 1 }]" }),
    ).rejects.toThrow(/nobody/);
  });
});

describe("notifications", () => {
  it("say which post, and which comment, they're about", async () => {
    const { slug } = await study({
      platform: ", features: { notifications: true }",
    });
    const cookie = await join(slug);
    const posted = await postForm(cookie, { title: "Mine", body: "My post" });
    expect(posted.status).toBe(200);
    const mine = titled((await home(cookie)).posts, "Mine");
    const commented = await call(cookie, "POST", `/content/${mine.id}/comments`, {
      ...meta(),
      body: "My comment",
    });
    expect(commented.status).toBe(200);
    const onPage = (await page(cookie, mine.id)).posts[0]?.comments[0];
    expect(onPage?.body).toBe("My comment");

    const [row] = await database.db
      .select()
      .from(schema.feedImpressions)
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    const [ann] = await database.db
      .select({ id: schema.actors.id })
      .from(schema.actors)
      .where(eq(schema.actors.username, "ann"))
      .orderBy(desc(schema.actors.id))
      .limit(1);
    await database.db.insert(schema.notifications).values([
      {
        worldId: row?.worldId as string,
        recipientActorId: row?.viewerActorId as string,
        actorId: ann?.id as string,
        type: "like",
        targetContentId: onPage?.id as string,
        dueAt: new Date(Date.now() - 1000),
      },
      {
        worldId: row?.worldId as string,
        recipientActorId: row?.viewerActorId as string,
        actorId: ann?.id as string,
        type: "like",
        targetContentId: mine.id,
        dueAt: new Date(Date.now() - 2000),
      },
    ]);

    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { targetKind: string; postId: string; commentId: string | null }[];
    };
    expect(notifications.find(({ targetKind }) => targetKind === "comment")).toMatchObject({
      postId: mine.id,
      commentId: onPage?.id,
    });
    expect(notifications.find(({ targetKind }) => targetKind === "post")).toMatchObject({
      postId: mine.id,
      commentId: null,
    });
  });
});

describe("the codebook", () => {
  it("says how orders are worked out, and that they're not a real platform's", async () => {
    const { slug } = await study({});
    await join(slug);
    const folder = mkdtempSync(path.join(tmpdir(), "truman-forum-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const codebook = readFileSync(path.join(folder, "codebook.md"), "utf8");
    expect(codebook).toContain("How orders are worked out");
    expect(codebook).toContain("aren't any real platform's formulas");
    expect(codebook).toContain("(age in hours + 2)^1.5");
    expect(codebook).toContain("Wilson score interval");
    expect(codebook).toContain("karma_shown");
  });
});
