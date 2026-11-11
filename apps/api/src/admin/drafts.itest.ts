import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

async function signIn(email: string, password: string) {
  const response = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function lab() {
  const id = randomUUID().slice(0, 8);
  const slug = `lab-${id}`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: slug,
    slug,
    email: `${id}@example.edu`,
    name: "Owner",
  });

  const dir = mkdtempSync(path.join(tmpdir(), "truman-draft-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: draft-${id}
title: Draft test
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: [{ key: a }, { key: b }]
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }]
`,
    "actors.csv": "username,name,bio\nann,Ann,Ann's bio\nbob,Bob,\n",
    "posts.csv": [
      "id,body,picture,actor,likes,time,condition",
      "p1,original text,photo.jpg,ann,4,-1:00,",
      "for-a,only a,,bob,0,-0:30,a",
      "for-b,only b,,bob,0,-0:30,b",
    ].join("\n"),
    "comments.csv": "id,body,actor,postID,likes,time\nc1,a comment,bob,p1,2,-0:50\n",
    "reactions.csv": "on,nth,type,actor,after,body\npost,0,reply,ann,0:01,Nice\n",
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { teamId, launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }

  const cookie = await signIn(`${id}@example.edu`, password as string);
  return {
    id,
    teamSlug: slug,
    slug: `draft-${id}`,
    cookie,
    versionId: imported.studyVersionId,
  };
}

type Lab = Awaited<ReturnType<typeof lab>>;

const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function open(team: Lab) {
  const response = await call(team.cookie, "POST", `/admin/versions/${team.versionId}/draft`);
  expect(response.status).toBe(200);
  return (await response.json()) as { draftId: string; created: boolean };
}

interface DraftPreview extends FeedResponse {
  items: Record<string, { actorId: string; timeMs: number; conditions: string[]; origin: string }>;
}

async function preview(team: Lab, draftId: string, condition = "a", elapsedMs = 0) {
  const response = await call(
    team.cookie,
    "GET",
    `/admin/drafts/${draftId}/preview?condition=${condition}&elapsedMs=${elapsedMs}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as DraftPreview;
}

const findPost = (posts: FeedPost[], body: string) => {
  const post = posts.find((item) => item.body === body);
  if (!post) {
    throw new Error(`No post "${body}" in: ${posts.map((item) => item.body).join(", ")}`);
  }
  return post;
};

const edit = (team: Lab, draftId: string, itemId: string, changes: object) =>
  call(team.cookie, "PATCH", `/admin/drafts/${draftId}/items/${itemId}`, { changes });

async function enterAsParticipant(slug: string) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: `p-${randomUUID()}` }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function participantFeed(cookie: string) {
  const response = await app.request("/feed", { headers: { cookie } });
  return ((await response.json()) as FeedResponse).posts;
}

/** Saving doesn't change what anyone gets. Launching does. */
async function saveAndLaunch(team: Lab, draftId: string) {
  const saved = await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);
  expect(saved.status).toBe(200);
  const [version] = await database.db
    .select({ id: schema.studyDrafts.frozenVersionId })
    .from(schema.studyDrafts)
    .where(eq(schema.studyDrafts.id, draftId));
  await call(team.cookie, "POST", `/admin/versions/${version?.id}/launch`);
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
    secureCookies: true,
  });
});

afterAll(async () => {
  storage.close();
  await database.destroy();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("starting a draft", () => {
  it("copies everything from the version, looking exactly the same", async () => {
    const team = await lab();
    const { draftId, created } = await open(team);

    expect(created).toBe(true);
    const framed = await call(
      team.cookie,
      "GET",
      `/admin/versions/${team.versionId}/preview?condition=a&elapsedMs=0`,
    );
    const version = (await framed.json()) as FeedResponse;
    const draft = await preview(team, draftId);

    const strip = (posts: FeedPost[]) =>
      posts.map(({ id: _id, at: _at, comments, ...post }) => ({
        ...post,
        comments: comments.map(({ id: _commentId, at: _commentAt, ...comment }) => comment),
      }));
    expect(strip(draft.posts)).toEqual(strip(version.posts));
  });

  it("carries over reactions, which aren't visible until someone posts", async () => {
    const team = await lab();
    const { draftId } = await open(team);

    const items = await database.db
      .select()
      .from(schema.draftItems)
      .where(and(eq(schema.draftItems.draftId, draftId), eq(schema.draftItems.kind, "reaction")));
    expect(items).toHaveLength(1);
  });

  it("gives everyone on the team the same draft", async () => {
    const team = await lab();
    const first = await open(team);
    const second = await open(team);

    expect(second).toEqual({ draftId: first.draftId, created: false });
  });

  it("shows up on the studies list", async () => {
    const team = await lab();
    const { draftId } = await open(team);

    const response = await call(team.cookie, "GET", "/admin/studies");
    const { studies } = (await response.json()) as {
      studies: { openDraftId: string; role: string }[];
    };

    expect(studies[0]).toMatchObject({ openDraftId: draftId, role: "owner" });
  });
});

describe("editing", () => {
  it("changes what the feed shows right away", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    const response = await edit(team, draftId, post.id, { body: "new text" });

    expect(response.status).toBe(200);
    expect(findPost((await preview(team, draftId)).posts, "new text").id).toBe(post.id);
  });

  it("never touches the frozen version, or anyone in the study", async () => {
    const team = await lab();
    const participant = await enterAsParticipant(team.slug);
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    await edit(team, draftId, post.id, { body: "changed in draft" });

    expect((await participantFeed(participant)).map((item) => item.body)).toContain(
      "original text",
    );
    expect((await participantFeed(participant)).map((item) => item.body)).not.toContain(
      "changed in draft",
    );
  });

  it("can change the author, timing, and conditions", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await preview(team, draftId);
    const post = findPost(before.posts, "original text");
    const bobId = before.items[findPost(before.posts, "only a").id]?.actorId;

    await edit(team, draftId, post.id, { actorId: bobId, conditions: ["b"], timeMs: 3_600_000 });

    expect((await preview(team, draftId, "a")).posts.map((item) => item.body)).not.toContain(
      "original text",
    );
    expect((await preview(team, draftId, "b")).posts.map((item) => item.body)).not.toContain(
      "original text",
    );
    const later = await preview(team, draftId, "b", 3_600_000);
    expect(findPost(later.posts, "original text").author.username).toBe("bob");
  });

  it("refuses an author who isn't in this study", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    const response = await edit(team, draftId, post.id, { actorId: randomUUID() });

    expect(response.status).toBe(400);
  });

  it("refuses fields that don't exist", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    expect((await edit(team, draftId, post.id, { sneaky: true })).status).toBe(400);
  });

  it("records every change, with who made it", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    await edit(team, draftId, post.id, { body: "one" });
    await edit(team, draftId, post.id, { body: "two" });

    const history = await database.db
      .select()
      .from(schema.draftItemHistory)
      .where(eq(schema.draftItemHistory.itemId, post.id));
    expect(history.map((row) => (row.data as { body: string }).body)).toEqual(["one", "two"]);
    expect(history.map((row) => row.revision)).toEqual([2, 3]);
    expect(history.every((row) => row.researcherId)).toBe(true);
  });

  it("lets two people edit different posts, keeping both changes", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const { posts } = await preview(team, draftId);
    const first = findPost(posts, "original text");
    const second = findPost(posts, "only a");

    await Promise.all([
      edit(team, draftId, first.id, { body: "first change" }),
      edit(team, draftId, second.id, { body: "second change" }),
    ]);

    const bodies = (await preview(team, draftId)).posts.map((post) => post.body);
    expect(bodies).toContain("first change");
    expect(bodies).toContain("second change");
  });

  it("when two people edit the same post, the last save wins and both are in the history", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    await Promise.all([
      edit(team, draftId, post.id, { body: "version A" }),
      edit(team, draftId, post.id, { body: "version B" }),
    ]);

    const history = await database.db
      .select()
      .from(schema.draftItemHistory)
      .where(eq(schema.draftItemHistory.itemId, post.id));
    expect(history.map((row) => (row.data as { body: string }).body).sort()).toEqual([
      "version A",
      "version B",
    ]);
    expect(history.map((row) => row.revision).sort()).toEqual([2, 3]);
  });
});

describe("adding and removing", () => {
  it("adds a post, marked as written by a researcher", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await preview(team, draftId);
    const actorId = before.items[findPost(before.posts, "only a").id]?.actorId;

    const response = await call(team.cookie, "POST", `/admin/drafts/${draftId}/items`, {
      kind: "post",
      fields: { body: "brand new", actorId, timeMs: 0, conditions: [] },
    });

    expect(response.status).toBe(200);
    const after = await preview(team, draftId);
    const post = findPost(after.posts, "brand new");
    expect(after.items[post.id]?.origin).toBe("researcher");
  });

  it("adds a comment to a post", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await preview(team, draftId);
    const post = findPost(before.posts, "original text");

    await call(team.cookie, "POST", `/admin/drafts/${draftId}/items`, {
      kind: "comment",
      fields: {
        body: "new comment",
        actorId: before.items[post.id]?.actorId,
        postId: post.id,
        timeMs: 0,
        conditions: [],
      },
    });

    const comments = findPost((await preview(team, draftId)).posts, "original text").comments;
    expect(comments.map((comment) => comment.body)).toContain("new comment");
  });

  it("removes a post and its comments, keeping them in the history", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    const response = await call(team.cookie, "DELETE", `/admin/drafts/${draftId}/items/${post.id}`);

    expect(await response.json()).toEqual({ deleted: 2 });
    expect((await preview(team, draftId)).posts.map((item) => item.body)).not.toContain(
      "original text",
    );
    const history = await database.db
      .select()
      .from(schema.draftItemHistory)
      .where(eq(schema.draftItemHistory.draftId, draftId));
    expect(history.filter((row) => row.action === "delete")).toHaveLength(2);
  });

  it("won't remove an author who still has content", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await preview(team, draftId);
    const actorId = before.items[findPost(before.posts, "only a").id]?.actorId;

    const response = await call(team.cookie, "DELETE", `/admin/drafts/${draftId}/items/${actorId}`);

    expect(response.status).toBe(409);
  });
});

describe("saving a new version", () => {
  it("makes a new version that participants don't get until it's launched", async () => {
    const team = await lab();
    const earlier = await enterAsParticipant(team.slug);
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    await edit(team, draftId, post.id, { body: "edited for v2" });

    const response = await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);

    expect(await response.json()).toEqual({
      status: "frozen",
      version: 2,
      versionId: expect.any(String),
    });
    const before = await enterAsParticipant(team.slug);
    expect((await participantFeed(before)).map((item) => item.body)).toContain("original text");

    const [draft] = await database.db
      .select({ versionId: schema.studyDrafts.frozenVersionId })
      .from(schema.studyDrafts)
      .where(eq(schema.studyDrafts.id, draftId));
    await call(team.cookie, "POST", `/admin/versions/${draft?.versionId}/launch`);

    const after = await enterAsParticipant(team.slug);
    expect((await participantFeed(after)).map((item) => item.body)).toContain("edited for v2");
    expect((await participantFeed(earlier)).map((item) => item.body)).toContain("original text");
  });

  it("keeps everything that wasn't changed: authors, images, likes, comments, reactions", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    await edit(team, draftId, post.id, { body: "edited" });

    await saveAndLaunch(team, draftId);

    const participant = await enterAsParticipant(team.slug);
    const shown = findPost(await participantFeed(participant), "edited");
    expect(shown).toMatchObject({
      attachments: [{ type: "image", url: "https://cdn.example.com/m/photo.jpg" }],
      likes: 4,
      author: { username: "ann", name: "Ann" },
    });
    expect(shown.comments.map((comment) => comment.body)).toEqual(["a comment"]);

    const [study] = await database.db
      .select()
      .from(schema.studies)
      .where(eq(schema.studies.slug, team.slug));
    const [newest] = await database.db
      .select()
      .from(schema.studyVersions)
      .where(and(eq(schema.studyVersions.studyId, study!.id), eq(schema.studyVersions.version, 2)));
    const reactions = await database.db
      .select()
      .from(schema.scriptedReactions)
      .where(eq(schema.scriptedReactions.studyVersionId, newest!.id));
    expect(reactions).toHaveLength(1);
  });

  it("records where each item came from, in the frozen version", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await preview(team, draftId);
    const edited = findPost(before.posts, "original text");
    await edit(team, draftId, edited.id, { body: "edited" });
    await call(team.cookie, "POST", `/admin/drafts/${draftId}/items`, {
      kind: "post",
      fields: { body: "brand new", actorId: before.items[edited.id]?.actorId, timeMs: 0 },
    });

    await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);

    const rows = await database.db
      .select({ body: schema.content.body, provenance: schema.content.provenance })
      .from(schema.content)
      .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.content.studyVersionId))
      .where(and(eq(schema.studyVersions.version, 2), isNull(schema.content.worldId)));
    const provenance = (body: string) => rows.find((row) => row.body === body)?.provenance;

    expect(provenance("edited")).toEqual({ origin: "file", edited: true });
    expect(provenance("brand new")).toEqual({ origin: "researcher" });
    expect(provenance("only a")).toEqual({ origin: "file" });
  });

  it("closes the draft, so it can't be edited, and a new one can start", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    await edit(team, draftId, post.id, { body: "edited" });
    await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);

    expect((await edit(team, draftId, post.id, { body: "too late" })).status).toBe(409);
    expect((await open(team)).draftId).not.toBe(draftId);
  });

  it("refuses when something's wrong, explaining what", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const { posts } = await preview(team, draftId);
    const post = findPost(posts, "original text");
    await edit(team, draftId, post.comments[0]?.id as string, { timeMs: -999_000_000 });

    const response = await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("timed before");
  });

  it("does nothing when nothing changed", async () => {
    const team = await lab();
    const { draftId } = await open(team);

    const response = await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);

    expect(await response.json()).toEqual({ status: "unchanged", version: 1 });
  });
});

describe("who can edit", () => {
  it("requires signing in", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    expect((await app.request(`/admin/drafts/${draftId}`)).status).toBe(401);
  });

  it("keeps another team out completely", async () => {
    const mine = await lab();
    const theirs = await lab();
    const { draftId } = await open(mine);
    const post = findPost((await preview(mine, draftId)).posts, "original text");

    expect((await edit(theirs, draftId, post.id, { body: "x" })).status).toBe(404);
    expect((await call(theirs.cookie, "GET", `/admin/drafts/${draftId}`)).status).toBe(404);
    expect(
      (await call(theirs.cookie, "POST", `/admin/versions/${mine.versionId}/draft`)).status,
    ).toBe(404);
    expect((await call(theirs.cookie, "POST", `/admin/drafts/${draftId}/freeze`)).status).toBe(404);
  });

  it("lets a viewer look but not change anything", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    const email = `viewer-${team.id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: team.teamSlug,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(email, (added as { password: string }).password);

    const info = await call(viewer, "GET", `/admin/drafts/${draftId}`);
    expect(((await info.json()) as { canEdit: boolean }).canEdit).toBe(false);

    expect(
      (
        await call(viewer, "PATCH", `/admin/drafts/${draftId}/items/${post.id}`, {
          changes: { body: "x" },
        })
      ).status,
    ).toBe(403);
    expect((await call(viewer, "POST", `/admin/drafts/${draftId}/freeze`)).status).toBe(403);
    expect((await call(viewer, "DELETE", `/admin/drafts/${draftId}/items/${post.id}`)).status).toBe(
      403,
    );
  });

  it("lets an editor change things", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    const email = `editor-${team.id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: team.teamSlug,
      email,
      name: "Editor",
      role: "editor",
    });
    const editor = await signIn(email, (added as { password: string }).password);

    const response = await call(editor, "PATCH", `/admin/drafts/${draftId}/items/${post.id}`, {
      changes: { body: "by the editor" },
    });

    expect(response.status).toBe(200);
  });
});

describe("moving a post in time", () => {
  const move = (team: Lab, draftId: string, itemId: string, timeMs: number, cookie = team.cookie) =>
    call(cookie, "POST", `/admin/drafts/${draftId}/items/${itemId}/move`, { timeMs });

  it("changes when it appears", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "only a");

    const response = await move(team, draftId, post.id, 5 * 3_600_000);

    expect(response.status).toBe(200);
    const bodies = async (elapsedMs: number) =>
      (await preview(team, draftId, "a", elapsedMs)).posts.map((item) => item.body);
    expect(await bodies(0)).not.toContain("only a");
    expect(await bodies(5 * 3_600_000)).toContain("only a");
  });

  it("takes its comments with it, keeping the same gap", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await preview(team, draftId);
    const post = findPost(before.posts, "original text");
    const commentId = post.comments[0]?.id as string;
    const gap = (before.items[commentId]?.timeMs ?? 0) - (before.items[post.id]?.timeMs ?? 0);

    await move(team, draftId, post.id, 10 * 3_600_000);

    const after = await preview(team, draftId, "a", 11 * 3_600_000);
    expect(after.items[post.id]?.timeMs).toBe(10 * 3_600_000);
    expect(after.items[commentId]?.timeMs).toBe(10 * 3_600_000 + gap);
  });

  it("can't leave a comment before its post, however far it moves", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    await move(team, draftId, post.id, 40 * 3_600_000);

    const info = await call(team.cookie, "GET", `/admin/drafts/${draftId}`);
    const { issues } = (await info.json()) as { issues: { severity: string }[] };
    expect(issues.filter(({ severity }) => severity === "error")).toEqual([]);
  });

  it("goes in the history, for the post and its comments", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    await move(team, draftId, post.id, 3_600_000);

    const history = await database.db
      .select()
      .from(schema.draftItemHistory)
      .where(eq(schema.draftItemHistory.draftId, draftId));
    expect(history).toHaveLength(2);
  });

  it("does nothing when dropped back where it was", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await preview(team, draftId);
    const post = findPost(before.posts, "original text");

    const response = await move(team, draftId, post.id, before.items[post.id]?.timeMs as number);

    expect(await response.json()).toEqual({ moved: 0 });
    const history = await database.db
      .select()
      .from(schema.draftItemHistory)
      .where(eq(schema.draftItemHistory.draftId, draftId));
    expect(history).toEqual([]);
  });

  it("only moves posts, in this draft, for people who can edit", async () => {
    const team = await lab();
    const other = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    const commentId = post.comments[0]?.id as string;

    expect((await move(team, draftId, commentId, 0)).status).toBe(404);
    expect((await move(team, draftId, randomUUID(), 0)).status).toBe(404);
    expect((await move(team, draftId, post.id, 0, other.cookie)).status).toBe(404);
    expect((await move(team, draftId, post.id, 0, "")).status).toBe(401);
  });
});

describe("images", () => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
    "base64",
  );

  const uploadFile = (team: Lab, draftId: string, file: File, cookie = team.cookie) => {
    const form = new FormData();
    form.append("image", file);
    return app.request(`/admin/drafts/${draftId}/images`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
  };

  const photo = () => new File([PNG], "anything at all.png", { type: "image/png" });

  it("adds an uploaded photo to a post, and it reaches participants", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    // This post is in every condition, so whoever enters next will see it.
    const post = findPost((await preview(team, draftId)).posts, "original text");

    const response = await uploadFile(team, draftId, photo());
    const { picture, url } = (await response.json()) as { picture: string; url: string };
    await edit(team, draftId, post.id, { pictures: [picture] });

    expect(picture).toMatch(/^media\/[0-9a-f]{64}\.png$/);
    expect(
      findPost((await preview(team, draftId)).posts, "original text").attachments[0]?.url,
    ).toBe(url);

    await saveAndLaunch(team, draftId);
    const shown = await participantFeed(await enterAsParticipant(team.slug));
    expect(findPost(shown, "original text").attachments[0]?.url).toBe(url);

    const fetched = await fetch(`${process.env.MEDIA_PUBLIC_URL}/${picture}`);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(PNG);
  });

  it("ignores the file's name, so names can't go wrong", async () => {
    const team = await lab();
    const { draftId } = await open(team);

    const first = await uploadFile(team, draftId, new File([PNG], "a.png"));
    const second = await uploadFile(team, draftId, new File([PNG], "completely different.png"));

    expect(await first.json()).toEqual(await second.json());
  });

  it("replaces and removes a photo", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    expect(post.attachments[0]?.url).toContain("photo.jpg");

    const { picture } = (await (await uploadFile(team, draftId, photo())).json()) as {
      picture: string;
    };
    await edit(team, draftId, post.id, { pictures: [picture] });
    expect(
      findPost((await preview(team, draftId)).posts, "original text").attachments[0]?.url,
    ).toContain(picture);

    await edit(team, draftId, post.id, { pictures: [] });
    expect(findPost((await preview(team, draftId)).posts, "original text").attachments).toEqual([]);
  });

  it("refuses what isn't an image, whatever it's called", async () => {
    const team = await lab();
    const { draftId } = await open(team);

    const fake = new File(["<script>alert(1)</script>"], "photo.png", { type: "image/png" });
    const svg = new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "photo.svg");

    expect((await uploadFile(team, draftId, fake)).status).toBe(400);
    expect((await uploadFile(team, draftId, svg)).status).toBe(400);
  });

  it("won't let a post point at anything but an uploaded image", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    for (const picture of [
      "typo.jpg",
      "https://example.com/x.jpg",
      "uploads/someone/private.jpg",
    ]) {
      expect((await edit(team, draftId, post.id, { pictures: [picture] })).status).toBe(400);
    }
  });

  it("isn't open to viewers or other teams", async () => {
    const team = await lab();
    const other = await lab();
    const { draftId } = await open(team);

    expect((await uploadFile(team, draftId, photo(), other.cookie)).status).toBe(404);
    expect((await uploadFile(team, draftId, photo(), "")).status).toBe(401);

    const email = `viewer2-${team.id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: team.teamSlug,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(email, (added as { password: string }).password);
    expect((await uploadFile(team, draftId, photo(), viewer)).status).toBe(403);
  });
});

describe("what participants can't see", () => {
  it("doesn't send provenance or draft details to participants", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    await edit(team, draftId, post.id, { body: "edited" });
    await saveAndLaunch(team, draftId);

    const participant = await enterAsParticipant(team.slug);
    const text = await (await app.request("/feed", { headers: { cookie: participant } })).text();

    expect(text).not.toContain("provenance");
    expect(text).not.toContain("origin");
  });
});

describe("working together", () => {
  const presence = async (
    team: Lab,
    draftId: string,
    itemId: string | null,
    cookie = team.cookie,
  ) => {
    const response = await call(cookie, "POST", `/admin/drafts/${draftId}/presence`, { itemId });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      latestChange: number;
      others: { name: string; itemId: string | null }[];
    };
  };

  async function teammate(team: Lab, role: "editor" | "viewer" = "editor") {
    const email = `${role}-${randomUUID().slice(0, 6)}-${team.id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: team.teamSlug,
      email,
      name: `A ${role}`,
      role,
    });
    return signIn(email, (added as { password: string }).password);
  }

  it("shows who else is here, and what they're editing, but not yourself", async () => {
    const team = await lab();
    const other = await teammate(team);
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");

    await presence(team, draftId, post.id);
    const seen = await presence(team, draftId, null, other);

    expect(seen.others).toEqual([{ name: "Owner", itemId: post.id, section: null }]);
    expect((await presence(team, draftId, post.id)).others).toEqual([
      { name: "A editor", itemId: null, section: null },
    ]);
  });

  it("stops showing someone who's left", async () => {
    const team = await lab();
    const other = await teammate(team);
    const { draftId } = await open(team);
    await presence(team, draftId, null, other);

    await database.db
      .update(schema.draftPresence)
      .set({ lastSeen: new Date(Date.now() - 60_000) })
      .where(eq(schema.draftPresence.draftId, draftId));

    expect((await presence(team, draftId, null)).others).toEqual([]);
  });

  it("lets others tell that something changed", async () => {
    const team = await lab();
    const other = await teammate(team);
    const { draftId } = await open(team);
    const post = findPost((await preview(team, draftId)).posts, "original text");
    const before = await presence(team, draftId, null, other);

    await edit(team, draftId, post.id, { body: "changed" });

    expect((await presence(team, draftId, null, other)).latestChange).toBeGreaterThan(
      before.latestChange,
    );
  });

  it("is open to viewers, and closed to other teams", async () => {
    const team = await lab();
    const stranger = await lab();
    const viewer = await teammate(team, "viewer");
    const { draftId } = await open(team);

    expect((await presence(team, draftId, null, viewer)).others).toEqual([]);
    const response = await call(stranger.cookie, "POST", `/admin/drafts/${draftId}/presence`, {
      itemId: null,
    });
    expect(response.status).toBe(404);
  });

  describe("recent changes and undo", () => {
    interface Change {
      changeId: string;
      who: string;
      mine: boolean;
      summary: string;
      canUndo: boolean;
    }

    const changes = async (team: Lab, draftId: string, cookie = team.cookie) => {
      const response = await call(cookie, "GET", `/admin/drafts/${draftId}/changes`);
      return ((await response.json()) as { changes: Change[] }).changes;
    };

    const undo = (team: Lab, draftId: string, changeId: string, cookie = team.cookie) =>
      call(cookie, "POST", `/admin/drafts/${draftId}/changes/${changeId}/undo`);

    const latestChange = async (team: Lab, draftId: string) =>
      (await changes(team, draftId))[0] as Change;

    it("lists changes newest first, saying who and what", async () => {
      const team = await lab();
      const other = await teammate(team);
      const { draftId } = await open(team);
      const post = findPost((await preview(team, draftId)).posts, "original text");

      await edit(team, draftId, post.id, { body: "mine" });
      await call(other, "PATCH", `/admin/drafts/${draftId}/items/${post.id}`, {
        changes: { body: "theirs" },
      });

      const list = await changes(team, draftId);
      expect(list[0]).toMatchObject({ who: "A editor", mine: false, summary: 'changed "theirs"' });
      expect(list[1]).toMatchObject({ who: "Owner", mine: true, summary: 'changed "mine"' });
    });

    it("counts moving a post and its comments as one change, and undoes them together", async () => {
      const team = await lab();
      const { draftId } = await open(team);
      const before = await preview(team, draftId);
      const post = findPost(before.posts, "original text");
      const commentId = post.comments[0]?.id as string;
      const start = {
        post: before.items[post.id]?.timeMs,
        comment: before.items[commentId]?.timeMs,
      };

      await call(team.cookie, "POST", `/admin/drafts/${draftId}/items/${post.id}/move`, {
        timeMs: 3_600_000,
      });
      const list = await changes(team, draftId);
      expect(list).toHaveLength(1);
      expect(list[0]?.summary).toContain("moved");

      expect((await undo(team, draftId, list[0]?.changeId as string)).status).toBe(200);

      const after = await preview(team, draftId);
      expect(after.items[post.id]?.timeMs).toBe(start.post);
      expect(after.items[commentId]?.timeMs).toBe(start.comment);
    });

    it("undoes an edit", async () => {
      const team = await lab();
      const { draftId } = await open(team);
      const post = findPost((await preview(team, draftId)).posts, "original text");
      await edit(team, draftId, post.id, { body: "oops" });

      const { changeId } = await latestChange(team, draftId);
      await undo(team, draftId, changeId);

      expect(findPost((await preview(team, draftId)).posts, "original text").id).toBe(post.id);
    });

    it("undoes adding something", async () => {
      const team = await lab();
      const { draftId } = await open(team);
      const before = await preview(team, draftId);
      await call(team.cookie, "POST", `/admin/drafts/${draftId}/items`, {
        kind: "post",
        fields: {
          body: "added by mistake",
          actorId: before.items[findPost(before.posts, "only a").id]?.actorId,
          timeMs: 0,
        },
      });

      await undo(team, draftId, (await latestChange(team, draftId)).changeId);

      expect((await preview(team, draftId)).posts.map((item) => item.body)).not.toContain(
        "added by mistake",
      );
    });

    it("brings back something deleted, with its comments", async () => {
      const team = await lab();
      const { draftId } = await open(team);
      const post = findPost((await preview(team, draftId)).posts, "original text");
      await call(team.cookie, "DELETE", `/admin/drafts/${draftId}/items/${post.id}`);
      expect((await preview(team, draftId)).posts.map((item) => item.body)).not.toContain(
        "original text",
      );

      await undo(team, draftId, (await latestChange(team, draftId)).changeId);

      const restored = findPost((await preview(team, draftId)).posts, "original text");
      expect(restored.comments.map((comment) => comment.body)).toEqual(["a comment"]);
    });

    it("won't throw away someone's later work on the same post", async () => {
      const team = await lab();
      const other = await teammate(team);
      const { draftId } = await open(team);
      const post = findPost((await preview(team, draftId)).posts, "original text");
      await edit(team, draftId, post.id, { body: "mine" });
      const { changeId } = await latestChange(team, draftId);
      await call(other, "PATCH", `/admin/drafts/${draftId}/items/${post.id}`, {
        changes: { body: "theirs, afterward" },
      });

      const response = await undo(team, draftId, changeId);

      expect(response.status).toBe(409);
      expect(((await response.json()) as { error: string }).error).toContain("changed it since");
      expect(findPost((await preview(team, draftId)).posts, "theirs, afterward").id).toBe(post.id);
    });

    it("can only undo a change once, and shows that", async () => {
      const team = await lab();
      const { draftId } = await open(team);
      const post = findPost((await preview(team, draftId)).posts, "original text");
      await edit(team, draftId, post.id, { body: "oops" });
      const { changeId } = await latestChange(team, draftId);

      expect((await undo(team, draftId, changeId)).status).toBe(200);
      expect((await undo(team, draftId, changeId)).status).toBe(404);

      const list = await changes(team, draftId);
      expect(list.find((item) => item.changeId === changeId)?.canUndo).toBe(false);
      expect(list[0]?.canUndo).toBe(false);
    });

    it("isn't open to viewers or other teams", async () => {
      const team = await lab();
      const stranger = await lab();
      const viewer = await teammate(team, "viewer");
      const { draftId } = await open(team);
      const post = findPost((await preview(team, draftId)).posts, "original text");
      await edit(team, draftId, post.id, { body: "x" });
      const { changeId } = await latestChange(team, draftId);

      expect((await undo(team, draftId, changeId, viewer)).status).toBe(403);
      expect((await undo(team, draftId, changeId, stranger.cookie)).status).toBe(404);
      const response = await call(stranger.cookie, "GET", `/admin/drafts/${draftId}/changes`);
      expect(response.status).toBe(404);
    });

    it("stops being possible once the draft is saved", async () => {
      const team = await lab();
      const { draftId } = await open(team);
      const post = findPost((await preview(team, draftId)).posts, "original text");
      await edit(team, draftId, post.id, { body: "edited" });
      const { changeId } = await latestChange(team, draftId);
      await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);

      expect((await undo(team, draftId, changeId)).status).toBe(409);
    });
  });
});

describe("a moderator's decisions in the builder", () => {
  const info = async (team: Lab, draftId: string) =>
    (await (await call(team.cookie, "GET", `/admin/drafts/${draftId}`)).json()) as {
      actors: { id: string; username: string }[];
      posts: { id: string; offsetMs: number }[];
      comments: { id: string }[];
      removals: { id: string; targetId: string; timeMs: number; reason: string }[];
      moderatorReactions: { id: string; type: string; nth: number; body: string }[];
    };
  const add = (team: Lab, draftId: string, kind: string, fields: object) =>
    call(team.cookie, "POST", `/admin/drafts/${draftId}/items`, { kind, fields });
  const change = (team: Lab, draftId: string, itemId: string, changes: object) =>
    call(team.cookie, "PATCH", `/admin/drafts/${draftId}/items/${itemId}`, { changes });

  it("adds, changes, and deletes a removal, and only of what's in this draft", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await info(team, draftId);
    const actorId = before.actors[0]?.id as string;
    const post = before.posts[0] as { id: string; offsetMs: number };

    const missing = await add(team, draftId, "removal", {
      on: "post",
      targetId: randomUUID(),
      actorId,
      timeMs: 0,
      conditions: [],
    });
    expect(missing.status).toBe(400);

    const wrongKind = await add(team, draftId, "removal", {
      on: "comment",
      targetId: post.id,
      actorId,
      timeMs: 0,
      conditions: [],
    });
    expect(wrongKind.status).toBe(400);

    const made = await add(team, draftId, "removal", {
      on: "post",
      targetId: post.id,
      actorId,
      timeMs: 1000,
      conditions: [],
    });
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };

    expect((await change(team, draftId, id, { reason: "Rule 1" })).status).toBe(200);
    expect((await info(team, draftId)).removals[0]).toMatchObject({ id, reason: "Rule 1" });
    expect((await change(team, draftId, id, { reason: null })).status).toBe(200);
    expect((await info(team, draftId)).removals[0]?.reason).toBe("");

    const deleted = await call(team.cookie, "DELETE", `/admin/drafts/${draftId}/items/${id}`);
    expect(deleted.status).toBe(200);
    expect((await info(team, draftId)).removals).toEqual([]);
  });

  it("moves a removal with its post, and removes it with its post", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await info(team, draftId);
    const post = before.posts[0] as { id: string; offsetMs: number };
    await add(team, draftId, "removal", {
      on: "post",
      targetId: post.id,
      actorId: before.actors[0]?.id,
      timeMs: post.offsetMs + 60_000,
      conditions: [],
    });

    const moved = await call(
      team.cookie,
      "POST",
      `/admin/drafts/${draftId}/items/${post.id}/move`,
      {
        timeMs: post.offsetMs + 3_600_000,
      },
    );
    expect(moved.status).toBe(200);
    expect((await info(team, draftId)).removals[0]?.timeMs).toBe(post.offsetMs + 3_660_000);

    await call(team.cookie, "DELETE", `/admin/drafts/${draftId}/items/${post.id}`);
    expect((await info(team, draftId)).removals).toEqual([]);
  });

  it("writes a response, and a warning with no text can't be saved as a version", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await info(team, draftId);
    const made = await add(team, draftId, "reaction", {
      on: "post",
      nth: 2,
      type: "warn",
      actorId: before.actors[0]?.id,
      afterMs: 0,
      conditions: [],
    });
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };
    const { issues } = (await (
      await call(team.cookie, "GET", `/admin/drafts/${draftId}`)
    ).json()) as {
      issues: { severity: string; message: string }[];
    };
    expect(issues.some(({ severity }) => severity === "error")).toBe(true);

    expect((await change(team, draftId, id, { body: "Keep it civil" })).status).toBe(200);
    expect((await info(team, draftId)).moderatorReactions).toEqual([
      expect.objectContaining({ id, type: "warn", nth: 2, body: "Keep it civil" }),
    ]);
  });

  it("writes bans and answers to flags and reports, and keeps them in the study they make", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await info(team, draftId);
    const ann = before.actors[0] as { id: string };
    const bob = before.actors[1] as { id: string };
    const post = before.posts[0] as { id: string };

    const missing = await add(team, draftId, "ban", {
      bannedActorId: randomUUID(),
      actorId: ann.id,
      timeMs: 0,
      conditions: [],
    });
    expect(missing.status).toBe(400);

    const ban = await add(team, draftId, "ban", {
      bannedActorId: bob.id,
      actorId: ann.id,
      timeMs: 1000,
      conditions: [],
    });
    expect(ban.status).toBe(200);

    const answer = await add(team, draftId, "reportAnswer", {
      action: "answer",
      actorId: ann.id,
      afterMs: 0,
      message: "No rule was broken",
      conditions: [],
    });
    expect(answer.status).toBe(200);
    const { id: answerId } = (await answer.json()) as { id: string };
    expect(
      (await change(team, draftId, answerId, { reportedActorId: bob.id, action: "ban" })).status,
    ).toBe(200);
    expect((await change(team, draftId, answerId, { reportedActorId: null })).status).toBe(200);

    const flag = await add(team, draftId, "flagAnswer", {
      action: "remove",
      on: "post",
      targetId: post.id,
      actorId: ann.id,
      afterMs: 0,
      conditions: [],
    });
    expect(flag.status).toBe(200);
    const { id: flagId } = (await flag.json()) as { id: string };
    expect((await change(team, draftId, flagId, { on: null, targetId: null })).status).toBe(200);

    // Someone a ban names stays in the cast until it's gone.
    const refused = await call(team.cookie, "DELETE", `/admin/drafts/${draftId}/items/${bob.id}`);
    expect(refused.status).toBe(409);

    const saved = await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);
    expect(saved.status).toBe(200);
    const [draft] = await database.db
      .select({ version: schema.studyDrafts.frozenVersionId })
      .from(schema.studyDrafts)
      .where(eq(schema.studyDrafts.id, draftId));
    const versionId = draft?.version as string;
    const bans = await database.db
      .select()
      .from(schema.scriptedBans)
      .where(eq(schema.scriptedBans.studyVersionId, versionId));
    expect(bans).toHaveLength(1);
    const reports = await database.db
      .select()
      .from(schema.scriptedReportAnswers)
      .where(eq(schema.scriptedReportAnswers.studyVersionId, versionId));
    expect(reports).toEqual([expect.objectContaining({ action: "ban", reportedActorId: null })]);
    const flags = await database.db
      .select()
      .from(schema.scriptedFlagAnswers)
      .where(eq(schema.scriptedFlagAnswers.studyVersionId, versionId));
    expect(flags).toEqual([expect.objectContaining({ action: "remove", contentId: null })]);
  });

  it("writes automatic rules and answers to appeals, and keeps them in order", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await info(team, draftId);
    const actorId = before.actors[0]?.id as string;
    const rule = (match: string) => ({
      on: "both",
      match,
      action: "confirm",
      actorId,
      afterMs: 0,
      message: "Sure?",
      conditions: [],
    });
    const first = await add(team, draftId, "autoRule", rule("first"));
    expect(first.status).toBe(200);
    expect((await add(team, draftId, "autoRule", rule("second"))).status).toBe(200);
    const { id } = (await first.json()) as { id: string };
    expect(
      (await change(team, draftId, id, { action: "hold", holdOutcome: "remove", afterMs: 60_000 }))
        .status,
    ).toBe(200);
    expect((await change(team, draftId, id, { action: "warn", holdOutcome: null })).status).toBe(
      200,
    );
    expect((await change(team, draftId, id, { match: "" })).status).toBe(400);

    const answer = await add(team, draftId, "appealAnswer", {
      action: "restore",
      actorId,
      afterMs: 0,
      conditions: [],
    });
    expect(answer.status).toBe(200);

    const saved = await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);
    expect(saved.status).toBe(200);
    const [draft] = await database.db
      .select({ version: schema.studyDrafts.frozenVersionId })
      .from(schema.studyDrafts)
      .where(eq(schema.studyDrafts.id, draftId));
    const rules = await database.db
      .select()
      .from(schema.scriptedAutoRules)
      .where(eq(schema.scriptedAutoRules.studyVersionId, draft?.version as string));
    const byPosition = [...rules].sort((a, b) => a.position - b.position);
    expect(byPosition.map(({ match, action }) => [match, action])).toEqual([
      ["first", "warn"],
      ["second", "confirm"],
    ]);
  });

  it("refuses someone who can only view", async () => {
    const team = await lab();
    const { draftId } = await open(team);
    const before = await info(team, draftId);
    const email = `viewer-${randomUUID().slice(0, 6)}@example.edu`;
    const viewer = await addResearcherToTeam(database.db, {
      teamSlug: team.teamSlug,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const cookie = await signIn(email, (viewer as { password: string }).password);
    const refused = await call(cookie, "POST", `/admin/drafts/${draftId}/items`, {
      kind: "removal",
      fields: {
        on: "post",
        targetId: before.posts[0]?.id,
        actorId: before.actors[0]?.id,
        timeMs: 0,
        conditions: [],
      },
    });
    expect(refused.status).toBe(403);
  });
});
