import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

/** When /admin is on a community's address, the browser sends both apps' cookies to the same API. */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
let dir: string;
let participant: string;
let researcher: string;

const cookieFrom = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

const call = (cookie: string, method: string, url: string) =>
  url.endsWith("/images")
    ? app.request(url, { method, headers: { cookie }, body: new FormData() })
    : app.request(url, {
        method,
        headers: { "content-type": "application/json", cookie },
        ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
      });

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

  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  dir = mkdtempSync(path.join(tmpdir(), "truman-shared-"));
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: shared-${id}
title: Shared
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

  participant = cookieFrom(
    await app.request(`/studies/shared-${id}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: randomUUID() }),
    }),
  );
  researcher = cookieFrom(
    await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  storage.close();
  await database.destroy();
});

/** Anyone can try these. Neither gives anything back. */
const OPEN_TO_ANYONE = new Set(["POST /admin/login", "POST /admin/logout"]);

/** Every admin route the API has, so a new one is checked without anyone remembering to. */
function adminRoutes() {
  const routes = new Set(
    app.routes
      .filter(({ path, method }) => path.startsWith("/admin") && method !== "ALL")
      .map(({ path, method }) => `${method} ${path}`),
  );
  return [...routes].filter((route) => !OPEN_TO_ANYONE.has(route));
}

describe("sharing one address with the admin app", () => {
  it("finds the admin routes to check", () => {
    expect(adminRoutes().length).toBeGreaterThan(30);
  });

  it("refuses a participant on every admin route", async () => {
    const answers: string[] = [];
    for (const route of adminRoutes()) {
      const [method, routePath] = route.split(" ") as [string, string];
      const url = routePath.replace(/:[^/]+/g, randomUUID());
      const { status } = await call(participant, method, url);
      // 400 means the request's shape was refused before the route ran, so it gave nothing away.
      if (status !== 401 && status !== 400) {
        answers.push(`${route} answered ${status}`);
      }
    }
    expect(answers).toEqual([]);
  });

  it("doesn't accept a participant's token in the researcher's cookie", async () => {
    const token = participant.split("=")[1];
    const response = await call(`researcher_session=${token}`, "GET", "/admin/studies");
    expect(response.status).toBe(401);
  });

  it("doesn't take a researcher for a participant", async () => {
    expect((await call(researcher, "GET", "/feed")).status).toBe(401);
    expect((await call(researcher, "GET", "/me/flow")).status).toBe(401);
  });

  it("keeps both signed in when one browser holds both", async () => {
    const both = `${participant}; ${researcher}`;
    expect((await call(both, "GET", "/admin/studies")).status).toBe(200);
    expect((await call(both, "GET", "/feed")).status).toBe(200);
  });

  it("signs out only the researcher, and leaves the participant's cookie alone", async () => {
    const response = await call(`${participant}; ${researcher}`, "POST", "/admin/logout");
    const cleared = response.headers.getSetCookie().map((line) => line.split("=")[0]);
    expect(cleared).toEqual(["researcher_session"]);
    expect((await call(participant, "GET", "/feed")).status).toBe(200);
  });
});
