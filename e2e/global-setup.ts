import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { setUpTeam } from "@truman3/accounts";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { ADMIN_PORT, API_PORT, APP_PORT } from "./playwright.config.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
export const STATE_FILE = path.join(import.meta.dirname, ".e2e-state.json");

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
  );
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  const email = "researcher@example.edu";
  const { password } = await setUpTeam(database.db, {
    teamName: "Test Lab",
    slug: "test-lab",
    email,
    name: "A Researcher",
  });
  writeFileSync(STATE_FILE, JSON.stringify({ databaseUrl: database.url, email, password }));

  const processes: ChildProcess[] = [
    spawn("node", ["src/server.ts"], {
      cwd: path.join(ROOT, "apps/api"),
      env: {
        ...process.env,
        DATABASE_URL: database.url,
        PORT: String(API_PORT),
        NODE_ENV: "development",
      },
      stdio: "inherit",
    }),
    // Vite directly rather than through pnpm, which wouldn't pass along the signal to stop it.
    spawn("node", ["node_modules/vite/bin/vite.js", "--port", String(APP_PORT)], {
      cwd: path.join(ROOT, "apps/participant"),
      env: { ...process.env, API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      stdio: "ignore",
    }),
    spawn("node", ["node_modules/vite/bin/vite.js", "--port", String(ADMIN_PORT)], {
      cwd: path.join(ROOT, "apps/admin"),
      env: { ...process.env, API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      stdio: "ignore",
    }),
  ];

  await waitFor(`http://localhost:${API_PORT}/health/ready`, "The API");
  await waitFor(`http://localhost:${APP_PORT}/`, "The participant app");
  await waitFor(`http://localhost:${ADMIN_PORT}/`, "The admin app");

  return async () => {
    for (const child of processes) {
      child.kill();
    }
    storage.close();
    await database.destroy();
  };
}
