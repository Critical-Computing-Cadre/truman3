import { randomUUID } from "node:crypto";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { and, eq, isNull } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
});

async function lab() {
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${id}@example.edu`, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const call = (method: string, url: string, body?: object) =>
    app.request(url, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const send = (url: string, files: Record<string, string | Uint8Array>) => {
    const form = new FormData();
    const zipped = zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, file]) => [
          name,
          typeof file === "string" ? strToU8(file) : file,
        ]),
      ),
    );
    form.set("file", new File([zipped], "feed.zip", { type: "application/zip" }));
    return app.request(url, { method: "POST", headers: { cookie }, body: form });
  };
  const draft = async (template: string) => {
    const response = await call("POST", "/admin/studies", {
      teamId,
      title: "From sheets",
      slug: `sheets-${randomUUID().slice(0, 8)}`,
      assignment: "uniform",
      packId: null,
      template,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { draftId: string }).draftId;
  };
  return { call, send, draft };
}

const itemsOf = (draftId: string, kind: string) =>
  database.db
    .select()
    .from(schema.draftItems)
    .where(
      and(
        eq(schema.draftItems.draftId, draftId),
        eq(schema.draftItems.kind, kind),
        isNull(schema.draftItems.deletedAt),
      ),
    );

const ACTORS = "username,name,picture\nann,Ann Lee,ann.png\nbob,Bob,\n";
const PLAIN_ACTORS = "username,name\nann,Ann Lee\nbob,Bob\n";
const POSTS = [
  "id,actor,time,body,picture,place,tagged,likes",
  'p1,ann,-2:00,Up the lake trail,lake.png,"Ithaca, New York",bob,108',
  "p2,bob,-1:00,Trails for beginners?,,,,",
].join("\n");
const COMMENTS =
  "id,postID,actor,time,body\nc1,p1,bob,-1:30,Which trail?\nc2,p2,ann,-0:30,This one\n";

describe("sheets for a draft", () => {
  it("downloads sheets with the columns this kind of platform has, and how to fill them in", async () => {
    const team = await lab();
    const draftId = await team.draft("photo");
    const response = await team.call("GET", `/admin/drafts/${draftId}/sheets`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "actors.csv",
        "posts.csv",
        "comments.csv",
        "how to fill these in.txt",
      ]),
    );
    const header = strFromU8(files["posts.csv"] as Uint8Array).split("\n")[0];
    expect(header).toContain("place");
    expect(header).not.toContain("title");
  });

  it("adds people, posts, comments, and pictures, as one change that can be undone", async () => {
    const team = await lab();
    const draftId = await team.draft("photo");
    const response = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "actors.csv": ACTORS,
      "posts.csv": POSTS,
      "comments.csv": COMMENTS,
      "media/actors/ann.png": PNG,
      "media/posts/lake.png": PNG,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ added: { actor: 2, post: 2, comment: 2 } });

    const actors = await itemsOf(draftId, "actor");
    const ann = actors.find(({ data }) => (data as { username: string }).username === "ann");
    const bob = actors.find(({ data }) => (data as { username: string }).username === "bob");
    expect(ann?.data).toMatchObject({
      name: "Ann Lee",
      picture: expect.stringMatching(/^media\/[0-9a-f]{64}\.png$/),
    });
    expect(ann?.provenance).toEqual({ origin: "file" });

    const posts = await itemsOf(draftId, "post");
    const p1 = posts.find(({ data }) => (data as { ref: string }).ref === "p1");
    expect(p1?.data).toMatchObject({
      actorId: ann?.id,
      place: "Ithaca, New York",
      taggedIds: [bob?.id],
      likes: 108,
      pictures: [expect.stringMatching(/^media\/[0-9a-f]{64}\.png$/)],
    });
    const stored = (p1?.data as { pictures: string[] } | undefined)?.pictures[0] ?? "";
    expect(await storage.exists(stored)).toBe(true);

    const comments = await itemsOf(draftId, "comment");
    expect(comments.find(({ data }) => (data as { ref: string }).ref === "c1")?.data).toMatchObject(
      { actorId: bob?.id, postId: p1?.id },
    );

    // The draft is ready to save, with nothing to fix.
    const info = (await (await team.call("GET", `/admin/drafts/${draftId}`)).json()) as {
      issues: { severity: string; message: string }[];
    };
    expect(info.issues.filter(({ severity }) => severity === "error")).toEqual([]);

    const { changes } = (await (
      await team.call("GET", `/admin/drafts/${draftId}/changes`)
    ).json()) as { changes: { changeId: string; summary: string; canUndo: boolean }[] };
    const [upload] = changes;
    expect(upload).toMatchObject({ summary: expect.stringContaining("and 5 more"), canUndo: true });
    const undo = await team.call(
      "POST",
      `/admin/drafts/${draftId}/changes/${upload?.changeId}/undo`,
    );
    expect(await undo.json()).toEqual({ undone: 6 });
    expect(await itemsOf(draftId, "post")).toEqual([]);
  });

  it("adds to what's there, so a new post can be by someone already in the cast", async () => {
    const team = await lab();
    const draftId = await team.draft("classic");
    await team.send(`/admin/drafts/${draftId}/sheets`, { "actors.csv": PLAIN_ACTORS });
    const response = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "posts.csv": "id,actor,time,body\np9,ann,-1:00,Hello again\n",
    });
    expect(response.status).toBe(200);
    expect(await itemsOf(draftId, "actor")).toHaveLength(2);
    expect(await itemsOf(draftId, "post")).toHaveLength(1);
  });

  it("refuses a username or ID that's already there, says where, and adds nothing", async () => {
    const team = await lab();
    const draftId = await team.draft("classic");
    await team.send(`/admin/drafts/${draftId}/sheets`, { "actors.csv": PLAIN_ACTORS });
    const response = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "actors.csv": "username,name\ncarl,Carl\nann,Another Ann\n",
      "posts.csv": "id,actor,time,body\np1,carl,-1:00,Hi\n",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      issues: [
        {
          severity: "error",
          file: "actors.csv",
          row: 3,
          message: expect.stringContaining('"ann" is already in this draft'),
        },
      ],
    });
    expect(await itemsOf(draftId, "actor")).toHaveLength(2);
    expect(await itemsOf(draftId, "post")).toEqual([]);
  });

  it("says which row points at someone who isn't anywhere, and a picture that's missing", async () => {
    const team = await lab();
    const draftId = await team.draft("classic");
    const missingPerson = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "posts.csv": "id,actor,time,body\np1,nobody,-1:00,Hi\n",
    });
    expect(missingPerson.status).toBe(400);
    expect(await missingPerson.json()).toMatchObject({
      issues: [{ file: "posts.csv", row: 2, message: expect.stringContaining('"nobody"') }],
    });

    const missingPicture = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "actors.csv": ACTORS,
    });
    expect(await missingPicture.json()).toMatchObject({
      issues: [{ message: expect.stringContaining('"ann.png"') }],
    });
    expect(await itemsOf(draftId, "actor")).toEqual([]);
  });

  it("takes a zip of the folder itself, and refuses what isn't a picture", async () => {
    const team = await lab();
    const draftId = await team.draft("classic");
    const notAPicture = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "my feed/actors.csv": ACTORS,
      "my feed/media/actors/ann.png": "not really a picture",
      "__MACOSX/my feed/._actors.csv": "mac stuff",
    });
    expect(notAPicture.status).toBe(400);
    expect(await notAPicture.json()).toMatchObject({
      issues: [{ message: expect.stringContaining("media/actors/ann.png") }],
    });

    const fine = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "my feed/actors.csv": ACTORS,
      "my feed/media/actors/ann.png": PNG,
    });
    expect(fine.status).toBe(200);
  });

  it("refuses what isn't a zip of sheets", async () => {
    const team = await lab();
    const draftId = await team.draft("classic");
    const empty = await team.send(`/admin/drafts/${draftId}/sheets`, { "notes.txt": "hi" });
    expect(await empty.json()).toMatchObject({ error: expect.stringContaining("There's no") });
  });

  it("downloads a sheet for each thing the platform has, such as communities and moderation", async () => {
    const team = await lab();
    const draftId = await team.draft("forum");
    const response = await team.call("GET", `/admin/drafts/${draftId}/sheets`);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["spaces.csv", "removals.csv", "bans.csv", "auto-rules.csv"]),
    );
    expect(Object.keys(files)).not.toContain("stories.csv");
    const note = strFromU8(files["how to fill these in.txt"] as Uint8Array);
    expect(note).toContain("- spaces.csv: The communities.");
  });

  it("adds communities, moderation, and responses, pointing at what's there and what's new", async () => {
    const team = await lab();
    const draftId = await team.draft("forum");
    await team.send(`/admin/drafts/${draftId}/sheets`, { "actors.csv": PLAIN_ACTORS });
    const response = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "actors.csv": "username,name,moderator\nmods,Moderators,yes\n",
      "spaces.csv": "key,name\nhiking,Hiking\n",
      "media/spaces/hiking.png": PNG,
      "posts.csv": "id,actor,time,title,body,space\np1,ann,-2:00,Trail,Up we go,hiking\n",
      "removals.csv": "on,target,actor,time,reason\npost,p1,mods,1:00,Off topic\n",
      "bans.csv": "user,actor,time,space\nbob,mods,2:00,hiking\n",
      "reactions.csv": "on,nth,type,actor,after,body\npost,0,reply,ann,0:05,Welcome!\n",
      "auto-rules.csv":
        "id,on,match,action,actor,after,message\nr1,both,buy now,confirm,mods,0:00,Sure?\n",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      added: { actor: 1, space: 1, post: 1, removal: 1, ban: 1, reaction: 1, autoRule: 1 },
    });

    const [space] = await itemsOf(draftId, "space");
    const [post] = await itemsOf(draftId, "post");
    const [removal] = await itemsOf(draftId, "removal");
    const [ban] = await itemsOf(draftId, "ban");
    const bob = (await itemsOf(draftId, "actor")).find(
      ({ data }) => (data as { username: string }).username === "bob",
    );
    expect(post?.data).toMatchObject({ spaceId: space?.id });
    expect(removal?.data).toMatchObject({ on: "post", targetId: post?.id, reason: "Off topic" });
    expect(ban?.data).toMatchObject({ bannedActorId: bob?.id, spaceId: space?.id });

    // A community's key is taken now, so the same one again is refused.
    const again = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "spaces.csv": "key,name\nhiking,Hiking again\n",
    });
    expect(await again.json()).toMatchObject({
      issues: [{ file: "spaces.csv", row: 2, message: expect.stringContaining('"hiking"') }],
    });
  });

  it("adds stories with their pictures", async () => {
    const team = await lab();
    const draftId = await team.draft("photo");
    const response = await team.send(`/admin/drafts/${draftId}/sheets`, {
      "actors.csv": PLAIN_ACTORS,
      "stories.csv": "id,actor,picture,time,caption\ns1,ann,sunrise.png,-1:00,Morning\n",
      "media/posts/sunrise.png": PNG,
    });
    expect(response.status).toBe(200);
    const [story] = await itemsOf(draftId, "story");
    expect(story?.data).toMatchObject({
      caption: "Morning",
      picture: expect.stringMatching(/^media\/[0-9a-f]{64}\.png$/),
    });
  });
});
