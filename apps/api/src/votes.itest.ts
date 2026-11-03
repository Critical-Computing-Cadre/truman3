import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

/** One condition with votes and one without, sharing the same content. */
async function study() {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-votes-"));
  dirs.push(dir);
  const slug = `votes-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Votes
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms:
    - key: voting
      platform: { features: { votes: true } }
    - key: plain
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\nben,Ben\n",
    "posts.csv": "id,body,actor,likes,ups,downs,time\np1,hello,ann,3,12,2,-1:00\n",
    "comments.csv": "id,body,actor,postID,ups,downs,time\nc1,a comment,ben,p1,5,1,-0:30\n",
    "reactions.csv":
      "on,nth,type,actor,after,body\npost,0,down,ben,0:00,\npost,0,up,ann,0:00,\npost,0,like,ann,0:00,\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return slug;
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

async function oneInEach(slug: string) {
  const people: Record<string, string> = {};
  for (let i = 0; i < 4 && Object.keys(people).length < 2; i += 1) {
    const cookie = await join(slug);
    const flow = (await (await call(cookie, "GET", "/me/flow")).json()) as {
      features: { votes: boolean };
    };
    people[flow.features.votes ? "voting" : "plain"] = cookie;
  }
  return people as { voting: string; plain: string };
}

interface Votable {
  id: string;
  ups: number;
  downs: number;
  vote: string | null;
  likes: number;
  body: string;
}
type Feed = { posts: (Votable & { comments: Votable[] })[] };
const firstPost = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/feed")).json()) as Feed).posts.find(
    ({ body }) => body === "hello",
  ) as Feed["posts"][number];
const vote = (cookie: string, id: string, value: "up" | "down" | null, event = meta()) =>
  call(cookie, "POST", `/content/${id}/vote`, { value, ...event });

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

describe("votes", () => {
  it("starts from the written counts, on posts and comments", async () => {
    const { voting } = await oneInEach(await study());
    const post = await firstPost(voting);
    expect(post).toMatchObject({ ups: 12, downs: 2, vote: null });
    expect(post.comments[0]).toMatchObject({ ups: 5, downs: 1, vote: null });
  });

  it("gives someone one vote, which they can change or take back", async () => {
    const { voting } = await oneInEach(await study());
    const { id } = await firstPost(voting);

    expect((await vote(voting, id, "up")).status).toBe(200);
    expect(await firstPost(voting)).toMatchObject({ ups: 13, downs: 2, vote: "up" });

    await vote(voting, id, "down");
    expect(await firstPost(voting)).toMatchObject({ ups: 12, downs: 3, vote: "down" });

    await vote(voting, id, null);
    expect(await firstPost(voting)).toMatchObject({ ups: 12, downs: 2, vote: null });
  });

  it("works on comments too", async () => {
    const { voting } = await oneInEach(await study());
    const comment = (await firstPost(voting)).comments[0] as Votable;
    await vote(voting, comment.id, "down");
    expect((await firstPost(voting)).comments[0]).toMatchObject({ downs: 2, vote: "down" });
  });

  it("counts a repeated request once", async () => {
    const { voting } = await oneInEach(await study());
    const { id } = await firstPost(voting);
    const event = meta();
    await vote(voting, id, "up", event);
    await vote(voting, id, "up", event);
    expect((await firstPost(voting)).ups).toBe(13);
  });

  it("refuses a vote where the feature's off", async () => {
    const { plain } = await oneInEach(await study());
    const { id } = await firstPost(plain);
    expect((await vote(plain, id, "up")).status).toBe(403);
  });

  it("adds scripted votes to a participant's post without notifying them", async () => {
    const { voting, plain } = await oneInEach(await study());
    const write = (cookie: string) => {
      const form = new FormData();
      form.set("body", "mine");
      form.set("clientEventId", randomUUID());
      form.set("occurredAt", new Date().toISOString());
      return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
    };
    expect((await write(voting)).status).toBe(200);
    expect((await write(plain)).status).toBe(200);

    const mine = async (cookie: string) =>
      ((await (await call(cookie, "GET", "/feed")).json()) as Feed).posts.find(
        ({ body }) => body === "mine",
      ) as Votable;
    expect(await mine(voting)).toMatchObject({ ups: 1, downs: 1, likes: 1 });
    expect(await mine(plain)).toMatchObject({ ups: 0, downs: 0, likes: 1 });

    const { notifications } = (await (await call(voting, "GET", "/notifications")).json()) as {
      notifications: { type: string }[];
    };
    expect(notifications.map(({ type }) => type)).toEqual(["like"]);
  });

  it("exports the written counts and what people did", async () => {
    const slug = await study();
    const { voting } = await oneInEach(slug);
    const { id } = await firstPost(voting);
    await vote(voting, id, "up");
    await vote(voting, id, "down");

    const out = mkdtempSync(path.join(tmpdir(), "truman-votes-out-"));
    dirs.push(out);
    await exportStudy(database.db, slug, out);
    const lines = (name: string) => readFileSync(path.join(out, name), "utf8").split("\n");
    const [header, ...rows] = lines("summary.csv");
    const column = (header as string).split(",").indexOf("content_downvoted");
    const counts = rows.map((row) => row.split(",")[column]);
    expect(counts).toContain("1");
    expect(lines("content.csv")[0]).toContain("base_ups");
  });
});
