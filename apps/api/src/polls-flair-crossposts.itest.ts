import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse, SpaceView } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import {
  freezeDraft,
  loadDraft,
  openDraft,
  type PackContents,
  savePackFromFolder,
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

const POSTS = `id,title,body,actor,space,poll,pollResultsFirst,flair,crosspostOf,tags,time,condition
hidden-results,Hidden results,Text,ann,cooking,Yes=12|No=3,,Question,,,-5:00,
open-results,Open results,Text,ann,cooking,Red=4|Blue=6,yes,,,,-5:00,
first,The first post,Hello,ann,cooking,,,,,,-5:00,
copy,A scripted crosspost,,ann,garden,,,,first,,-4:00,
later,Comes later,Soon,ann,cooking,,,,,,5:00,
copy-of-later,Crosspost of something later,,ann,garden,,,,later,,-4:00,
only-b,Only in b,Secret,ann,cooking,,,,,,-5:00,b
copy-of-b,Crosspost of something in b,,ann,garden,,,,only-b,,-4:00,
covered,Covered,Secret,ann,cooking,,,,,spoiler,-5:00,
copy-of-covered,Crosspost of a spoiler,,ann,garden,,,,covered,,-4:00,
`;

async function study({
  template = "forum",
  platform = "",
  arms = "[{ key: a }, { key: b }]",
  requireFlair = false,
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-polls-"));
  dirs.push(dir);
  const slug = `polls-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Polls
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
    "actors.csv": "username,name,flair\nann,Ann,cooking=Chef|garden=Novice\n",
    "spaces.csv": `key,name,postFlair,userFlair,requirePostFlair,startsJoined
cooking,Cooking,Question=#1d4ed8|News,Chef|Home cook,${requireFlair ? "yes" : ""},yes
garden,Garden,,Novice,,yes
unjoined,Unjoined,,,,no
`,
    "posts.csv": POSTS,
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

const pollOf = (posts: FeedPost[], title: string) => titled(posts, title).poll;

describe("polls", () => {
  it("keeps counts from a browser until someone votes, unless results show first", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const posts = await list(cookie);
    expect(pollOf(posts, "Hidden results")).toEqual({
      voted: null,
      options: [{ text: "Yes" }, { text: "No" }],
    });
    expect(pollOf(posts, "Open results")?.options).toEqual([
      { text: "Red", votes: 4 },
      { text: "Blue", votes: 6 },
    ]);

    const id = titled(posts, "Hidden results").id;
    expect((await act(cookie, id, "poll", { option: 1 })).status).toBe(200);
    expect(pollOf(await list(cookie), "Hidden results")).toEqual({
      voted: 1,
      options: [
        { text: "Yes", votes: 12 },
        { text: "No", votes: 4 },
      ],
    });
  });

  it("allows one choice, which can't change, and records it", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const id = titled(await list(cookie), "Hidden results").id;
    expect((await act(cookie, id, "poll", { option: 5 })).status).toBe(400);
    const choice = meta();
    expect((await act(cookie, id, "poll", { ...choice, option: 0 })).status).toBe(200);
    // The same action arriving twice is fine, and a different one isn't.
    expect((await act(cookie, id, "poll", { ...choice, option: 0 })).status).toBe(200);
    expect((await act(cookie, id, "poll", { option: 1 })).status).toBe(409);
    expect(pollOf(await list(cookie), "Hidden results")?.voted).toBe(0);

    const events = (await eventsOf("content.poll_voted")).filter(
      (event) => event.targetContentId === id,
    );
    expect(events.map((event) => event.payload)).toEqual([{ option: 0 }]);
  });

  it("refuses two votes sent at once", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const id = titled(await list(cookie), "Hidden results").id;
    const statuses = await Promise.all(
      [0, 1].map(async (option) => (await act(cookie, id, "poll", { option })).status),
    );
    expect(statuses.sort()).toEqual([200, 409]);
  });

  it("is refused and not sent when the feature is off", async () => {
    const { slug } = await study({ platform: ", features: { polls: false }" });
    const cookie = await join(slug);
    const posts = await list(cookie);
    expect(titled(posts, "Hidden results").poll).toBeUndefined();
    const id = titled(posts, "Hidden results").id;
    expect((await act(cookie, id, "poll", { option: 0 })).status).toBe(403);
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...meta(), title: "T", body: "B" })) {
      form.set(key, value);
    }
    form.append("pollOption", "One");
    form.append("pollOption", "Two");
    const refused = await app.request("/posts", {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    expect(refused.status).toBe(403);
  });

  it("lets a participant add one to their post, with limits", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const send = (options: string[]) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...meta(), title: "My poll" })) {
        form.set(key, value);
      }
      for (const option of options) {
        form.append("pollOption", option);
      }
      return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
    };
    expect((await send(["Only one"])).status).toBe(400);
    expect((await send(["Same", "same"])).status).toBe(400);
    expect((await send(["1", "2", "3", "4", "5", "6", "7"])).status).toBe(400);
    expect((await send(["Here", "There"])).status).toBe(200);
    const poll = pollOf(await list(cookie), "My poll");
    expect(poll).toEqual({ voted: null, options: [{ text: "Here" }, { text: "There" }] });
  });
});

describe("flair", () => {
  const spaces = async (cookie: string) =>
    ((await (await call(cookie, "GET", "/spaces")).json()) as { spaces: SpaceView[] }).spaces;

  it("shows on posts and people, with what the study wrote", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const post = titled(await list(cookie), "Hidden results");
    expect(post.flair).toEqual({ text: "Question", color: "#1d4ed8" });
    expect(post.author.flair).toEqual({ text: "Chef" });
    // The same person shows what they have in that community.
    expect(titled(await list(cookie), "A scripted crosspost").author.flair).toEqual({
      text: "Novice",
    });
  });

  it("only takes a post's flair from its community's list, and enforces a requirement", async () => {
    const { slug } = await study({ requireFlair: true });
    const cookie = await join(slug);
    const base = { title: "With flair", space: "cooking" };
    expect((await postForm(cookie, base)).status).toBe(400);
    expect((await postForm(cookie, { ...base, flair: "Made up" })).status).toBe(400);
    expect((await postForm(cookie, { title: "No space", flair: "News" })).status).toBe(400);
    expect((await postForm(cookie, { ...base, flair: "News" })).status).toBe(200);
    expect(titled(await list(cookie), "With flair").flair).toEqual({ text: "News" });
  });

  it("isn't required, sent, or accepted when the feature is off", async () => {
    const { slug } = await study({ requireFlair: true, platform: ", features: { flair: false }" });
    const cookie = await join(slug);
    const base = { title: "No flair", space: "cooking" };
    expect((await postForm(cookie, { ...base, flair: "News" })).status).toBe(403);
    expect((await postForm(cookie, base)).status).toBe(200);
    const post = titled(await list(cookie), "Hidden results");
    expect(post.flair).toBeUndefined();
    expect(post.author.flair).toBeUndefined();
    expect((await spaces(cookie))[0]?.postFlair).toEqual([]);
    const chosen = await call(cookie, "POST", "/spaces/cooking/flair", {
      ...meta(),
      flair: "Chef",
    });
    expect(chosen.status).toBe(403);
  });

  it("lets someone choose their own, from the list, where they've joined", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const choose = (space: string, flair: string | null) =>
      call(cookie, "POST", `/spaces/${space}/flair`, { ...meta(), flair });
    expect((await choose("cooking", "Made up")).status).toBe(400);
    expect((await choose("unjoined", null)).status).toBe(403);
    expect((await choose("nowhere", null)).status).toBe(404);
    expect((await choose("cooking", "Home cook")).status).toBe(200);

    const space = (await spaces(cookie)).find(({ key }) => key === "cooking");
    expect(space?.myFlair).toBe("Home cook");
    expect(space?.joined).toBe(true);
    await postForm(cookie, { title: "Mine", space: "cooking" });
    expect(titled(await list(cookie), "Mine").author.flair).toEqual({ text: "Home cook" });
    expect((await eventsOf("space.flair_chosen"))[0]?.payload).toEqual({
      space: "cooking",
      flair: "Home cook",
    });

    expect((await choose("cooking", null)).status).toBe(200);
    expect(titled(await list(cookie), "Mine").author.flair).toBeUndefined();
  });
});

describe("crossposting", () => {
  const crosspost = (cookie: string, id: string, fields: object) =>
    act(cookie, id, "crosspost", fields);

  it("makes a new post with its own votes and comments, showing where it came from", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const first = titled(await list(cookie), "The first post");
    expect((await act(cookie, first.id, "vote", { value: "up" })).status).toBe(200);

    const made = await crosspost(cookie, first.id, { space: "garden", title: "Look at this" });
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };

    const posts = await list(cookie);
    const copy = titled(posts, "Look at this");
    expect(copy.id).toBe(id);
    expect(copy.space?.key).toBe("garden");
    expect(copy.ups).toBe(0);
    expect(copy.crosspost?.original).toMatchObject({
      id: first.id,
      title: "The first post",
      body: "Hello",
      authorName: "Ann",
      space: { key: "cooking", name: "Cooking" },
    });

    expect((await act(cookie, id, "comments", { body: "On the copy" })).status).toBe(200);
    const page = await list(cookie, `?surface=post&post=${first.id}`);
    expect(page[0]?.commentCount).toBe(0);

    const event = (await eventsOf("content.created")).find(
      ({ targetContentId }) => targetContentId === id,
    );
    expect(event?.payload).toEqual({ kind: "post", crosspostOf: first.id });
  });

  it("uses the original's title, and a repeat of the action makes one post", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const first = titled(await list(cookie), "The first post");
    const once = { ...meta(), space: "garden" };
    const made = await crosspost(cookie, first.id, once);
    const again = await crosspost(cookie, first.id, once);
    expect(((await again.json()) as { id: string }).id).toBe(
      ((await made.json()) as { id: string }).id,
    );
    const titles = (await list(cookie)).filter(
      ({ title, crosspost: isCopy }) => title === "The first post" && isCopy,
    );
    expect(titles).toHaveLength(1);
  });

  it("only goes into a community they've joined, and not where it already is", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const first = titled(await list(cookie), "The first post");
    expect((await crosspost(cookie, first.id, { space: "unjoined" })).status).toBe(403);
    expect((await crosspost(cookie, first.id, { space: "cooking" })).status).toBe(400);
    expect((await crosspost(cookie, first.id, { space: "nowhere" })).status).toBe(404);
  });

  it("only works on what they can see", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const other = await join(slug);
    await postForm(other, { title: "Theirs", space: "cooking" });
    const theirs = titled(await list(other), "Theirs");
    expect((await crosspost(cookie, theirs.id, { space: "garden" })).status).toBe(404);

    const future = await database.db
      .select({ id: schema.content.id })
      .from(schema.content)
      .where(eq(schema.content.sourceRef, "later"))
      .orderBy(desc(schema.content.createdAt))
      .limit(1);
    expect((await crosspost(cookie, future[0]?.id as string, { space: "garden" })).status).toBe(
      404,
    );
  });

  it("points a crosspost of a crosspost at the first post", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const posts = await list(cookie);
    const copy = titled(posts, "A scripted crosspost");
    const first = titled(posts, "The first post");
    // It's in garden, and the first is in cooking, so neither can take it.
    expect((await crosspost(cookie, copy.id, { space: "cooking" })).status).toBe(400);
    await call(cookie, "POST", "/spaces/unjoined/membership", { ...meta(), joined: true });
    const made = await crosspost(cookie, copy.id, { space: "unjoined", title: "Twice" });
    expect(made.status).toBe(200);
    expect(titled(await list(cookie), "Twice").crosspost?.original?.id).toBe(first.id);
  });

  it("sends nothing of an original this viewer can't see", async () => {
    const { slug } = await study();
    // Someone in the condition that doesn't have the original.
    let cookie = await join(slug);
    while (titled(await list(cookie), "Only in b")) {
      cookie = await join(slug);
    }
    const posts = await list(cookie);
    expect(titled(posts, "Crosspost of something later").crosspost).toEqual({ original: null });
    const hidden = titled(posts, "Crosspost of something in b");
    expect(hidden.crosspost).toEqual({ original: null });
    expect(JSON.stringify(hidden)).not.toContain("Secret");
  });

  it("is covered by a tag on its original, and uncovering it is recorded", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const copy = titled(await list(cookie), "Crosspost of a spoiler");
    expect(copy.tags).toEqual(["spoiler"]);
    expect((await act(cookie, copy.id, "reveal")).status).toBe(200);
    expect((await eventsOf("content.revealed"))[0]?.payload).toEqual({ tags: ["spoiler"] });
  });

  it("is refused without the features it needs, and shows as an ordinary post when off", async () => {
    const { slug } = await study({ platform: ", features: { crossposting: false }" });
    const cookie = await join(slug);
    const posts = await list(cookie);
    expect(titled(posts, "A scripted crosspost").crosspost).toBeUndefined();
    const first = titled(posts, "The first post");
    expect((await crosspost(cookie, first.id, { space: "garden" })).status).toBe(403);

    const { slug: noPosting } = await study({ platform: ", features: { posting: false }" });
    const other = await join(noPosting);
    const id = titled(await list(other), "The first post").id;
    expect((await crosspost(other, id, { space: "garden" })).status).toBe(403);
  });
});

describe("withdrawing", () => {
  it("removes votes, flair, and crossposts, including one of their own post", async () => {
    const { slug } = await study();
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    const posts = await list(cookie);
    await act(cookie, titled(posts, "Hidden results").id, "poll", { option: 0 });
    await call(cookie, "POST", "/spaces/cooking/flair", { ...meta(), flair: "Chef" });
    const scripted = await act(cookie, titled(posts, "The first post").id, "crosspost", {
      space: "garden",
      title: "Of a scripted one",
    });
    const own = await postForm(cookie, { title: "My own", space: "cooking" });
    const { id: ownId } = (await own.json()) as { id: string };
    const ofOwn = await act(cookie, ownId, "crosspost", { space: "garden", title: "Of my own" });
    expect([scripted.status, ofOwn.status]).toEqual([200, 200]);

    const [{ worldId } = { worldId: null }] = await database.db
      .select({ worldId: schema.content.worldId })
      .from(schema.content)
      .where(eq(schema.content.id, ownId));

    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });
    expect(result.status).toBe("withdrawn");

    const where = worldId as string;
    const remaining = async (table: typeof schema.content | typeof schema.spaceMemberships) =>
      database.db.select().from(table).where(eq(table.worldId, where));
    expect(await remaining(schema.content)).toEqual([]);
    expect(await remaining(schema.spaceMemberships)).toEqual([]);
    expect(
      await database.db
        .select()
        .from(schema.contentInteractions)
        .where(eq(schema.contentInteractions.worldId, where)),
    ).toEqual([]);
    expect(
      await database.db.select().from(schema.events).where(eq(schema.events.worldId, where)),
    ).toEqual([]);
  });
});

describe("drafts and packs", () => {
  const researcher = async () => {
    const id = randomUUID().slice(0, 8);
    const { teamId } = await setUpTeam(database.db, {
      teamName: `lab-${id}`,
      slug: `lab-${id}`,
      email: `${id}@example.edu`,
      name: "Owner",
    });
    const [member] = await database.db
      .select({ id: schema.researchers.id })
      .from(schema.researchers)
      .where(eq(schema.researchers.email, `${id}@example.edu`));
    return { teamId, researcherId: member?.id as string };
  };

  const expectItCarriesThrough = (items: { kind: string; id: string; data: unknown }[]) => {
    const of = (kind: string) =>
      items.filter((item) => item.kind === kind) as { id: string; data: Record<string, never> }[];
    const byRef = (ref: string) => of("post").find(({ data }) => data.ref === ref);
    const cooking = of("space").find(({ data }) => data.key === "cooking");
    expect(byRef("hidden-results")?.data).toMatchObject({
      flair: "Question",
      poll: {
        resultsFirst: false,
        options: [
          { text: "Yes", votes: 12 },
          { text: "No", votes: 3 },
        ],
      },
    });
    expect(byRef("copy")?.data).toMatchObject({ crosspostOfId: byRef("first")?.id });
    expect(cooking?.data).toMatchObject({
      postFlair: [{ text: "Question", color: "#1d4ed8" }, { text: "News" }],
      userFlair: [{ text: "Chef" }, { text: "Home cook" }],
    });
    expect(
      (of("actor")[0]?.data as unknown as { spaceFlair?: object } | undefined)?.spaceFlair,
    ).toMatchObject({
      [cooking?.id as string]: "Chef",
    });
  };

  it("goes from a version to a draft and freezes the same", async () => {
    const { versionId } = await study();
    const { researcherId } = await researcher();
    const opened = await openDraft(database.db, versionId, researcherId);
    const loaded = await loadDraft(database.db, opened?.draftId as string);
    expectItCarriesThrough(loaded?.items ?? []);
    const anyPost = loaded?.items.find(({ kind }) => kind === "post");
    await updateItem(database.db, opened?.draftId as string, anyPost?.id as string, researcherId, {
      body: "Changed, so it's a new version",
    });
    const changed = await loadDraft(database.db, opened?.draftId as string);
    const frozen = await freezeDraft(database.db, changed as NonNullable<typeof changed>);
    expect(frozen.status).toBe("frozen");
    const rows = await database.db
      .select()
      .from(schema.content)
      .where(eq(schema.content.sourceRef, "copy"))
      .orderBy(desc(schema.content.createdAt));
    const first = await database.db
      .select()
      .from(schema.content)
      .where(eq(schema.content.id, rows[0]?.crosspostOf as string));
    expect(first[0]?.sourceRef).toBe("first");
    expect(first[0]?.studyVersionId).toBe(rows[0]?.studyVersionId);
  });

  it("travels in a pack", async () => {
    const { dir } = await study();
    const { teamId, researcherId } = await researcher();
    const saved = await savePackFromFolder(database.db, storage, dir, { name: randomUUID() });
    if (saved.status === "failed") {
      throw new Error("It should have saved.");
    }
    const [pack] = await database.db
      .select()
      .from(schema.contentPacks)
      .where(eq(schema.contentPacks.id, saved.id));
    const started = await startStudy(database.db, {
      teamId,
      researcherId,
      slug: `from-pack-${randomUUID().slice(0, 8)}`,
      title: "From a pack",
      assignment: "uniform",
      pack: { id: saved.id, name: saved.name, contents: pack?.contents as PackContents },
    });
    if (!("draftId" in started)) {
      throw new Error("It should have started.");
    }
    const loaded = await loadDraft(database.db, started.draftId);
    expectItCarriesThrough(loaded?.items ?? []);
  });
});

describe("the export", () => {
  it("has what a study wrote and what a participant did", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const posts = await list(cookie);
    await act(cookie, titled(posts, "Hidden results").id, "poll", { option: 1 });
    await act(cookie, titled(posts, "The first post").id, "crosspost", {
      space: "garden",
      title: "Exported copy",
    });

    const folder = mkdtempSync(path.join(tmpdir(), "truman-polls-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const read = (name: string) => readFileSync(path.join(folder, name), "utf8");
    const content = read("content.csv");
    expect(content).toContain("Yes");
    expect(content).toContain("crosspost_of");
    expect(content).toContain("Question");
    expect(read("spaces.csv")).toContain("Question|News");
    expect(read("events.csv")).toContain("content.poll_voted");
    expect(read("codebook.md")).toContain("content.poll_voted");
  });
});
