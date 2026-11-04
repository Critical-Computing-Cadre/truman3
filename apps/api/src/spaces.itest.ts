import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import {
  checkDraft,
  createItem,
  freezeDraft,
  type LoadedDraft,
  loadDraft,
  openDraft,
  type PackContents,
  savePackFromFolder,
  spaceKeyFromName,
  startStudy,
  updateItem,
} from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const POSTS = `id,body,actor,space,ups,downs,time
plain,no space,ann,,0,0,-5:00
in,in cooking,ann,cooking,3,0,-4:00
out,in news,ben,news,50,0,-3:00
only,in the secret one,ben,secret,0,0,-2:00
low,low cooking,ben,cooking,1,0,-1:00
`;

const SPACES = `key,name,description,rules,startsJoined,condition
cooking,Cooking,About food,Be kind,yes,
news,News,,,no,
secret,Secret,,,yes,other
`;
const PICTURE_SPACES = `key,name,picture,startsJoined,condition
cooking,Cooking,cooking.png,yes,
news,News,,no,
secret,Secret,,yes,other
`;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64",
);

/** Two conditions: both have spaces, and `other` also sees one that `main` doesn't. */
async function study({
  platform = "{ features: { spaces: true, votes: true } }",
  feed = "",
  spacesCsv = SPACES,
  media = 'media: { baseUrl: "https://cdn.example.com/m" }',
  arms = "[{ key: main }, { key: other }]",
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-spaces-"));
  dirs.push(dir);
  const slug = `spaces-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Spaces
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: ${arms}
platform: { style: mixed, ${platform.slice(1, -1)} }
feed: { ranker: chronological ${feed} }
${media}
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name,moderator\nann,Ann,yes\nben,Ben,\n",
    "spaces.csv": spacesCsv,
    "posts.csv": POSTS,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  mkdirSync(path.join(dir, "media/spaces"), { recursive: true });
  writeFileSync(path.join(dir, "media/spaces/cooking.png"), PNG);
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return { slug, dir, versionId: imported.studyVersionId };
}

const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });

async function join(slug: string) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: randomUUID() }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** Someone in each condition, since blocked assignment alternates. */
async function oneInEach(slug: string) {
  const people: Record<string, { cookie: string }> = {};
  for (let i = 0; i < 4 && Object.keys(people).length < 2; i += 1) {
    const cookie = await join(slug);
    const spaces = await listSpaces(cookie);
    people[spaces.some(({ key }) => key === "secret") ? "other" : "main"] = { cookie };
  }
  return { main: people.main?.cookie as string, other: people.other?.cookie as string };
}

interface View {
  key: string;
  joined: boolean;
  rules: string | null;
  pictureUrl: string | null;
}
const listSpaces = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/spaces")).json()) as { spaces: View[] }).spaces;

interface Post {
  id: string;
  body: string;
  space?: { key: string; name: string };
  author: { moderator?: boolean };
}
const feedAt = async (cookie: string, query = "") =>
  ((await (await call(cookie, "GET", `/feed${query}`)).json()) as { posts: Post[] }).posts;
const bodies = (posts: Post[]) => posts.map(({ body }) => body);
const setJoined = (cookie: string, key: string, joined: boolean, event = meta()) =>
  call(cookie, "POST", `/spaces/${key}/membership`, { joined, ...event });

async function lastEvents() {
  return database.db.select().from(schema.events).orderBy(desc(schema.events.id)).limit(3);
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

describe("spaces", () => {
  it("shows a new participant posts with no space, and spaces they start in", async () => {
    const { slug } = await study();
    const { main } = await oneInEach(slug);
    const home = bodies(await feedAt(main));
    expect(home).toContain("no space");
    expect(home).toContain("in cooking");
    expect(home).not.toContain("in news");
    const inCooking = (await feedAt(main)).find(({ body }) => body === "in cooking");
    expect(inCooking?.space).toEqual({ key: "cooking", name: "Cooking" });
  });

  it("hides a space, and its posts, from a condition that can't see it", async () => {
    const { slug } = await study();
    const { main, other } = await oneInEach(slug);
    expect((await listSpaces(main)).map(({ key }) => key)).toEqual(["cooking", "news"]);
    expect(bodies(await feedAt(main))).not.toContain("in the secret one");
    expect(bodies(await feedAt(other))).toContain("in the secret one");
    expect((await call(main, "GET", "/feed?surface=space&space=secret")).status).toBe(404);

    const secret = (await feedAt(other)).find(({ body }) => body === "in the secret one");
    const liked = await call(main, "POST", `/content/${secret?.id}/like`, {
      active: true,
      ...meta(),
    });
    expect(liked.status).toBe(404);
  });

  it("records joining and leaving, which changes the home feed, and repeats count once", async () => {
    const { slug } = await study();
    const { main } = await oneInEach(slug);

    const event = meta();
    expect((await setJoined(main, "news", true, event)).status).toBe(200);
    expect((await setJoined(main, "news", true, event)).status).toBe(200);
    expect(bodies(await feedAt(main))).toContain("in news");
    const [joined, before] = await lastEvents();
    expect(joined).toMatchObject({ type: "space.joined", payload: { space: "news" } });
    expect(before?.type).not.toBe("space.joined");

    expect((await setJoined(main, "cooking", false)).status).toBe(200);
    expect(bodies(await feedAt(main))).not.toContain("in cooking");
    expect((await lastEvents())[0]).toMatchObject({
      type: "space.left",
      payload: { space: "cooking" },
    });
    expect((await listSpaces(main)).find(({ key }) => key === "cooking")?.joined).toBe(false);
  });

  it("shows a space's page whether or not someone has joined it", async () => {
    const { slug } = await study();
    const { main } = await oneInEach(slug);
    const page = await feedAt(main, "?surface=space&space=news");
    expect(bodies(page)).toEqual(["in news"]);

    const [row] = await database.db
      .select()
      .from(schema.feedImpressions)
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    expect(row?.surface).toBe("space");
    expect(row?.spaceId).not.toBeNull();
    expect(row?.sort).toBeNull();
  });

  it("always shows someone their own post at home, even in a space they aren't in", async () => {
    const { slug } = await study();
    const { main } = await oneInEach(slug);
    const form = new FormData();
    form.set("clientEventId", randomUUID());
    form.set("occurredAt", new Date().toISOString());
    form.set("body", "my news");
    form.set("space", "news");
    const written = await app.request("/posts", {
      method: "POST",
      headers: { cookie: main },
      body: form,
    });
    expect(written.status).toBe(200);

    const home = bodies(await feedAt(main));
    expect(home).toContain("my news");
    // Others' posts in that space still aren't there.
    expect(home).not.toContain("in news");
  });

  it("puts a post written on a space's page in that space, and refuses one it can't see", async () => {
    const { slug } = await study();
    const { main } = await oneInEach(slug);
    const send = (space: string) => {
      const form = new FormData();
      const event = meta();
      form.set("clientEventId", event.clientEventId);
      form.set("occurredAt", event.occurredAt);
      form.set("body", `mine in ${space}`);
      form.set("space", space);
      return app.request("/posts", { method: "POST", headers: { cookie: main }, body: form });
    };
    expect((await send("news")).status).toBe(200);
    expect(bodies(await feedAt(main, "?surface=space&space=news"))).toContain("mine in news");
    expect((await send("secret")).status).toBe(404);
  });

  it("keeps joining off when the study says so, and the starting spaces still apply", async () => {
    const { slug } = await study({
      platform: "{ features: { spaces: true }, canJoinSpaces: false }",
    });
    const { main } = await oneInEach(slug);
    expect((await setJoined(main, "news", true)).status).toBe(403);
    expect(bodies(await feedAt(main))).toContain("in cooking");
    expect(bodies(await feedAt(main))).not.toContain("in news");
    const flow = (await (await call(main, "GET", "/me/flow")).json()) as { canJoinSpaces: boolean };
    expect(flow.canJoinSpaces).toBe(false);
  });

  it("refuses everything when the feature's off, and every post shows in one feed", async () => {
    const { slug } = await study({ platform: "{ features: { spaces: false } }" });
    const main = await join(slug);
    expect((await call(main, "GET", "/spaces")).status).toBe(403);
    expect((await setJoined(main, "news", true)).status).toBe(403);
    expect((await call(main, "GET", "/feed?surface=space&space=news")).status).toBe(403);
    const home = await feedAt(main);
    expect(bodies(home)).toEqual(expect.arrayContaining(["in news", "in the secret one"]));
    expect(home.every(({ space }) => space === undefined)).toBe(true);
  });

  it("tags someone marked as a moderator, and nobody else", async () => {
    const { slug } = await study();
    const { main } = await oneInEach(slug);
    const home = await feedAt(main);
    expect(home.find(({ body }) => body === "no space")?.author.moderator).toBe(true);
    expect(home.find(({ body }) => body === "low cooking")?.author).not.toHaveProperty("moderator");
  });

  it("freezes with a version, and comes back when a draft opens from it", async () => {
    const { versionId } = await study();
    await expect(
      database.db
        .update(schema.spaces)
        .set({ name: "Changed" })
        .where(eq(schema.spaces.studyVersionId, versionId)),
    ).rejects.toThrow();

    const email = `${randomUUID()}@example.edu`;
    await setUpTeam(database.db, { teamName: email, slug: randomUUID(), email, name: "Owner" });
    const [researcher] = await database.db
      .select({ id: schema.researchers.id })
      .from(schema.researchers)
      .where(eq(schema.researchers.email, email));
    const opened = await openDraft(database.db, versionId, researcher?.id as string);
    const items = await database.db
      .select()
      .from(schema.draftItems)
      .where(eq(schema.draftItems.draftId, opened?.draftId as string));
    const spaces = items.filter(({ kind }) => kind === "space");
    expect(spaces).toHaveLength(3);
    const cooking = spaces.find(({ data }) => (data as { key: string }).key === "cooking");
    const posts = items.filter(({ kind }) => kind === "post");
    const inCooking = posts.filter(
      ({ data }) => (data as { spaceId?: string }).spaceId === cooking?.id,
    );
    expect(inCooking).toHaveLength(2);
    const ann = items.find(({ data }) => (data as { username?: string }).username === "ann");
    expect(ann?.data).toMatchObject({ moderator: true });
  });

  it("travels in a pack, into a new study's draft", async () => {
    const { dir } = await study();
    const saved = await savePackFromFolder(database.db, storage, dir, { name: randomUUID() });
    if (saved.status === "failed") {
      throw new Error("The pack wasn't saved.");
    }
    const [pack] = await database.db
      .select()
      .from(schema.contentPacks)
      .where(eq(schema.contentPacks.id, saved.id));

    const email = `${randomUUID()}@example.edu`;
    const { teamId } = await setUpTeam(database.db, {
      teamName: email,
      slug: randomUUID(),
      email,
      name: "Owner",
    });
    const [researcher] = await database.db
      .select({ id: schema.researchers.id })
      .from(schema.researchers)
      .where(eq(schema.researchers.email, email));
    const started = await startStudy(database.db, {
      teamId,
      researcherId: researcher?.id as string,
      slug: `from-pack-${randomUUID().slice(0, 8)}`,
      title: "From a pack",
      assignment: "uniform",
      pack: { id: saved.id, name: saved.name, contents: pack?.contents as PackContents },
    });
    if ("problem" in started) {
      throw new Error(started.message);
    }

    const loaded = await loadDraft(database.db, started.draftId);
    const spaces = loaded?.items.filter(({ kind }) => kind === "space") ?? [];
    expect(spaces).toHaveLength(3);
    const cooking = spaces.find(({ data }) => (data as { key: string }).key === "cooking");
    const inCooking = loaded?.items.filter(
      ({ kind, data }) => kind === "post" && (data as { spaceId?: string }).spaceId === cooking?.id,
    );
    expect(inCooking).toHaveLength(2);
    expect(
      checkDraft(loaded as LoadedDraft).filter(({ severity }) => severity === "error"),
    ).toEqual([]);
  });

  it("keeps a pack's spaces, and their posts, in just the background", async () => {
    const { dir } = await study();
    const saved = await savePackFromFolder(database.db, storage, dir, { name: randomUUID() });
    if (saved.status === "failed") {
      throw new Error("The pack wasn't saved.");
    }
    const [pack] = await database.db
      .select()
      .from(schema.contentPacks)
      .where(eq(schema.contentPacks.id, saved.id));

    const { teamId, researcherId } = await aTeam();
    const started = await startStudy(database.db, {
      teamId,
      researcherId,
      slug: `background-${randomUUID().slice(0, 8)}`,
      title: "Background",
      assignment: "uniform",
      keep: "background",
      pack: { id: saved.id, name: saved.name, contents: pack?.contents as PackContents },
    });
    if ("problem" in started) {
      throw new Error(started.message);
    }

    const loaded = (await loadDraft(database.db, started.draftId)) as LoadedDraft;
    const spaces = loaded.items.filter(({ kind }) => kind === "space");
    // "secret" is limited to a condition, and so is its post, by being in it, though it doesn't say.
    expect(spaces.map(({ data }) => (data as { key: string }).key).sort()).toEqual([
      "cooking",
      "news",
    ]);
    const posts = loaded.items.filter(({ kind }) => kind === "post");
    const inCooking = posts.filter(
      ({ data }) =>
        (data as { spaceId?: string }).spaceId ===
        spaces.find((space) => (space.data as { key: string }).key === "cooking")?.id,
    );
    expect(inCooking).toHaveLength(2);
    expect(checkDraft(loaded).filter(({ severity }) => severity === "error")).toEqual([]);
    expect(posts.map(({ data }) => (data as { body: string }).body)).not.toContain(
      "in the secret one",
    );
    const frozen = await freezeDraft(database.db, loaded);
    expect(frozen.status).toBe("frozen");
  });

  it("carries a space's picture from a study folder to participants, and through a pack", async () => {
    const { slug, dir } = await study({ spacesCsv: PICTURE_SPACES, media: "" });
    const { main } = await oneInEach(slug);
    const [cooking] = await listSpaces(main);
    expect(cooking?.pictureUrl).toMatch(/^http:\/\/media\.test\/media\/[0-9a-f]{64}\.png$/);

    const saved = await savePackFromFolder(database.db, storage, dir, { name: randomUUID() });
    if (saved.status === "failed") {
      throw new Error("The pack wasn't saved.");
    }
    const [pack] = await database.db
      .select()
      .from(schema.contentPacks)
      .where(eq(schema.contentPacks.id, saved.id));
    const packed = (pack?.contents as PackContents | undefined)?.spaces?.find(
      ({ key }) => key === "cooking",
    );
    expect(packed?.picture).toMatch(/^media\/[0-9a-f]{64}\.png$/);

    const { teamId, researcherId } = await aTeam();
    const started = await startStudy(database.db, {
      teamId,
      researcherId,
      slug: `picture-${randomUUID().slice(0, 8)}`,
      title: "Pictures",
      assignment: "uniform",
      pack: { id: saved.id, name: saved.name, contents: pack?.contents as PackContents },
    });
    if ("problem" in started) {
      throw new Error(started.message);
    }
    const loaded = (await loadDraft(database.db, started.draftId)) as LoadedDraft;
    const frozen = await freezeDraft(database.db, loaded);
    if (frozen.status !== "frozen") {
      throw new Error("It didn't freeze.");
    }
    const rows = await database.db
      .select({ key: schema.spaces.key, picture: schema.spaces.picture })
      .from(schema.spaces)
      .where(eq(schema.spaces.studyVersionId, frozen.studyVersionId));
    expect(rows.find(({ key }) => key === "cooking")?.picture).toBe(packed?.picture);
  });

  it("refuses a study folder whose space's picture is missing", async () => {
    await expect(
      study({
        spacesCsv: "key,name,picture\ncooking,Cooking,nope.png\nnews,News,\nsecret,Secret,\n",
        media: "",
      }),
    ).rejects.toThrow("nope.png");
  });

  it("imports the same folder again as unchanged", async () => {
    const { dir } = await study();
    const again = await importStudyFolder(database.db, storage, dir);
    expect(again.status).toBe("unchanged");
  });

  it("removes someone's choices when they withdraw", async () => {
    const { slug } = await study();
    const externalId = randomUUID();
    const response = await app.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId }),
    });
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    await setJoined(cookie, "news", true);
    await feedAt(cookie, "?surface=space&space=news");
    const before = await database.db.select().from(schema.spaceMemberships);

    const done = await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });
    expect(done.status).toBe("withdrawn");
    expect((await database.db.select().from(schema.spaceMemberships)).length).toBe(
      before.length - 1,
    );
  });

  it("exports spaces, where posts are, what was seen, and the codebook", async () => {
    const { slug } = await study();
    const { main } = await oneInEach(slug);
    await setJoined(main, "news", true);
    await feedAt(main, "?surface=space&space=news");

    const folder = mkdtempSync(path.join(tmpdir(), "truman-spaces-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const read = (file: string) => readFileSync(path.join(folder, file), "utf8");

    expect(read("spaces.csv")).toContain("cooking,Cooking,About food,Be kind,,true");
    expect(read("content.csv")).toContain(",cooking,");
    expect(read("impressions.csv")).toContain(",space,news,");
    const summary = read("summary.csv");
    expect(summary.split("\n")[0]).toContain("spaces_joined,spaces_left,sort_changes");
    const codebook = read("codebook.md");
    expect(codebook).toContain("`space.joined`: They joined a space");
    expect(codebook).toContain("### spaces.csv");
  });
});

const feedResponse = async (cookie: string, query = "") =>
  (await (await call(cookie, "GET", `/feed${query}`)).json()) as { sort: string | null };

async function aTeam() {
  const email = `${randomUUID()}@example.edu`;
  const { teamId } = await setUpTeam(database.db, {
    teamName: email,
    slug: randomUUID(),
    email,
    name: "Owner",
  });
  const [researcher] = await database.db
    .select({ id: schema.researchers.id })
    .from(schema.researchers)
    .where(eq(schema.researchers.email, email));
  return { teamId, researcherId: researcher?.id as string };
}

describe("choosing an order", () => {
  it("uses the order set for space pages, and new and top", async () => {
    const { slug } = await study({ feed: ", spaceRanker: top" });
    const { main } = await oneInEach(slug);
    expect(bodies(await feedAt(main, "?surface=space&space=cooking"))).toEqual([
      "in cooking",
      "low cooking",
    ]);
    const [row] = await database.db
      .select()
      .from(schema.feedImpressions)
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    expect(row?.ranker).toBe("top");
    expect(row?.rankerVersion).toBe("1");
    expect(row?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ position: 0, score: 3 })]),
    );
  });

  it("moves a post by one for this person's vote, as on a forum", async () => {
    const { slug } = await study({ feed: ", spaceRanker: top" });
    const { main } = await oneInEach(slug);
    const page = await feedAt(main, "?surface=space&space=cooking");
    const low = page.find(({ body }) => body === "low cooking") as Post;
    await call(main, "POST", `/content/${low.id}/vote`, { value: "up", ...meta() });
    // 2 is still below 3.
    expect(bodies(await feedAt(main, "?surface=space&space=cooking"))[0]).toBe("in cooking");
    const high = page.find(({ body }) => body === "in cooking") as Post;
    await call(main, "POST", `/content/${high.id}/vote`, { value: "down", ...meta() });
    // Now 2 and 2, and the tie goes to the newer post.
    expect(bodies(await feedAt(main, "?surface=space&space=cooking"))[0]).toBe("low cooking");
  });

  it("refuses a chosen order unless the study allows it", async () => {
    const { slug } = await study();
    const { main } = await oneInEach(slug);
    expect(
      (await call(main, "POST", "/feed/sort", { surface: "home", sort: "top", ...meta() })).status,
    ).toBe(403);
    expect((await feedResponse(main)).sort).toBeNull();
  });

  it("ignores an order in the address, so only a recorded choice sets one", async () => {
    const { slug } = await study({ feed: ", participantsCanSort: true" });
    const { main } = await oneInEach(slug);
    const before = await feedAt(main, "");
    expect(bodies(await feedAt(main, "?sort=top"))).toEqual(bodies(before));
    expect((await feedResponse(main, "?sort=top")).sort).toBeNull();
  });

  it("keeps a choice for each kind of list, and can go back to the study's", async () => {
    const { slug } = await study({ feed: ", participantsCanSort: true" });
    const { main } = await oneInEach(slug);
    const choose = (surface: string, sort: string | null) =>
      call(main, "POST", "/feed/sort", { surface, sort, ...meta() });

    await choose("home", "top");
    await choose("home", "new");
    await choose("space", "top");
    expect((await feedResponse(main)).sort).toBe("new");
    expect((await feedResponse(main, "?surface=space&space=cooking")).sort).toBe("top");

    await choose("home", null);
    expect((await feedResponse(main)).sort).toBeNull();
    expect((await feedResponse(main, "?surface=space&space=cooking")).sort).toBe("top");
  });

  it("keeps someone's choice to themselves", async () => {
    const { slug } = await study({ feed: ", participantsCanSort: true" });
    const { main, other } = await oneInEach(slug);
    await call(main, "POST", "/feed/sort", { surface: "home", sort: "top", ...meta() });
    expect((await feedResponse(other)).sort).toBeNull();
  });

  it("ignores a choice after moving to a condition that sets the order itself", async () => {
    const { slug, versionId } = await study({
      feed: ", participantsCanSort: true",
      arms: "[{ key: main }, { key: other, feed: { participantsCanSort: false } }]",
    });
    const { main } = await oneInEach(slug);
    await call(main, "POST", "/feed/sort", { surface: "home", sort: "top", ...meta() });
    expect((await feedResponse(main)).sort).toBe("top");
    const [event] = await lastEvents();
    const participantId = event?.participantId as string;

    const conditions = await database.db
      .select()
      .from(schema.conditions)
      .where(eq(schema.conditions.studyVersionId, versionId));
    const moveTo = async (key: string) => {
      await database.db.insert(schema.assignments).values({
        participantId,
        studyVersionId: versionId,
        conditionId: conditions.find((condition) => condition.key === key)?.id as string,
        decisionPoint: `move-${key}`,
        method: "test",
        probability: 1,
      });
    };

    await moveTo("other");
    expect((await feedResponse(main)).sort).toBeNull();
    const [row] = await database.db
      .select()
      .from(schema.feedImpressions)
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    expect(row?.sort).toBeNull();

    // Their choice is still theirs if they come back.
    await moveTo("main");
    expect((await feedResponse(main)).sort).toBe("top");
  });

  it("records each choice, and the order on each feed it applied to", async () => {
    const { slug } = await study({ feed: ", participantsCanSort: true" });
    const { main } = await oneInEach(slug);
    const chosen = await call(main, "POST", "/feed/sort", {
      surface: "home",
      sort: "top",
      ...meta(),
    });
    expect(chosen.status).toBe(200);
    expect((await lastEvents())[0]).toMatchObject({
      type: "feed.sort_changed",
      payload: { surface: "home", sort: "top" },
    });

    await feedAt(main);
    const [row] = await database.db
      .select()
      .from(schema.feedImpressions)
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    expect(row).toMatchObject({ surface: "feed", sort: "top", ranker: "top" });
  });
});

describe("a space's address", () => {
  async function draftWithSpaces() {
    const { teamId, researcherId } = await aTeam();
    const started = await startStudy(database.db, {
      teamId,
      researcherId,
      slug: `keys-${randomUUID().slice(0, 8)}`,
      title: "Keys",
      assignment: "uniform",
    });
    if ("problem" in started) {
      throw new Error(started.message);
    }
    const add = async (name: string) => {
      const made = await createItem(database.db, started.draftId, researcherId, "space", {
        name,
        startsJoined: true,
        conditions: [],
      });
      if ("problem" in made) {
        throw new Error(made.message);
      }
      return made.id;
    };
    const keyOf = async (id: string) => {
      const loaded = (await loadDraft(database.db, started.draftId)) as LoadedDraft;
      const found = loaded.items.find((item) => item.id === id);
      return (found?.data as { key: string } | undefined)?.key;
    };
    const change = (id: string, changes: Record<string, unknown>) =>
      updateItem(database.db, started.draftId, id, researcherId, changes);
    return { draftId: started.draftId, add, keyOf, change };
  }

  it("makes a readable key from the name, and keeps it unique", async () => {
    expect(spaceKeyFromName("Home Cooking!")).toBe("home-cooking");
    expect(spaceKeyFromName("Crème brûlée")).toBe("creme-brulee");
    expect(spaceKeyFromName("料理")).toBe("space");

    const { add, keyOf } = await draftWithSpaces();
    expect(await keyOf(await add("New space"))).toBe("new-space");
    expect(await keyOf(await add("New space"))).toBe("new-space-2");
  });

  it("follows the name until someone chooses one", async () => {
    const { add, keyOf, change } = await draftWithSpaces();
    const id = await add("New space");
    await change(id, { name: "Cooking" });
    expect(await keyOf(id)).toBe("cooking");

    await change(id, { key: "food" });
    await change(id, { name: "Baking" });
    expect(await keyOf(id)).toBe("food");
  });

  it("refuses one that's unsafe in an address, or already used", async () => {
    const { add, change } = await draftWithSpaces();
    await add("Cooking");
    const id = await add("News");
    for (const key of ["Has Spaces", "UPPER", "a/b", "../up", "-start", "x".repeat(51)]) {
      expect(await change(id, { key })).toMatchObject({ problem: "invalid" });
    }
    expect(await change(id, { key: "cooking" })).toMatchObject({ problem: "in-use" });
  });

  it("keeps its key once a saved version has it, including in a later draft", async () => {
    const { versionId } = await study();
    const { researcherId } = await aTeam();
    const opened = await openDraft(database.db, versionId, researcherId);
    const draftId = opened?.draftId as string;
    const loaded = (await loadDraft(database.db, draftId)) as LoadedDraft;
    const cooking = loaded.items.find(
      ({ kind, data }) => kind === "space" && (data as { key: string }).key === "cooking",
    );
    const id = cooking?.id as string;

    expect(await updateItem(database.db, draftId, id, researcherId, { key: "food" })).toMatchObject(
      {
        problem: "in-use",
      },
    );
    // Renaming it is fine, and leaves the key alone.
    await updateItem(database.db, draftId, id, researcherId, { name: "Food" });
    const after = (await loadDraft(database.db, draftId)) as LoadedDraft;
    expect(after.items.find((item) => item.id === id)?.data).toMatchObject({
      key: "cooking",
      name: "Food",
    });
  });

  it("isn't a change other kinds of item can make", async () => {
    const { draftId } = await draftWithSpaces();
    const { researcherId } = await aTeam();
    const made = await createItem(database.db, draftId, researcherId, "actor", {
      username: "someone",
      name: "Someone",
      conditions: [],
    });
    if ("problem" in made) {
      throw new Error(made.message);
    }
    expect(
      await updateItem(database.db, draftId, made.id, researcherId, { key: "x" }),
    ).toMatchObject({
      problem: "invalid",
    });
  });
});
