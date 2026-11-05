import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { createTestDatabase } from "@truman3/db/testing";
import { savePackFromFolder } from "@truman3/drafts";
import { createFakeProlific } from "@truman3/recruit/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import {
  ADMIN_PORT,
  API_PORT,
  APP_PORT,
  PROLIFIC_PORT,
  TEST_BUILT_APPS,
} from "./playwright.config.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
export const STATE_FILE = path.join(import.meta.dirname, ".e2e-state.json");

/**
 * A stand-in for Prolific that the API reaches over a real connection. Tests add submissions with
 * POST /test/submissions, since nobody here can take a study on Prolific.
 */
function startFakeProlific() {
  const fake = createFakeProlific({ tokens: ["e2e-prolific-token"] });
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    if (request.url === "/test/submissions") {
      const { prolificId } = JSON.parse(body) as { prolificId: string };
      const [study] = fake.studies.keys();
      fake.addSubmission(study as string, { participant_id: prolificId });
      response.writeHead(204).end();
      return;
    }
    const answer = await fake.fetch(`http://localhost:${PROLIFIC_PORT}${request.url}`, {
      method: request.method ?? "GET",
      headers: { authorization: request.headers.authorization ?? "" },
      ...(body ? { body } : {}),
    });
    response.writeHead(answer.status, { "content-type": "application/json" });
    response.end(await answer.text());
  });
  server.listen(PROLIFIC_PORT);
  return server;
}

/** Vite directly rather than through pnpm, which wouldn't pass along the signal to stop it. */
function startApp(app: "participant" | "admin", port: number) {
  // Either the dev server, or the built files with the same /api forwarding that production has.
  // `vite preview` listens on one address here, so the browser can reach it by name or by number.
  const mode = TEST_BUILT_APPS ? ["preview", "--host", "127.0.0.1"] : [];
  return spawn("node", ["node_modules/vite/bin/vite.js", ...mode, "--port", String(port)], {
    cwd: path.join(ROOT, "apps", app),
    env: {
      ...process.env,
      API_PROXY_TARGET: `http://localhost:${API_PORT}`,
      ADMIN_PROXY_TARGET: `http://localhost:${ADMIN_PORT}`,
    },
    stdio: "ignore",
  });
}

async function waitFor(url: string, name: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) {
        return;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${name} didn't start in time at ${url}.`);
}

/**
 * Sets up everything a real run needs: a temporary database with the eatsnap study, the real API,
 * and the real participant app, all separate from anything used for development.
 */
export default async function globalSetup() {
  if (TEST_BUILT_APPS) {
    for (const app of ["participant", "admin"]) {
      if (!existsSync(path.join(ROOT, "apps", app, "dist/index.html"))) {
        throw new Error("These tests use the built apps. Run `pnpm build` first.");
      }
    }
  }
  const envFile = path.join(ROOT, ".env");
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }

  const database = await createTestDatabase();
  const storage = createStorage(storageConfigFromEnv());
  const result = await importStudyFolder(
    database.db,
    storage,
    path.join(ROOT, "studies/examples/eatsnap"),
    { launch: true },
  );
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  // Available to everyone, like a pack added from the command line.
  const pack = await savePackFromFolder(
    database.db,
    storage,
    path.join(ROOT, "studies/examples/eatsnap"),
    { name: "EatSnap pack", description: "A food photo community." },
  );
  if (pack.status === "failed") {
    throw new Error(pack.issues.map((issue) => issue.message).join("\n"));
  }
  const email = "researcher@example.edu";
  const { password } = await setUpTeam(database.db, {
    teamName: "Test Lab",
    slug: "test-lab",
    email,
    name: "A Researcher",
  });
  const editorEmail = "editor@example.edu";
  const editor = await addResearcherToTeam(database.db, {
    teamSlug: "test-lab",
    email: editorEmail,
    name: "Second Researcher",
    role: "editor",
  });
  // A lab of its own, so the studies it starts don't crowd the shared study's page.
  const otherLabEmail = "other-lab@example.edu";
  const { password: otherLabPassword } = await setUpTeam(database.db, {
    teamName: "Other Lab",
    slug: "other-lab",
    email: otherLabEmail,
    name: "Other Researcher",
  });
  // This one is written in files, which is the other way to write these. It comes after the teams,
  // since setting up a team adopts any study without one, and would crowd that team's page.
  const moderation = await importStudyFolder(
    database.db,
    storage,
    path.join(import.meta.dirname, "fixtures/moderation"),
    { launch: true },
  );
  if (moderation.status === "failed") {
    throw new Error(moderation.issues.map((issue) => issue.message).join("\n"));
  }
  const shortPosts = await importStudyFolder(
    database.db,
    storage,
    path.join(import.meta.dirname, "fixtures/short-posts"),
    { launch: true },
  );
  if (shortPosts.status === "failed") {
    throw new Error(shortPosts.issues.map((issue) => issue.message).join("\n"));
  }
  writeFileSync(
    STATE_FILE,
    JSON.stringify({
      databaseUrl: database.url,
      otherLabEmail,
      otherLabPassword,
      email,
      password,
      editorEmail,
      editorPassword: editor.status === "added" ? editor.password : null,
    }),
  );

  const processes: ChildProcess[] = [
    spawn("node", ["src/server.ts"], {
      cwd: path.join(ROOT, "apps/api"),
      env: {
        ...process.env,
        DATABASE_URL: database.url,
        PORT: String(API_PORT),
        NODE_ENV: TEST_BUILT_APPS ? "production" : "development",
        TRUMAN_SECRET_KEY: randomBytes(32).toString("base64"),
        PROLIFIC_API_URL: `http://localhost:${PROLIFIC_PORT}`,
        PARTICIPANT_APP_URL: `http://localhost:${APP_PORT}`,
        // These tests sign in far more often than a person does.
        LOGIN_ATTEMPTS_PER_MINUTE: "1000",
      },
      stdio: "inherit",
    }),
    startApp("participant", APP_PORT),
    startApp("admin", ADMIN_PORT),
  ];

  const fakeProlific = startFakeProlific();

  await waitFor(`http://localhost:${API_PORT}/health/ready`, "The API");
  await waitFor(`http://localhost:${APP_PORT}/`, "The participant app");
  await waitFor(`http://localhost:${ADMIN_PORT}/`, "The admin app");

  return async () => {
    fakeProlific.close();
    for (const child of processes) {
      child.kill();
    }
    storage.close();
    await database.destroy();
  };
}
