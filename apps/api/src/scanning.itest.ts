import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { ScanResult } from "./scanning.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
/** What the scanner says about the next photo. */
let verdict: ScanResult = { scan: "clear" };

const cookieFrom = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
const signIn = async (email: string, password: string) =>
  cookieFrom(
    await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
const as = (cookie: string, url: string, body?: object) =>
  app.request(url, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function lab({ shared }: { shared: boolean }) {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-scan-"));
  dirs.push(dir);
  const slug = `scan-${id}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Scanning
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
${shared ? "worlds: { size: 2, waitMinutes: 10 }" : ""}
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
  const [study] = await database.db
    .select()
    .from(schema.studies)
    .where(eq(schema.studies.slug, slug));
  return {
    slug,
    teamSlug: `lab-${id}`,
    studyId: study?.id as string,
    researcher: await signIn(email, password as string),
  };
}

async function join(slug: string) {
  const externalId = randomUUID();
  const cookie = cookieFrom(
    await app.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId }),
    }),
  );
  return { cookie, externalId };
}

/** Puts a photo on someone's profile, and returns where the API serves it from. */
async function uploadPicture(cookie: string, what: ScanResult) {
  verdict = what;
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
  const me = (await (await as(cookie, "/me")).json()) as { pictureUrl: string };
  return me.pictureUrl.replace(/^\/api/, "");
}

const listed = async (researcher: string, studyId: string) =>
  (
    (await (await as(researcher, `/admin/studies/${studyId}/uploads`)).json()) as {
      uploads: { id: string; scan: string; labels: string[]; held: boolean; url: string }[];
    }
  ).uploads;
const kind = async (cookie: string, url: string) =>
  (await as(cookie, url)).headers.get("content-type");

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    scanner: { scan: async () => verdict },
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

describe("scanning what participants upload (ADR 79)", () => {
  it("records every upload, and lists nothing for a photo that's clear", async () => {
    const { slug, studyId, researcher } = await lab({ shared: false });
    const { cookie } = await join(slug);
    const url = await uploadPicture(cookie, { scan: "clear" });

    const [row] = await database.db
      .select()
      .from(schema.uploads)
      .where(eq(schema.uploads.key, url.replace("/media/", "")));
    expect(row).toMatchObject({
      scan: "clear",
      bytes: JPEG.length,
      held: false,
      needsReview: false,
    });
    expect(await listed(researcher, studyId)).toEqual([]);
  });

  it("lists a flagged photo for the researcher, and doesn't hold it in a world of someone's own", async () => {
    const { slug, studyId, researcher } = await lab({ shared: false });
    const { cookie } = await join(slug);
    const url = await uploadPicture(cookie, { scan: "flagged", labels: ["Violence"] });

    expect(await listed(researcher, studyId)).toMatchObject([
      { scan: "flagged", labels: ["Violence"], held: false, url: `/api${url}` },
    ]);
    expect(await kind(cookie, url)).toBe("image/jpeg");
    expect(await kind(researcher, url)).toBe("image/jpeg");
  });

  it("holds a flagged photo in a shared world, until a researcher releases it", async () => {
    const { slug, studyId, researcher } = await lab({ shared: true });
    const uploader = await join(slug);
    const other = await join(slug);
    const url = await uploadPicture(uploader.cookie, { scan: "flagged", labels: ["Explicit"] });

    // Whoever uploaded it sees it as before. The other person in their world gets a stand-in.
    expect(await kind(uploader.cookie, url)).toBe("image/jpeg");
    const standIn = await as(other.cookie, url);
    expect(standIn.headers.get("content-type")).toBe("image/svg+xml");
    expect(await standIn.text()).toContain("This photo is being reviewed.");
    expect(await kind(researcher, url)).toBe("image/jpeg");

    const [upload] = await listed(researcher, studyId);
    expect(upload?.held).toBe(true);
    const released = await as(
      researcher,
      `/admin/studies/${studyId}/uploads/${upload?.id}/decision`,
      {
        decision: "release",
      },
    );
    expect(released.status).toBe(200);

    expect(await kind(other.cookie, url)).toBe("image/jpeg");
    expect(await listed(researcher, studyId)).toEqual([]);
  });

  it("holds a photo that couldn't be scanned in a shared world, and one that's clear is seen by all", async () => {
    const { slug, studyId, researcher } = await lab({ shared: true });
    const uploader = await join(slug);
    const other = await join(slug);

    const clear = await uploadPicture(uploader.cookie, { scan: "clear" });
    expect(await kind(other.cookie, clear)).toBe("image/jpeg");

    const unread = await uploadPicture(uploader.cookie, {
      scan: "unscanned",
      labels: ["A GIF can't be scanned"],
    });
    expect(await kind(other.cookie, unread)).toBe("image/svg+xml");
    expect(await listed(researcher, studyId)).toMatchObject([
      { scan: "unscanned", labels: ["A GIF can't be scanned"], held: true },
    ]);
  });

  it("removes a photo for good, and shows everyone a stand-in for it", async () => {
    const { slug, studyId, researcher } = await lab({ shared: true });
    const uploader = await join(slug);
    const other = await join(slug);
    const url = await uploadPicture(uploader.cookie, { scan: "flagged", labels: ["Violence"] });
    const [upload] = await listed(researcher, studyId);

    await as(researcher, `/admin/studies/${studyId}/uploads/${upload?.id}/decision`, {
      decision: "remove",
    });

    expect(await storage.exists(url.replace("/media/", ""))).toBe(false);
    for (const cookie of [uploader.cookie, other.cookie]) {
      const shown = await as(cookie, url);
      expect(await shown.text()).toContain("This photo was removed.");
    }
    const [row] = await database.db
      .select()
      .from(schema.uploads)
      .where(eq(schema.uploads.id, upload?.id as string));
    expect(row).toMatchObject({ decision: "removed" });
    expect(row?.decidedBy).toMatch(/@example\.edu$/);
  });

  it("is for the study's own team, and a viewer can look but not decide", async () => {
    const { slug, studyId, teamSlug } = await lab({ shared: false });
    const { cookie } = await join(slug);
    await uploadPicture(cookie, { scan: "flagged", labels: ["Violence"] });

    const stranger = (await lab({ shared: false })).researcher;
    expect((await as(stranger, `/admin/studies/${studyId}/uploads`)).status).toBe(404);

    const email = `${randomUUID().slice(0, 8)}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(email, (added as { password: string }).password);
    const [upload] = await listed(viewer, studyId);
    const refused = await as(viewer, `/admin/studies/${studyId}/uploads/${upload?.id}/decision`, {
      decision: "remove",
    });
    expect(refused.status).toBe(403);
  });

  it("forgets a participant's uploads when they withdraw", async () => {
    const { slug } = await lab({ shared: false });
    const { cookie, externalId } = await join(slug);
    const url = await uploadPicture(cookie, { scan: "flagged", labels: ["Violence"] });
    const key = url.replace("/media/", "");

    await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "asked",
      requestedBy: "test",
    });

    expect(
      await database.db.select().from(schema.uploads).where(eq(schema.uploads.key, key)),
    ).toEqual([]);
    expect(await storage.exists(key)).toBe(false);
  });
});
