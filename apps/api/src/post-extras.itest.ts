import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const POSTS = `id,title,body,actor,space,link,pinned,locked,tags,ups,downs,time
plain,Plain,Some text,ann,cooking,,,,,50,0,-5:00
titled,Only a title,,ann,cooking,,,,,40,0,-5:00
linked,A link,,ann,,https://www.example.org/story?a=1,,,,30,0,-5:00
home,Pinned at home,Text,ann,,,home,,,1,0,-5:00
community,Pinned in its community,Text,ann,cooking,,space,,,2,0,-5:00
locked,Locked one,Text,ann,cooking,,,yes,,3,0,-5:00
covered,A spoiler,Secret,ann,cooking,,,,spoiler,4,0,-5:00
adult,Adult one,Secret,ann,cooking,,,,adult,5,0,-5:00
`;

async function study({ template = "forum", platform = "", arms = "[{ key: main }]" } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-extras-"));
  dirs.push(dir);
  const slug = `extras-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Extras
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: ${arms}
platform: { style: mixed, template: ${template} ${platform} }
feed: { ranker: top }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "spaces.csv": "key,name\ncooking,Cooking\n",
    "posts.csv": POSTS,
    "comments.csv": "id,body,actor,postID,time\nc1,Old comment,ann,locked,-4:00\n",
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

const WITH_ADULT = ", features: { adultTags: true }";
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
const titled = (posts: FeedPost[], title: string) =>
  posts.find((post) => post.title === title) as FeedPost;
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  call(cookie, "POST", `/content/${id}/${action}`, { ...meta(), ...body });

function postForm(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), ...fields })) {
    form.set(key, value);
  }
  return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
}

const eventsOf = (type: string) =>
  database.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.type, type))
    .orderBy(desc(schema.events.id));

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

describe("a post with only a title", () => {
  it("is allowed in a study folder and from a participant", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    expect(titled(await list(cookie), "Only a title").body).toBe("");

    const response = await postForm(cookie, { title: "Just this", body: "" });
    expect(response.status).toBe(200);
    expect(titled(await list(cookie), "Just this")).toBeDefined();
  });

  it("still needs something where there are no titles", async () => {
    const { slug } = await study({ template: "classic" });
    const response = await postForm(await join(slug), { body: "" });
    expect(response.status).toBe(400);
  });
});

describe("link posts", () => {
  it("show where they go, and record a click without visiting it", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const post = titled(await list(cookie), "A link");
    expect(post.link).toEqual({
      url: "https://www.example.org/story?a=1",
      domain: "example.org",
    });

    expect((await act(cookie, post.id, "link-opened")).status).toBe(200);
    const [event] = await eventsOf("content.link_opened");
    expect(event?.targetContentId).toBe(post.id);
  });

  it("can be written by a participant, and can stand alone", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const response = await postForm(cookie, {
      title: "Mine",
      body: "",
      link: "https://example.com/mine",
    });
    expect(response.status).toBe(200);
    expect(titled(await list(cookie), "Mine").link?.domain).toBe("example.com");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "not a link",
  ])("refuses %s", async (link) => {
    const { slug } = await study();
    const response = await postForm(await join(slug), { title: "Bad", body: "", link });
    expect(response.status).toBe(400);
  });

  it("refuses a bad address in a study folder", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "truman-extras-"));
    dirs.push(dir);
    const slug = `extras-${randomUUID().slice(0, 8)}`;
    writeFileSync(
      path.join(dir, "study.yaml"),
      `
schemaVersion: 1
slug: ${slug}
title: Extras
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: main }]
platform: { style: mixed, template: forum }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    );
    writeFileSync(path.join(dir, "actors.csv"), "username,name\nann,Ann\n");
    writeFileSync(
      path.join(dir, "posts.csv"),
      "id,title,actor,link,time\np,T,ann,javascript:x,-1:00\n",
    );
    const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
    expect(imported.status).toBe("failed");
  });

  it("are refused when off, and don't reach a browser", async () => {
    const { slug } = await study({ platform: ", features: { links: false }" });
    const cookie = await join(slug);
    const post = titled(await list(cookie), "A link");
    expect(post.link).toBeUndefined();
    expect((await act(cookie, post.id, "link-opened")).status).toBe(403);
    expect(
      (await postForm(cookie, { title: "T", body: "x", link: "https://example.com" })).status,
    ).toBe(403);
  });
});

describe("pinned posts", () => {
  it("stay on top of the list they're pinned to, and only that list", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const home = await list(cookie);
    expect(home[0]?.title).toBe("Pinned at home");
    expect(home[0]?.pinned).toBe(true);
    expect(titled(home, "Pinned in its community")?.pinned).toBeUndefined();

    const space = await list(cookie, "?surface=space&space=cooking");
    expect(space[0]?.title).toBe("Pinned in its community");
    expect(space[0]?.pinned).toBe(true);

    const [impression] = await database.db
      .select()
      .from(schema.feedImpressions)
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    expect((impression?.items as { pinned: boolean }[] | undefined)?.[0]?.pinned).toBe(true);
  });

  it("do nothing when off", async () => {
    const { slug } = await study({ platform: ", features: { pinning: false }" });
    const home = await list(await join(slug));
    expect(home[0]?.title).toBe("Plain");
    expect(home.some((post) => post.pinned)).toBe(false);
  });
});

describe("locked posts", () => {
  it("refuse comments and replies on the server, and keep what's there", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const post = titled(await list(cookie), "Locked one");
    expect(post.locked).toBe(true);

    const refused = await call(cookie, "POST", `/content/${post.id}/comments`, {
      ...meta(),
      body: "Hello",
    });
    expect(refused.status).toBe(403);

    const page = await call(cookie, "GET", `/feed?surface=post&post=${post.id}`);
    const [shown] = ((await page.json()) as FeedResponse).posts;
    expect(shown?.comments.map(({ body }) => body)).toEqual(["Old comment"]);
    const reply = await call(cookie, "POST", `/content/${shown?.comments[0]?.id}/comments`, {
      ...meta(),
      body: "Hello",
    });
    expect(reply.status).toBe(403);
  });

  it("take comments when off", async () => {
    const { slug } = await study({ platform: ", features: { locking: false }" });
    const cookie = await join(slug);
    const post = titled(await list(cookie), "Locked one");
    expect(post.locked).toBeUndefined();
    const response = await call(cookie, "POST", `/content/${post.id}/comments`, {
      ...meta(),
      body: "Hello",
    });
    expect(response.status).toBe(200);
  });
});

describe("spoiler and adult tags", () => {
  it("are sent where they're on, with adult off in Forum to begin with", async () => {
    const { slug } = await study();
    const posts = await list(await join(slug));
    expect(titled(posts, "A spoiler").tags).toEqual(["spoiler"]);
    expect(titled(posts, "Adult one").tags).toBeUndefined();

    const withAdult = await study({ platform: WITH_ADULT });
    expect(titled(await list(await join(withAdult.slug)), "Adult one").tags).toEqual(["adult"]);
  });

  it("record what was uncovered, and only that", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const posts = await list(cookie);
    const spoiler = titled(posts, "A spoiler");

    expect((await act(cookie, spoiler.id, "reveal")).status).toBe(200);
    const [event] = await eventsOf("content.revealed");
    expect(event?.payload).toEqual({ tags: ["spoiler"] });

    // Adult is off here, so nothing covered it, and a plain post has nothing to uncover.
    expect((await act(cookie, titled(posts, "Adult one").id, "reveal")).status).toBe(404);
    expect((await act(cookie, titled(posts, "Plain").id, "reveal")).status).toBe(404);
  });

  it("can be set by a participant, where they're on", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    await postForm(cookie, { title: "Mine", body: "x", spoiler: "true" });
    expect(titled(await list(cookie), "Mine").tags).toEqual(["spoiler"]);
    expect((await postForm(cookie, { title: "T", body: "x", adult: "true" })).status).toBe(403);
  });
});

describe("saving", () => {
  it("keeps a list, recorded, that only reaches this person", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const post = titled(await list(cookie), "Plain");

    expect((await act(cookie, post.id, "save", { active: true })).status).toBe(200);
    expect(titled(await list(cookie), "Plain").saved).toBe(true);
    expect((await list(cookie, "?surface=saved")).map(({ title }) => title)).toEqual(["Plain"]);
    expect(await list(await join(slug), "?surface=saved")).toEqual([]);
    expect((await eventsOf("content.saved"))[0]?.targetContentId).toBe(post.id);

    await act(cookie, post.id, "save", { active: false });
    expect(await list(cookie, "?surface=saved")).toEqual([]);
  });

  it("is for posts, and is refused when off", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const page = await call(
      cookie,
      "GET",
      `/feed?surface=post&post=${titled(await list(cookie), "Locked one").id}`,
    );
    const comment = ((await page.json()) as FeedResponse).posts[0]?.comments[0]?.id as string;
    expect((await act(cookie, comment, "save", { active: true })).status).toBe(404);

    const off = await study({ platform: ", features: { saving: false }" });
    const other = await join(off.slug);
    const post = titled(await list(other), "Plain");
    expect((await act(other, post.id, "save", { active: true })).status).toBe(403);
    expect((await call(other, "GET", "/feed?surface=saved")).status).toBe(403);
  });
});

describe("hiding", () => {
  it("takes a post out of feeds and what's recorded as shown, until it's brought back", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const post = titled(await list(cookie), "Plain");

    await act(cookie, post.id, "hide", { active: true });
    expect(titled(await list(cookie), "Plain")).toBeUndefined();
    const [impression] = await database.db
      .select()
      .from(schema.feedImpressions)
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    expect(
      ((impression?.items ?? []) as { contentId: string }[]).map(({ contentId }) => contentId),
    ).not.toContain(post.id);
    expect(titled(await list(cookie, "?surface=space&space=cooking"), "Plain")).toBeUndefined();

    const hidden = await list(cookie, "?surface=hidden");
    expect(hidden.map(({ title }) => title)).toEqual(["Plain"]);
    expect(hidden[0]?.hidden).toBe(true);

    // Only for them.
    expect(titled(await list(await join(slug)), "Plain")).toBeDefined();

    await act(cookie, post.id, "hide", { active: false });
    expect(titled(await list(cookie), "Plain")).toBeDefined();
  });

  it("is refused when off", async () => {
    const { slug } = await study({ platform: ", features: { hiding: false }" });
    const cookie = await join(slug);
    const post = titled(await list(cookie), "Plain");
    expect((await act(cookie, post.id, "hide", { active: true })).status).toBe(403);
    expect((await call(cookie, "GET", "/feed?surface=hidden")).status).toBe(403);
  });
});

describe("sharing", () => {
  it("is recorded, and is refused when off", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const post = titled(await list(cookie), "Plain");
    expect((await act(cookie, post.id, "share", { method: "copy" })).status).toBe(200);
    expect((await eventsOf("content.shared"))[0]?.payload).toEqual({ method: "copy" });

    const off = await study({ platform: ", features: { sharing: false }" });
    const other = await join(off.slug);
    const theirs = titled(await list(other), "Plain");
    expect((await act(other, theirs.id, "share", { method: "copy" })).status).toBe(403);
  });

  it("never lets a link show someone else their post, or anything to a stranger", async () => {
    const { slug } = await study();
    const writer = await join(slug);
    const reader = await join(slug);
    await postForm(writer, { title: "Private to my world", body: "Mine" });
    const written = titled(await list(writer), "Private to my world");
    const url = `/feed?surface=post&post=${written.id}`;

    expect((await call(writer, "GET", url)).status).toBe(200);
    expect((await call(reader, "GET", url)).status).toBe(404);
    expect((await call("", "GET", url)).status).toBe(401);
    expect((await act(reader, written.id, "share", { method: "copy" })).status).toBe(404);

    const other = await join((await study()).slug);
    expect((await call(other, "GET", url)).status).toBe(404);
  });

  it("opens a scripted post for someone else in the study, as their own copy", async () => {
    const { slug } = await study();
    const writer = await join(slug);
    const post = titled(await list(writer), "Plain");
    await act(writer, post.id, "save", { active: true });

    const reader = await join(slug);
    const page = await call(reader, "GET", `/feed?surface=post&post=${post.id}`);
    expect(page.status).toBe(200);
    const [shown] = ((await page.json()) as FeedResponse).posts;
    // Nothing of what the first person did to it comes along.
    expect(shown?.saved).toBeUndefined();
  });

  it("makes a post's page reachable without post pages", async () => {
    const { slug } = await study({ platform: ", features: { postPages: false }" });
    const cookie = await join(slug);
    const post = titled(await list(cookie), "Plain");
    expect((await call(cookie, "GET", `/feed?surface=post&post=${post.id}`)).status).toBe(200);

    const neither = await study({ platform: ", features: { postPages: false, sharing: false }" });
    const other = await join(neither.slug);
    const theirs = titled(await list(other), "Plain");
    expect((await call(other, "GET", `/feed?surface=post&post=${theirs.id}`)).status).toBe(403);
  });
});

describe("withdrawing", () => {
  it("removes what someone saved and hid", async () => {
    const { slug } = await study();
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    const posts = await list(cookie);
    await act(cookie, titled(posts, "Plain").id, "save", { active: true });
    await act(cookie, titled(posts, "A link").id, "hide", { active: true });

    const [before] = await database.db
      .select({ actorId: schema.events.actorId, worldId: schema.events.worldId })
      .from(schema.events)
      .where(eq(schema.events.type, "content.hidden"))
      .orderBy(desc(schema.events.id))
      .limit(1);
    await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });
    expect(
      await database.db
        .select()
        .from(schema.contentInteractions)
        .where(
          and(
            eq(schema.contentInteractions.worldId, before?.worldId as string),
            eq(schema.contentInteractions.kind, "hide"),
          ),
        ),
    ).toEqual([]);
  });
});

describe("the export", () => {
  it("has what was written, and what it means", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const posts = await list(cookie);
    await act(cookie, titled(posts, "A spoiler").id, "reveal");

    const folder = mkdtempSync(path.join(tmpdir(), "truman-extras-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const content = readFileSync(path.join(folder, "content.csv"), "utf8");
    expect(content.split("\n")[0]).toContain("link,pinned_on,locked,tags");
    expect(content).toContain("https://www.example.org/story?a=1");
    expect(content).toContain("spoiler");
    const codebook = readFileSync(path.join(folder, "codebook.md"), "utf8");
    expect(codebook).toContain("content.revealed");
  });
});
