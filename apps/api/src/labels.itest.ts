import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { freezeDraft, loadDraft, openDraft } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadVersion, previewFeed } from "./admin/preview.ts";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const LABELS = `on,target,actor,time,label,hides,reason,condition
post,spam,sam,-1:00,Spam,yes,Selling things,
post,odd,sam,-1:00,Misleading,no,,
post,later,sam,50:00,Spam,yes,,
comment,rude,sam,-1:00,Rude,yes,,
post,b_only,sam,-1:00,Spam,yes,,b
`;

async function study({
  features = "{ labels: true, appeals: true }",
  reactions = "",
  appealAnswers = "",
}: {
  features?: string;
  reactions?: string;
  appealAnswers?: string;
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-labels-"));
  dirs.push(dir);
  const slug = `labels-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Labels
site: { name: Demo }
length: { days: 5 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }, { key: b }]
platform: { style: text, template: shortPosts, features: ${features} }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name,moderator\nann,Ann,\nsam,Sam the Mod,yes\n",
    "posts.csv": `id,body,actor,time
spam,Buy my stuff,ann,-5:00
odd,The moon is cheese,ann,-5:00
later,Not yet labeled,ann,-5:00
b_only,Labeled in b only,ann,-5:00
`,
    "comments.csv": "id,body,actor,postID,time\nrude,Something rude,ann,odd,-4:00\n",
    "labels.csv": LABELS,
    ...(reactions ? { "reactions.csv": reactions } : {}),
    ...(appealAnswers ? { "appeal-answers.csv": appealAnswers } : {}),
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
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  call(cookie, "POST", `/content/${id}/${action}`, { ...meta(), ...body });

async function join(slug: string) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: randomUUID() }),
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

async function write(cookie: string, body: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), body })) {
    form.set(key, value);
  }
  const made = await app.request("/posts", { method: "POST", headers: { cookie }, body: form });
  return ((await made.json()) as { id: string }).id;
}

const assignedTo = async (versionId: string) => {
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

describe("labels on what the study wrote", () => {
  it("say what they are, who gave them, and whether they cover the post", async () => {
    const { slug, versionId } = await study();
    const posts = await list(await join(slug));
    const spam = byId(posts, await withId(versionId, "spam"));
    expect(spam.labels).toEqual([
      { text: "Spam", by: "Sam the Mod", hides: true, reason: "Selling things" },
    ]);
    // What a label covers is still sent, so pressing Show needs nothing more.
    expect(spam.body).toBe("Buy my stuff");
    expect(byId(posts, await withId(versionId, "odd")).labels).toEqual([
      { text: "Misleading", by: "Sam the Mod", hides: false },
    ]);
  });

  it("wait for their time, apply only to their condition, and label comments too", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const posts = await list(cookie);
    expect(byId(posts, await withId(versionId, "later")).labels).toBeUndefined();
    const onlyB = byId(posts, await withId(versionId, "b_only"));
    expect(onlyB.labels !== undefined).toBe((await assignedTo(versionId)) === "b");

    const oddId = await withId(versionId, "odd");
    const [post] = await list(cookie, `?surface=post&post=${oddId}`);
    expect(post?.comments[0]?.labels).toEqual([{ text: "Rude", by: "Sam the Mod", hides: true }]);
  });

  it("record pressing Show, only on what a label covers", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const spam = await withId(versionId, "spam");
    expect((await act(cookie, spam, "label-shown", { label: "Spam" })).status).toBe(200);
    expect((await act(cookie, spam, "label-shown", { label: "Other" })).status).toBe(404);
    const odd = await withId(versionId, "odd");
    expect((await act(cookie, odd, "label-shown", { label: "Misleading" })).status).toBe(404);

    const events = await database.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.studyVersionId, versionId),
          eq(schema.events.type, "content.label_shown"),
        ),
      );
    expect(events.map(({ payload, targetContentId }) => [payload, targetContentId])).toEqual([
      [{ label: "Spam" }, spam],
    ]);
  });

  it("do nothing when the feature is off", async () => {
    const { slug, versionId } = await study({ features: "{ labels: false }" });
    const cookie = await join(slug);
    const spam = await withId(versionId, "spam");
    expect(byId(await list(cookie), spam).labels).toBeUndefined();
    expect((await act(cookie, spam, "label-shown", { label: "Spam" })).status).toBe(403);
  });

  it("show in a researcher's preview", async () => {
    const { versionId } = await study();
    const loaded = await loadVersion(database.db, versionId);
    const version = {
      id: versionId,
      seed: loaded?.version.seed as number,
      settings: loaded?.settings as NonNullable<typeof loaded>["settings"],
    };
    const preview = await previewFeed(database.db, "http://media.test", version, "a", 0);
    const spam = preview.posts.find(({ body }) => body === "Buy my stuff");
    expect(spam?.labels).toEqual([
      { text: "Spam", by: "Sam the Mod", hides: true, reason: "Selling things" },
    ]);
  });

  it("are in impressions, and in an export", async () => {
    const { slug, versionId } = await study();
    await list(await join(slug));
    const folder = mkdtempSync(path.join(tmpdir(), "truman-labels-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);

    const impressions = parse(readFileSync(path.join(folder, "impressions.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    const spam = await withId(versionId, "spam");
    expect(impressions.find(({ content_id }) => content_id === spam)?.labels).toBe("Spam");
    const labels = parse(readFileSync(path.join(folder, "labels.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    expect(labels.map(({ label, hides }) => [label, hides])).toEqual(
      expect.arrayContaining([
        ["Spam", "true"],
        ["Misleading", ""],
      ]),
    );
  });

  it("freeze with a version, and stay through a draft", async () => {
    const { versionId } = await study();
    await expect(
      database.db
        .update(schema.scriptedLabels)
        .set({ label: "changed" })
        .where(eq(schema.scriptedLabels.studyVersionId, versionId)),
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
    const labels = draft?.items.filter(({ kind }) => kind === "label") ?? [];
    expect(labels).toHaveLength(5);
    expect(labels.map(({ data }) => (data as { hides: boolean }).hides)).toContain(true);
    // Nothing changed, so it's the same version.
    expect(await freezeDraft(database.db, draft as NonNullable<typeof draft>)).toMatchObject({
      status: "unchanged",
    });
  });
});

describe("labels on what a participant wrote", () => {
  const LABEL_FIRST = "on,nth,type,actor,after,body\npost,0,label,sam,0:00,Misleading\n";

  it("never cover it for them, tell them, and can be appealed", async () => {
    const { slug, versionId } = await study({ reactions: LABEL_FIRST });
    const cookie = await join(slug);
    const id = await write(cookie, "I wrote this");

    const mine = byId(await list(cookie), id);
    expect(mine.labels).toEqual([
      { text: "Misleading", by: "Sam the Mod", hides: false, appeal: "open" },
    ]);
    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string; reason: string | null }[];
    };
    expect(notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "label", reason: "Misleading" })]),
    );

    expect((await act(cookie, id, "appeal", { text: "It's true" })).status).toBe(200);
    expect(byId(await list(cookie), id).labels?.[0]?.appeal).toBe("sent");
    const [appealed] = await database.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.studyVersionId, versionId),
          eq(schema.events.type, "moderation.appealed"),
        ),
      );
    expect(appealed?.payload).toEqual({ text: "It's true", of: "label" });
  });

  it("come off when an appeal is answered by putting it back", async () => {
    const { slug } = await study({
      reactions: LABEL_FIRST,
      appealAnswers: "action,actor,after,message\nrestore,sam,0:00,Fair enough\n",
    });
    const cookie = await join(slug);
    const id = await write(cookie, "Mine");
    await act(cookie, id, "appeal", { text: "Please" });
    expect(byId(await list(cookie), id).labels).toBeUndefined();
    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string; appealOf?: string }[];
    };
    expect(notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "restore", appealOf: "label" })]),
    );
  });

  it("can't be appealed when a post has no label, or isn't theirs", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const id = await write(cookie, "Unlabeled");
    expect((await act(cookie, id, "appeal", { text: "Why" })).status).toBe(404);
    const spam = await withId(versionId, "spam");
    expect((await act(cookie, spam, "appeal", { text: "Why" })).status).toBe(404);
  });
});
