import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedResponse, StoryGroup } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { freezeDraft, loadDraft, openDraft } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const STORIES = `id,actor,picture,caption,time,lastsHours,condition
s1,ann,s1.jpg,First,-3:00,,
s2,ann,s2.jpg,,-2:00,,
s3,bob,s3.jpg,Bob's,-1:00,,
old,bob,s4.jpg,Gone,-30:00,,
short,bob,s5.jpg,Gone soon,-3:00,2,
later,ann,s6.jpg,Not yet,5:00,,
b_only,bob,s7.jpg,Only b,-1:00,,b
`;

async function study({
  stories = STORIES,
  reactions = "",
  platform = "",
}: {
  stories?: string;
  reactions?: string;
  platform?: string;
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-photo-"));
  dirs.push(dir);
  const slug = `photo-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Photo
site: { name: Demo }
length: { days: 3 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }, { key: b }]
platform: { style: photo, template: photo ${platform} }
feed: { ranker: chronological }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\nbob,Bob\n",
    "posts.csv":
      "id,body,picture,actor,likes,likedBy,time\np1,Hi,a.jpg,ann,108,bob,-6:00\np2,Two,b.jpg,bob,1,ann,-5:00\n",
    "stories.csv": stories,
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
const storiesOf = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/stories")).json()) as { stories: StoryGroup[] }).stories;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
function postStory(cookie: string, caption = "Mine") {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), caption })) {
    form.set(key, value);
  }
  form.set("image", new File([PNG], "mine.png", { type: "image/png" }));
  return app.request("/stories", { method: "POST", headers: { cookie }, body: form });
}
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

describe("stories", () => {
  it("shows what's up now, grouped by who posted it, and nothing that's ended or to come", async () => {
    const { slug, versionId } = await study();
    const groups = await storiesOf(await join(slug));
    const condition = await conditionOf(versionId);
    expect(groups.map(({ author }) => author.username)).toEqual(["bob", "ann"]);
    const bob = groups.find(({ author }) => author.username === "bob");
    expect(bob?.stories.map(({ caption }) => caption)).toEqual(
      condition === "b" ? ["Bob's", "Only b"] : ["Bob's"],
    );
    const ann = groups.find(({ author }) => author.username === "ann");
    expect(ann?.stories.map(({ caption }) => caption ?? null)).toEqual(["First", null]);
    expect(ann?.allSeen).toBe(false);
  });

  it("records each one seen, and puts what's all seen after the rest", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const [first] = await storiesOf(cookie);
    for (const story of first?.stories ?? []) {
      const seen = await call(cookie, "POST", `/stories/${story.id}/viewed`, {
        ...meta(),
        dwellMs: 1200,
        ended: "next",
      });
      expect(seen.status).toBe(200);
    }
    const after = await storiesOf(cookie);
    expect(after.at(-1)?.author.username).toBe(first?.author.username);
    expect(after.at(-1)?.allSeen).toBe(true);
    const events = await database.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "story.viewed"));
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.payload).toEqual({ dwellMs: 1200, ended: "next" });
  });

  it("lets a participant post one, first in the row, with who viewed it", async () => {
    const { slug } = await study({
      reactions: "on,nth,type,actor,after\nstory,0,read,ann,0:00\nstory,0,read,bob,1:00\n",
    });
    const cookie = await join(slug);
    const made = await postStory(cookie);
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };
    const [mine] = await storiesOf(cookie);
    expect(mine?.author.isViewer).toBe(true);
    expect(mine?.stories[0]?.caption).toBe("Mine");

    const viewers = (await (await call(cookie, "GET", `/stories/${id}/viewers`)).json()) as {
      viewers: { username: string }[];
    };
    expect(viewers.viewers.map(({ username }) => username)).toEqual(["ann"]);

    // Who saw it isn't a notification, as on these platforms.
    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: unknown[];
    };
    expect(notifications).toEqual([]);

    // Someone else's viewers aren't theirs to see.
    const [other] = (await storiesOf(cookie)).filter(({ author }) => !author.isViewer);
    const theirs = await call(cookie, "GET", `/stories/${other?.stories[0]?.id}/viewers`);
    expect(theirs.status).toBe(404);
  });

  it("isn't a post, and stays out of feeds and profiles", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    await postStory(cookie, "Not in the feed");
    const posts = ((await (await call(cookie, "GET", "/feed")).json()) as FeedResponse).posts;
    expect(posts.map(({ body }) => body)).toEqual(["Two", "Hi"]);
  });

  it("is refused, and empty, with the feature off", async () => {
    const { slug } = await study({ platform: ", features: { stories: false }" });
    const cookie = await join(slug);
    expect(await storiesOf(cookie)).toEqual([]);
    expect((await postStory(cookie)).status).toBe(403);
  });

  it("is in the export, goes with a withdrawal, and stays through a draft", async () => {
    const { slug, versionId } = await study();
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    await postStory(cookie);
    const folder = mkdtempSync(path.join(tmpdir(), "truman-photo-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const content = parse(readFileSync(path.join(folder, "content.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    expect(content.find(({ source_ref }) => source_ref === "short")?.lasts_ms).toBe("7200000");
    expect(content.filter(({ kind }) => kind === "story").length).toBe(8);
    expect(content.find(({ source_ref }) => source_ref === "p1")?.liked_by).toBe("bob");

    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });
    expect(result.status).toBe("withdrawn");

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
    expect(draft?.items.filter(({ kind }) => kind === "story")).toHaveLength(7);
    expect(draft?.items.filter(({ kind }) => kind === "post")).toHaveLength(2);
    const frozen = await freezeDraft(database.db, draft as NonNullable<typeof draft>);
    // Unchanged, so it's the same version.
    expect(frozen.status).toBe("unchanged");
    const stored = await database.db
      .select()
      .from(schema.content)
      .where(and(eq(schema.content.studyVersionId, versionId), eq(schema.content.kind, "story")));
    expect(stored.filter(({ worldId }) => worldId === null)).toHaveLength(7);
  });
});

describe("liked by", () => {
  it("names someone in the cast who liked it", async () => {
    const { slug } = await study();
    const posts = ((await (await call(await join(slug), "GET", "/feed")).json()) as FeedResponse)
      .posts;
    expect(posts.find(({ body }) => body === "Hi")?.likedBy).toBe("Bob");
    expect(posts.find(({ body }) => body === "Two")?.likedBy).toBe("Ann");
  });
});
