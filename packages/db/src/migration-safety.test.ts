import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STOP_THE_API, unsafeWhileRunning } from "./migration-safety.ts";

const FOLDER = path.resolve(import.meta.dirname, "../migrations");

/**
 * Migrations up to this one ran with the API stopped, which is how every database update worked
 * before ADR 86. They're never run again on a database that has them, so they aren't checked.
 */
const LAST_RUN_WITH_THE_API_STOPPED = 63;

describe("what the old API can run through (ADR 86)", () => {
  it("lets through a migration that only adds things", () => {
    expect(
      unsafeWhileRunning(`
        CREATE TABLE "key_events" ("id" uuid PRIMARY KEY NOT NULL, "at" timestamp NOT NULL);
        --> statement-breakpoint
        ALTER TABLE "teams" ADD COLUMN "key_id" text;--> statement-breakpoint
        ALTER TABLE "teams" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;
        CREATE INDEX "by_team" ON "key_events" ("team_id");
        UPDATE teams SET limits = limits || '{"uploadsGb": 5}'::jsonb;
      `),
    ).toEqual([]);
  });

  it("catches taking away or changing what the old API uses", () => {
    const found = (sql: string) => unsafeWhileRunning(sql).map((line) => line.split(":")[0]);
    expect(found(`DROP TABLE "uploads";`)).toEqual(["drops a table"]);
    expect(found(`ALTER TABLE "teams" DROP COLUMN "key_id";`)).toEqual(["drops a column"]);
    expect(found(`ALTER TABLE "teams" RENAME COLUMN "name" TO "title";`)).toEqual([
      "renames something",
    ]);
    expect(found(`ALTER TABLE "teams" RENAME TO "labs";`)).toEqual(["renames something"]);
    expect(found(`ALTER TABLE "teams" ALTER COLUMN "limits" SET DATA TYPE text;`)).toEqual([
      "changes a column's type",
    ]);
    expect(found(`ALTER TABLE "teams" ALTER COLUMN "key_id" SET NOT NULL;`)).toEqual([
      "makes a column required",
    ]);
    expect(found(`ALTER TABLE "teams" ADD COLUMN "region" text NOT NULL;`)).toEqual([
      "adds a required column with no default",
    ]);
    expect(found(`DROP FUNCTION delete_study(uuid, text);`)).toEqual([
      "drops a function, type, or view",
    ]);
  });

  it("doesn't mind what a comment says", () => {
    expect(
      unsafeWhileRunning(`-- This used to DROP TABLE uploads. It doesn't now.\nSELECT 1;`),
    ).toEqual([]);
  });

  it("holds for every migration since updates stopped needing the API stopped", () => {
    const files = readdirSync(FOLDER)
      .filter((name) => name.endsWith(".sql"))
      .filter((name) => Number(name.slice(0, 4)) > LAST_RUN_WITH_THE_API_STOPPED);
    for (const name of files) {
      const sql = readFileSync(path.join(FOLDER, name), "utf8");
      if (STOP_THE_API.test(sql)) {
        continue;
      }
      expect(
        unsafeWhileRunning(sql),
        `${name} changes something the running API uses. Make the change in two releases (add the new, then remove the old once nothing uses it), or add a line "-- stop-the-api: why" and stop the API to deploy it. See docs/cloud.md.`,
      ).toEqual([]);
    }
  });
});
