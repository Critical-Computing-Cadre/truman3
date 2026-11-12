import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "/",
    getClientIp: () => undefined,
    secureCookies: false,
    participantAppUrl: "https://app.truman.test",
    participantDomains: ["eatsnap.test", "clickbright.test"],
  });
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const signIn = async (email: string, password: string) =>
  (
    (await call("", "POST", "/admin/login", { email, password })).headers.get("set-cookie") ?? ""
  ).split(";")[0] ?? "";

async function lab() {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `Lab ${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-addresses-"));
  dirs.push(dir);
  const slug = `addressed-${id}`;
  writeFileSync(
    path.join(dir, "study.yaml"),
    `schemaVersion: 1
slug: ${slug}
title: Addressed
site: { name: EatSnap }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
flow: [{ step: feed }]
`,
  );
  writeFileSync(path.join(dir, "actors.csv"), "username,name\nann,Ann\n");
  writeFileSync(path.join(dir, "posts.csv"), "id,body,actor,time\np1,Hello,ann,-1:00\n");
  const imported = await importStudyFolder(database.db, storage, dir, { teamId, launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return { id, slug, cookie: await signIn(email, password as string) };
}

interface Listed {
  slug: string;
  id: string;
  participantUrl: string;
  participantDomain: string | null;
}
const studies = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/admin/studies")).json()) as { studies: Listed[] }).studies;

describe("a study's address (ADR 74)", () => {
  it("offers this Truman's participant domains, and uses the one a study chooses", async () => {
    const owner = await lab();
    expect(await (await call(owner.cookie, "GET", "/admin/addresses")).json()).toEqual({
      default: "https://app.truman.test",
      domains: ["eatsnap.test", "clickbright.test"],
    });
    const [study] = await studies(owner.cookie);
    expect(study).toMatchObject({
      participantUrl: "https://app.truman.test",
      participantDomain: null,
    });

    const chosen = await call(owner.cookie, "PUT", `/admin/studies/${study?.id}/address`, {
      domain: "EatSnap.test",
    });
    expect(await chosen.json()).toEqual({ participantUrl: "https://eatsnap.test" });
    expect((await studies(owner.cookie))[0]).toMatchObject({
      participantUrl: "https://eatsnap.test",
      participantDomain: "eatsnap.test",
    });

    // Back to the usual address.
    await call(owner.cookie, "PUT", `/admin/studies/${study?.id}/address`, { domain: null });
    expect((await studies(owner.cookie))[0]?.participantUrl).toBe("https://app.truman.test");
  });

  it("refuses a domain this Truman doesn't offer, and a viewer", async () => {
    const owner = await lab();
    const [study] = await studies(owner.cookie);
    const elsewhere = await call(owner.cookie, "PUT", `/admin/studies/${study?.id}/address`, {
      domain: "example.com",
    });
    expect(elsewhere.status).toBe(400);

    const viewer = await addResearcherToTeam(database.db, {
      teamSlug: `lab-${owner.id}`,
      email: `viewer-${owner.id}@example.edu`,
      name: "Viewer",
      role: "viewer",
    });
    const viewerCookie = await signIn(`viewer-${owner.id}@example.edu`, viewer.password as string);
    const refused = await call(viewerCookie, "PUT", `/admin/studies/${study?.id}/address`, {
      domain: "eatsnap.test",
    });
    expect(refused.status).toBe(403);
  });
});
