import { randomUUID } from "node:crypto";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

// What a study gives any recruitment platform (ADR 98).

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const FRAMES = path.resolve(import.meta.dirname, "../../../../studies/examples/vaccine-frames");

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    participantAppUrl: "https://study.test",
    getClientIp: () => undefined,
    secureCookies: false,
  });
});

afterAll(async () => {
  storage.close();
  await database.destroy();
});

async function signIn(email: string, password: string) {
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function lab() {
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  return { id, teamId, cookie: await signIn(`${id}@example.edu`, password as string) };
}

describe("recruiting", () => {
  it("says the study's link, the ID it reads, and where it sends people at the end", async () => {
    const team = await lab();
    const slug = `frames-${team.id}`;
    const imported = await importStudyFolder(database.db, storage, FRAMES, {
      teamId: team.teamId,
      launch: true,
      change: (study) => ({ ...study, settings: { ...study.settings, slug } }),
    });
    if (imported.status === "failed") {
      throw new Error("import");
    }
    const [row] = await database.db.query.studies.findMany({
      where: (s, { eq }) => eq(s.slug, slug),
    });
    const response = await app.request(`/admin/studies/${row?.id}/recruiting`, {
      headers: { cookie: team.cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      versionId: imported.studyVersionId,
      version: 1,
      live: true,
      joinUrl: `https://study.test/join/${slug}`,
      entry: { idParam: "PROLIFIC_PID", source: "prolific" },
      hasExit: true,
    });

    // A viewer on the lab can see it too. Another lab, and nobody signed in, can't.
    const email = `viewer-${team.id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: `lab-${team.id}`,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(email, added.password as string);
    const asViewer = await app.request(`/admin/studies/${row?.id}/recruiting`, {
      headers: { cookie: viewer },
    });
    expect(asViewer.status).toBe(200);
    const stranger = await lab();
    const asStranger = await app.request(`/admin/studies/${row?.id}/recruiting`, {
      headers: { cookie: stranger.cookie },
    });
    expect(asStranger.status).toBe(404);
    expect((await app.request(`/admin/studies/${row?.id}/recruiting`)).status).toBe(401);
  });
});
