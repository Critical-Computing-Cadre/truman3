import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { freezeDraft, loadDraft, openDraft, updateItem } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadVersion, previewFeed } from "./admin/preview.ts";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const ACTORS = `username,name,followers,following,startsFollowed,badge
ann,Ann,1200,300,yes,Journalist
bob,Bob,40,12,,
cleo,Cleo,5,5,b,
`;
const POSTS = `id,body,actor,repostOf,quoteOf,reposts,quotes,time
story,The story,bob,,,7,2,-6:00
other,Bob again,bob,,,,,-5:30
step1,,cleo,story,,,,-5:00
step2,,ann,step1,,,,-4:00
take,Ann's take,ann,,story,,,-3:00
later,,ann,other,,,,50:00
`;

async function study({
  platform = "",
  feed = "",
  reactions = "",
  posts = POSTS,
  arms = "[{ key: a }, { key: b }]",
  template = "shortPosts",
}: {
  platform?: string;
  feed?: string;
  reactions?: string;
  posts?: string;
  arms?: string;
  template?: string;
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-short-"));
  dirs.push(dir);
  const slug = `short-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Short
site: { name: Demo }
length: { days: 5 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: ${arms}
platform: { style: text, template: ${template} ${platform} }
feed: { ranker: chronological ${feed} }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": ACTORS,
    "posts.csv": posts,
    "comments.csv": "id,body,actor,postID,time\nc1,A reply,ann,story,-2:00\n",
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
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  call(cookie, "POST", `/content/${id}/${action}`, { ...meta(), ...body });
function postForm(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), ...fields })) {
    form.set(key, value);
  }
  return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
}
const profile = async (cookie: string, username: string) =>
  (await (await call(cookie, "GET", `/actors/${username}`)).json()) as {
    followerCount?: number;
    followingCount?: number;
    badge?: string;
    posts: FeedPost[];
  };
const conditionOf = async (versionId: string) => {
  const [assigned] = await database.db
    .select({ key: schema.conditions.key })
    .from(schema.assignments)
    .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
    .where(eq(schema.assignments.studyVersionId, versionId));
  return assigned?.key;
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

describe("the following tab", () => {
  it("shows those someone starts out following, and changes as they follow", async () => {
    const { slug, versionId } = await study({ arms: "[{ key: a }]" });
    const cookie = await join(slug);
    const home = await list(cookie);
    expect(home.map(({ body }) => body)).toContain("Bob again");

    const following = await list(cookie, "?surface=following");
    expect(following.map(({ body }) => body)).not.toContain("Bob again");
    expect(following.map(({ body }) => body)).toContain("Ann's take");

    await call(cookie, "POST", "/actors/bob/relation", { ...meta(), action: "follow" });
    expect((await list(cookie, "?surface=following")).map(({ body }) => body)).toContain(
      "Bob again",
    );
    await call(cookie, "POST", "/actors/ann/relation", { ...meta(), action: "unfollow" });
    expect((await list(cookie, "?surface=following")).map(({ body }) => body)).not.toContain(
      "Ann's take",
    );

    const [impression] = await database.db
      .select()
      .from(schema.feedImpressions)
      .where(eq(schema.feedImpressions.surface, "following"));
    expect(impression?.ranker).toBe("new");
    expect(await withId(versionId, "take")).toBeDefined();
  });

  it("starts someone following by condition", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const page = await profile(cookie, "cleo");
    const condition = await conditionOf(versionId);
    const following = await list(cookie, "?surface=following");
    const cleoReposted = following.some(({ repostedBy }) => repostedBy?.username === "cleo");
    expect(cleoReposted).toBe(condition === "b");
    // What the study wrote, plus this person, if they start out following them.
    expect(page.followerCount).toBe(condition === "b" ? 6 : 5);
  });

  it("is refused with the feature off, and a study can name its tabs", async () => {
    const off = await study({ platform: ", features: { followingFeed: false }" });
    const cookie = await join(off.slug);
    expect((await call(cookie, "GET", "/feed?surface=following")).status).toBe(403);

    const named = await study({
      feed: ", homeTabLabel: Latest, followingTabLabel: Friends, startOnFollowing: true",
    });
    const flow = (await (await call(await join(named.slug), "GET", "/me/flow")).json()) as {
      feedTabs: { home: string; following: string; startOnFollowing: boolean };
    };
    expect(flow.feedTabs).toEqual({ home: "Latest", following: "Friends", startOnFollowing: true });
  });
});

describe("reposts", () => {
  it("shows what's passed along, with who, and a chain says who it came through", async () => {
    const { slug, versionId } = await study();
    const posts = await list(await join(slug));
    const story = await withId(versionId, "story");
    const shown = posts.filter(({ id }) => id === story);
    expect(shown).toHaveLength(3);
    const viaCleo = shown.find(({ repostedBy }) => repostedBy?.username === "ann");
    expect(viaCleo?.repostedBy?.via).toBe("Cleo");
    expect(viaCleo?.body).toBe("The story");
    expect(viaCleo?.author.username).toBe("bob");
    expect(viaCleo?.commentCount).toBe(1);
    // Seven written, plus the two that have happened. The third is a post of its own.
    expect(viaCleo?.repostCount).toBe(9);
    expect(viaCleo?.quoteCount).toBe(3);
  });

  it("waits for its time", async () => {
    const { slug, versionId } = await study();
    const posts = await list(await join(slug));
    const other = await withId(versionId, "other");
    expect(posts.filter(({ id }) => id === other)).toHaveLength(1);
  });

  it("lets someone pass a post along once, and take it back", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const other = await withId(versionId, "other");
    expect((await act(cookie, other, "repost", { active: true })).status).toBe(200);
    expect((await act(cookie, other, "repost", { active: true })).status).toBe(200);

    let shown = (await list(cookie)).filter(({ id }) => id === other);
    expect(shown).toHaveLength(2);
    const mine = shown.find(({ repostedBy }) => repostedBy?.isViewer);
    expect(mine?.reposted).toBe(true);
    expect(mine?.repostCount).toBe(1);

    expect((await act(cookie, other, "repost", { active: false })).status).toBe(200);
    shown = (await list(cookie)).filter(({ id }) => id === other);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.reposted).toBeUndefined();

    const events = await database.db
      .select({ type: schema.events.type })
      .from(schema.events)
      .where(
        and(eq(schema.events.targetContentId, other), eq(schema.events.studyVersionId, versionId)),
      );
    expect(events.map(({ type }) => type).sort()).toEqual([
      "content.reposted",
      "content.reposted",
      "content.unreposted",
    ]);
  });

  it("points at the first post even when it's done through a repost's ID", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const step2 = await withId(versionId, "step2");
    const story = await withId(versionId, "story");
    expect((await act(cookie, step2, "repost", { active: true })).status).toBe(200);
    const [mine] = await database.db
      .select()
      .from(schema.content)
      .where(and(eq(schema.content.repostOf, story), eq(schema.content.studyVersionId, versionId)));
    expect(mine).toBeDefined();
    const mineShown = (await list(cookie)).find(({ repostedBy }) => repostedBy?.isViewer);
    expect(mineShown?.id).toBe(story);
    expect(mineShown?.repostedBy?.via).toBeUndefined();
  });

  it("doesn't count toward scripted reactions to someone's nth post", async () => {
    const { slug, versionId } = await study({
      reactions: "on,nth,type,actor,after\npost,0,like,ann,0:00\n",
    });
    const cookie = await join(slug);
    await act(cookie, await withId(versionId, "other"), "repost", { active: true });
    const made = await postForm(cookie, { body: "My first" });
    const { id } = (await made.json()) as { id: string };
    const mine = (await list(cookie)).find((post) => post.id === id);
    expect(mine?.likes).toBe(1);
  });

  it("is what's on a profile, and reactions can repost someone's post", async () => {
    const { slug } = await study({
      reactions: "on,nth,type,actor,after\npost,0,repost,ann,0:00\npost,0,follow,cleo,0:00\n",
      platform: ", startingFollowers: 10",
    });
    const cookie = await join(slug);
    const made = await postForm(cookie, { body: "My first" });
    const { id } = (await made.json()) as { id: string };

    const shown = (await list(cookie)).filter((post) => post.id === id);
    expect(shown.some(({ repostedBy }) => repostedBy?.username === "ann")).toBe(true);
    const mine = shown.find(({ repostedBy }) => !repostedBy);
    expect(mine?.repostCount).toBe(1);

    const annPage = await profile(cookie, "ann");
    expect(annPage.posts.some((post) => post.id === id)).toBe(true);

    const { username } = (await (await call(cookie, "GET", "/me")).json()) as { username: string };
    const me = await profile(cookie, username);
    expect(me.followerCount).toBe(11);

    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string }[];
    };
    expect(notifications.map(({ type }) => type).sort()).toEqual(["follow", "repost"]);
  });

  it("is refused and hidden with the feature off, and stays away with what it passes on", async () => {
    const off = await study({ platform: ", features: { reposts: false }" });
    const cookie = await join(off.slug);
    const story = await withId(off.versionId, "story");
    expect((await act(cookie, story, "repost", { active: true })).status).toBe(403);
    expect((await list(cookie)).some(({ repostedBy }) => repostedBy)).toBe(false);
    expect((await list(cookie)).find(({ id }) => id === story)?.repostCount).toBeUndefined();

    const on = await study();
    const other = await join(on.slug);
    const onStory = await withId(on.versionId, "story");
    await act(other, onStory, "hide", { active: true });
    expect((await list(other)).filter(({ id }) => id === onStory)).toEqual([]);
  });

  it("goes with a withdrawal", async () => {
    const { slug, versionId } = await study();
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    await act(cookie, await withId(versionId, "other"), "repost", { active: true });
    const made = await postForm(cookie, {
      body: "Quoting",
      quoteOf: await withId(versionId, "story"),
    });
    expect(made.status).toBe(200);
    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });
    expect(result.status).toBe("withdrawn");
  });
});

describe("quotes", () => {
  it("shows what's quoted, for what the study wrote and what someone writes", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const take = (await list(cookie)).find(({ body }) => body === "Ann's take");
    expect(take?.quote?.original?.body).toBe("The story");
    expect(take?.quote?.original?.authorName).toBe("Bob");

    const other = await withId(versionId, "other");
    const made = await postForm(cookie, { body: "My view", quoteOf: other });
    expect(made.status).toBe(200);
    const mine = (await list(cookie)).find(({ body }) => body === "My view");
    expect(mine?.quote?.original?.body).toBe("Bob again");
    expect((await list(cookie)).find(({ id }) => id === other)?.quoteCount).toBe(1);
  });

  it("is refused with the feature off, or for what someone can't see", async () => {
    const off = await study({ platform: ", features: { quotes: false }" });
    const cookie = await join(off.slug);
    const story = await withId(off.versionId, "story");
    expect((await postForm(cookie, { body: "x", quoteOf: story })).status).toBe(403);
    const take = (await list(cookie)).find(({ body }) => body === "Ann's take");
    expect(take?.quote).toBeUndefined();

    const on = await study();
    const second = await join(on.slug);
    expect((await postForm(second, { body: "x", quoteOf: randomUUID() })).status).toBe(404);
  });
});

describe("what a study sets", () => {
  it("limits what participants write, in posts and comments", async () => {
    const { slug, versionId } = await study({ platform: ", maxPostLength: 10" });
    const cookie = await join(slug);
    expect((await postForm(cookie, { body: "x".repeat(11) })).status).toBe(400);
    expect((await postForm(cookie, { body: "x".repeat(10) })).status).toBe(200);
    const story = await withId(versionId, "story");
    expect((await act(cookie, story, "comments", { body: "x".repeat(11) })).status).toBe(400);
    const flow = (await (await call(cookie, "GET", "/me/flow")).json()) as {
      maxPostLength: number;
    };
    expect(flow.maxPostLength).toBe(10);
  });

  it("has no limit unless it says so", async () => {
    const { slug } = await study();
    expect((await postForm(await join(slug), { body: "x".repeat(3000) })).status).toBe(200);
  });

  it("shows badges and counts only with the features on", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const ann = await profile(cookie, "ann");
    expect(ann.badge).toBe("Journalist");
    expect(ann.followerCount).toBe(1201);
    expect(ann.followingCount).toBe(300);
    const take = (await list(cookie)).find(({ body }) => body === "Ann's take");
    expect(take?.author.badge).toBe("Journalist");

    const off = await study({
      template: "classic",
      posts: "id,body,actor,time\nstory,Hi,ann,-6:00\n",
    });
    const other = await join(off.slug);
    const plain = await profile(other, "ann");
    expect(plain.badge).toBeUndefined();
    expect(plain.followerCount).toBeUndefined();
    expect((await list(other))[0]?.author.badge).toBeUndefined();
  });
});

describe("the record, the preview, and the builder", () => {
  it("is in the export", async () => {
    const { slug, versionId } = await study();
    await list(await join(slug));
    const folder = mkdtempSync(path.join(tmpdir(), "truman-short-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const content = parse(readFileSync(path.join(folder, "content.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    const story = await withId(versionId, "story");
    expect(content.find(({ source_ref }) => source_ref === "step1")?.repost_of).toBe(story);
    expect(content.find(({ source_ref }) => source_ref === "take")?.quote_of).toBe(story);
    expect(content.find(({ source_ref }) => source_ref === "story")?.base_reposts).toBe("7");
  });

  it("shows a repost as the post it passes on in a version's preview", async () => {
    const { versionId } = await study();
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
    const story = await withId(versionId, "story");
    expect(posts.filter(({ id }) => id === story).length).toBeGreaterThan(1);
  });

  it("keeps everything through a draft and a new version, and refuses a loop", async () => {
    const { versionId } = await study();
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
    const items = loaded?.items ?? [];
    const item = (ref: string) =>
      items.find(({ kind, data }) => kind === "post" && (data as { ref: string }).ref === ref);
    const ann = items.find(
      ({ kind, data }) => kind === "actor" && (data as { username: string }).username === "ann",
    );
    expect(ann?.data).toMatchObject({ followers: 1200, badge: "Journalist", startsFollowed: true });
    expect(item("step2")?.data).toMatchObject({ repostOfId: item("step1")?.id });
    expect(item("take")?.data).toMatchObject({ quoteOfId: item("story")?.id });
    expect(item("story")?.data).toMatchObject({ reposts: 7, quotes: 2 });

    // A circle can't be saved as a version.
    await updateItem(database.db, draftId, item("story")?.id as string, researcherId, {
      repostOfId: item("step2")?.id,
    });
    const circle = await loadDraft(database.db, draftId);
    const refused = await freezeDraft(database.db, circle as NonNullable<typeof circle>);
    expect(refused.status).toBe("invalid");

    await updateItem(database.db, draftId, item("story")?.id as string, researcherId, {
      repostOfId: null,
    });
    const fixed = await loadDraft(database.db, draftId);
    const frozen = await freezeDraft(database.db, fixed as NonNullable<typeof fixed>);
    expect(frozen.status).toBe("frozen");
  });
});
