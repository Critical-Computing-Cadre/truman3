import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { savePackFromFolder } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

function studyFolder(title: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-pack-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "pages"));
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: pack-source
title: ${title}
site: { name: Packsite }
length: { days: 3 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a, weight: 2 }, { key: b }]
platform: { style: text }
likes: { posts: [7] }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: consent, page: pages/consent.md }, { step: feed }]
`,
    "pages/consent.md": "# Another lab's consent",
    "actors.csv": "username,name,picture\nann,Ann,ann.jpg\nbob,Bob,\n",
    "posts.csv": [
      "id,body,picture,actor,time,condition",
      "p1,for everyone,one.jpg,ann,-1:00,",
      "p2,only a,,bob,-0:30,a",
    ].join("\n"),
    "comments.csv": [
      "id,body,actor,postID,likes,time,condition",
      "c1,on everyone's,bob,p1,2,-0:50,",
      "c2,on a's post,ann,p2,0,-0:20,",
      "c3,only b,ann,p1,0,-0:10,b",
    ].join("\n"),
    "reactions.csv": "on,nth,type,actor,after,body\npost,0,reply,ann,0:01,Nice\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

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
  return { id, teamId, call };
}

type Lab = Awaited<ReturnType<typeof lab>>;

const start = async (team: Lab, fields: object) => {
  const response = await team.call("POST", "/admin/studies", {
    teamId: team.teamId,
    title: "New study",
    slug: `study-${randomUUID().slice(0, 8)}`,
    assignment: "uniform",
    packId: null,
    ...fields,
  });
  return response;
};

const startedDraft = async (team: Lab, fields: object) => {
  const response = await start(team, fields);
  expect(response.status).toBe(200);
  return ((await response.json()) as { draftId: string }).draftId;
};

const info = async (team: Lab, draftId: string) =>
  (await (await team.call("GET", `/admin/drafts/${draftId}`)).json()) as {
    title: string;
    conditions: { key: string; platformStyle: string }[];
    actors: { id: string; username: string; usedBy: number }[];
    posts: { id: string; body: string }[];
    lengthMs: number;
    issues: { severity: string; message: string }[];
  };

const itemsOf = (draftId: string, kind: string) =>
  database.db
    .select()
    .from(schema.draftItems)
    .where(and(eq(schema.draftItems.draftId, draftId), eq(schema.draftItems.kind, kind)));

let packId: string;

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
  const saved = await savePackFromFolder(database.db, storage, studyFolder("Shared pack"), {
    description: "For everyone",
  });
  if (saved.status === "failed") {
    throw new Error(saved.issues.map((issue) => issue.message).join("\n"));
  }
  packId = saved.id;
});

afterAll(async () => {
  storage.close();
  await database.destroy();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("content packs", () => {
  it("adding the same folder twice keeps one pack", async () => {
    const again = await savePackFromFolder(database.db, storage, studyFolder("Shared pack"));
    expect(again).toMatchObject({ status: "exists", id: packId });
  });

  it("lists a pack with its counts, and images ready to show", async () => {
    const team = await lab();
    const { packs } = (await (await team.call("GET", "/admin/packs")).json()) as {
      packs: {
        id: string;
        team: string | null;
        actors: number;
        posts: number;
        comments: number;
        targeted: number;
        imageUrls: string[];
      }[];
    };
    expect(packs.find(({ id }) => id === packId)).toMatchObject({
      team: null,
      actors: 2,
      posts: 2,
      comments: 3,
      targeted: 2,
      imageUrls: ["https://cdn.example.com/m/one.jpg"],
    });
  });

  it("copies everything, and marks where it came from", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, { packId });
    const draft = await info(team, draftId);

    expect(draft.title).toBe("New study");
    expect(draft.conditions.map(({ key }) => key)).toEqual(["a", "b"]);
    expect(draft.conditions[0]?.platformStyle).toBe("text");
    expect(draft.lengthMs).toBe(3 * 24 * 3_600_000);
    expect(draft.posts.map(({ body }) => body)).toEqual(["for everyone", "only a"]);
    expect(draft.issues.filter(({ severity }) => severity === "error")).toEqual([]);

    const [post] = await itemsOf(draftId, "post");
    expect(post?.provenance).toMatchObject({
      origin: "pack",
      pack: { id: packId, name: "Shared pack" },
    });
    expect((post?.data as { likes: number } | undefined)?.likes).toBe(7);
    expect((await itemsOf(draftId, "reaction")).length).toBe(1);
  });

  it("doesn't bring another study's consent text", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, { packId });
    const settings = (await (
      await team.call("GET", `/admin/drafts/${draftId}/settings`)
    ).json()) as {
      pages: Record<string, { text: string }>;
    };
    const text = Object.values(settings.pages)
      .map((page) => page.text)
      .join();
    expect(text).toContain("your IRB approved");
    expect(text).not.toContain("Another lab");
  });

  it("just the background leaves out what's limited to a condition, and what depended on it", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, { packId, keep: "background" });
    const draft = await info(team, draftId);

    expect(draft.conditions.map(({ key }) => key)).toEqual(["control"]);
    expect(draft.posts.map(({ body }) => body)).toEqual(["for everyone"]);
    const comments = await itemsOf(draftId, "comment");
    // "only b" is limited to a condition, and "on a's post" was on a post that's gone.
    expect(comments.map(({ data }) => (data as { body: string }).body)).toEqual(["on everyone's"]);
    expect(draft.issues.filter(({ severity }) => severity === "error")).toEqual([]);
  });

  it("a copy freezes and launches like any other study, and stays apart from the pack", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, { packId, assignment: "blocked" });

    const draft = await info(team, draftId);
    const [post] = draft.posts;
    await team.call("PATCH", `/admin/drafts/${draftId}/items/${post?.id}`, {
      changes: { body: "changed here" },
    });

    const frozen = await team.call("POST", `/admin/drafts/${draftId}/freeze`);
    expect((await frozen.json()) as { status: string; version: number }).toMatchObject({
      status: "frozen",
      version: 1,
    });

    const [frozenPost] = await database.db
      .select({ provenance: schema.content.provenance })
      .from(schema.content)
      .where(eq(schema.content.body, "changed here"));
    expect(frozenPost?.provenance).toMatchObject({ origin: "pack", edited: true });

    // The next study from this pack still gets the original.
    const another = await info(team, await startedDraft(team, { packId }));
    expect(another.posts.map(({ body }) => body)).toContain("for everyone");
  });

  it("a study can be saved as a pack, which only its team can use", async () => {
    const team = await lab();
    const other = await lab();
    const draftId = await startedDraft(team, { packId });

    const saved = await team.call("POST", `/admin/drafts/${draftId}/pack`, {
      name: "Our pack",
      description: "Ours",
    });
    const { status, id } = (await saved.json()) as { status: string; id: string };
    expect(status).toBe("saved");

    const list = async (who: Lab) =>
      (
        (await (await who.call("GET", "/admin/packs")).json()) as { packs: { id: string }[] }
      ).packs.map((pack) => pack.id);
    expect(await list(team)).toContain(id);
    expect(await list(other)).not.toContain(id);
    expect((await start(other, { packId: id })).status).toBe(404);

    // Its items remember the pack they came from before this one.
    const fromSaved = await startedDraft(team, { packId: id });
    const [post] = await itemsOf(fromSaved, "post");
    expect(post?.provenance).toMatchObject({
      origin: "pack",
      pack: { id, name: "Our pack" },
      before: { origin: "pack", pack: { id: packId } },
    });
  });

  it("saving the same content again says so", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, { packId });
    await team.call("POST", `/admin/drafts/${draftId}/pack`, { name: "First" });
    const again = await team.call("POST", `/admin/drafts/${draftId}/pack`, { name: "Second" });
    expect((await again.json()) as object).toMatchObject({ status: "exists", name: "First" });
  });
});

describe("starting a study", () => {
  it("from nothing has a working flow and no content", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, {});
    const draft = await info(team, draftId);

    expect(draft.conditions.map(({ key }) => key)).toEqual(["control"]);
    expect(draft.actors).toEqual([]);
    expect(draft.issues.filter(({ severity }) => severity === "error")).toEqual([]);

    const frozen = await team.call("POST", `/admin/drafts/${draftId}/freeze`);
    expect(((await frozen.json()) as { status: string }).status).toBe("frozen");
  });

  it("needs a choice of assignment, with no default", async () => {
    const team = await lab();
    const response = await team.call("POST", "/admin/studies", {
      teamId: team.teamId,
      title: "x",
      slug: `s-${team.id}`,
      packId: null,
    });
    expect(response.status).toBe(400);
  });

  it("refuses a link name that's taken", async () => {
    const team = await lab();
    const slug = `taken-${team.id}`;
    expect((await start(team, { slug })).status).toBe(200);
    const again = await start(team, { slug });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain(slug);
  });

  it("only happens on a team this person can edit", async () => {
    const team = await lab();
    const other = await lab();
    expect((await start(other, { teamId: team.teamId })).status).toBe(403);
  });

  it("appears in the list before it has a version", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, { title: "Brand new" });
    const { studies } = (await (await team.call("GET", "/admin/studies")).json()) as {
      studies: { draftTitle: string | null; openDraftId: string; versions: unknown[] }[];
    };
    expect(studies[0]).toMatchObject({
      draftTitle: "Brand new",
      openDraftId: draftId,
      versions: [],
    });
  });
});

describe("the cast", () => {
  const person = (username: string) => ({
    kind: "actor",
    fields: { name: "Casey", username, conditions: [] },
  });

  it("adds, changes, and removes people, and undoes it", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, {});
    const url = `/admin/drafts/${draftId}/items`;

    const added = await team.call("POST", url, person("casey"));
    expect(added.status).toBe(200);
    const { id } = (await added.json()) as { id: string };

    const changed = await team.call("PATCH", `${url}/${id}`, { changes: { bio: "Outdoorsy" } });
    expect(changed.status).toBe(200);
    expect((await info(team, draftId)).actors[0]).toMatchObject({ username: "casey", usedBy: 0 });

    const changes = (await (await team.call("GET", `/admin/drafts/${draftId}/changes`)).json()) as {
      changes: { summary: string }[];
    };
    expect(changes.changes[0]?.summary).toBe("changed Casey");

    expect((await team.call("DELETE", `${url}/${id}`)).status).toBe(200);
    expect((await info(team, draftId)).actors).toEqual([]);
  });

  it("refuses a username someone already has, or that isn't usable", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, {});
    const url = `/admin/drafts/${draftId}/items`;
    await team.call("POST", url, person("casey"));
    const second = await team.call("POST", url, person("sam"));
    const { id } = (await second.json()) as { id: string };

    const duplicate = await team.call("POST", url, person("casey"));
    expect(duplicate.status).toBe(400);
    expect(((await duplicate.json()) as { error: string }).error).toMatch(/already has/);

    const renamed = await team.call("PATCH", `${url}/${id}`, { changes: { username: "casey" } });
    expect(renamed.status).toBe(400);

    const spaces = await team.call("PATCH", `${url}/${id}`, { changes: { username: "has space" } });
    expect(spaces.status).toBe(400);

    // Saving their own username again is fine.
    const same = await team.call("PATCH", `${url}/${id}`, { changes: { username: "sam" } });
    expect(same.status).toBe(200);
  });

  it("won't remove someone who has posts", async () => {
    const team = await lab();
    const draftId = await startedDraft(team, {});
    const url = `/admin/drafts/${draftId}/items`;
    const added = await team.call("POST", url, person("casey"));
    const { id } = (await added.json()) as { id: string };
    await team.call("POST", url, {
      kind: "post",
      fields: { body: "Hi", actorId: id, timeMs: 0, conditions: [] },
    });

    expect((await info(team, draftId)).actors[0]?.usedBy).toBe(1);
    expect((await team.call("DELETE", `${url}/${id}`)).status).not.toBe(200);
  });
});
