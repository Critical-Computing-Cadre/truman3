import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const cookieFrom = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

const fetchAs = (cookie: string, url: string) => app.request(url, { headers: { cookie } });

async function lab() {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-media-"));
  dirs.push(dir);
  const slug = `media-${id}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Media
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": "id,body,actor,likes,time\np1,hello,ann,0,-1:00\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { teamId, launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  const researcher = cookieFrom(
    await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  return { slug, researcher };
}

async function join(slug: string, externalId = randomUUID()) {
  const cookie = cookieFrom(
    await app.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId }),
    }),
  );
  return { cookie, externalId };
}

/** Puts a photo on someone's profile, and returns the address the API gives for it. */
async function uploadPicture(cookie: string) {
  const form = new FormData();
  form.set("clientEventId", randomUUID());
  form.set("occurredAt", new Date().toISOString());
  form.set("username", `u${randomUUID().slice(0, 8)}`);
  form.set("name", "Someone");
  form.set("picture", new File([JPEG], "me.jpg", { type: "image/jpeg" }));
  const saved = await app.request("/me/profile", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  expect(saved.status).toBe(200);
  const me = (await (await fetchAs(cookie, "/me")).json()) as { pictureUrl: string };
  return me.pictureUrl;
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

describe("what participants upload", () => {
  it("goes to the person who uploaded it, with headers that keep it private", async () => {
    const { slug } = await lab();
    const person = await join(slug);
    const url = await uploadPicture(person.cookie);
    expect(url).toMatch(/^\/api\/media\/uploads\//);

    const response = await fetchAs(person.cookie, url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("goes to the team that owns the study", async () => {
    const { slug, researcher } = await lab();
    const url = await uploadPicture((await join(slug)).cookie);
    expect((await fetchAs(researcher, url)).status).toBe(200);
  });

  it("gives the same answer to everyone else, whether or not the file exists", async () => {
    const mine = await lab();
    const other = await lab();
    const url = await uploadPicture((await join(mine.slug)).cookie);
    const missing = url.replace(/[^/]+\.jpg$/, `${randomUUID()}.jpg`);

    const strangers = [
      "",
      "session=nonsense",
      (await join(mine.slug)).cookie, // The same study, but another world.
      (await join(other.slug)).cookie,
      other.researcher,
    ];
    for (const cookie of strangers) {
      for (const address of [url, missing]) {
        const response = await fetchAs(cookie, address);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Not found." });
      }
    }
  });

  it("isn't reachable by a path other than the one the API gives", async () => {
    const { slug, researcher } = await lab();
    const person = await join(slug);
    const url = await uploadPicture(person.cookie);
    const key = url.replace("/api/media/", "");

    for (const address of [
      `/media/${key}/`,
      `/media/${key}%00`,
      `/media/uploads/..%2f${key}`,
      `/media/media/${randomUUID()}.jpg`,
      "/media/",
    ]) {
      expect((await fetchAs(researcher, address)).status).toBe(404);
    }
  });

  it("stops being served when they withdraw, and only theirs", async () => {
    const { slug, researcher } = await lab();
    const leaving = await join(slug);
    const staying = await join(slug);
    const leavingUrl = await uploadPicture(leaving.cookie);
    const stayingUrl = await uploadPicture(staying.cookie);
    expect((await fetchAs(researcher, leavingUrl)).status).toBe(200);

    await withdrawParticipant(database.db, storage, {
      slug,
      externalId: leaving.externalId,
      reason: "withdrew",
      requestedBy: "tester",
    });

    expect((await fetchAs(researcher, leavingUrl)).status).toBe(404);
    expect((await fetchAs(leaving.cookie, leavingUrl)).status).toBe(404);
    expect((await fetchAs(researcher, stayingUrl)).status).toBe(200);
    expect(await database.db.select().from(schema.dataDeletions)).not.toEqual([]);
    expect(
      await database.db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.externalId, leaving.externalId)),
    ).toEqual([]);
  });
});
