import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder, launchVersion, stopNewParticipants } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import {
  clearOldDemoVisits,
  DEMO_STUDIES,
  DEMO_TEAM,
  EXAMPLES_FOLDER,
  setUpDemos,
} from "./demos.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
// Two of the examples, and not the largest, so this stays quick. The others are then missing,
// which is also how one that can't be read looks.
const folder = mkdtempSync(path.join(tmpdir(), "demos-"));
const said: string[] = [];
const setUp = () =>
  setUpDemos({ db: database.db, storage, folder, log: (line) => said.push(line) });

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  for (const example of ["bystander", "vaccine-frames"]) {
    cpSync(path.join(EXAMPLES_FOLDER, example), path.join(folder, example), { recursive: true });
  }
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
  rmSync(folder, { recursive: true, force: true });
  storage.close();
  await database.destroy();
});

const study = async (slug: string) => {
  const [row] = await database.db
    .select()
    .from(schema.studies)
    .where(eq(schema.studies.slug, slug));
  return row;
};
const versions = async (studyId: string) =>
  database.db.select().from(schema.studyVersions).where(eq(schema.studyVersions.studyId, studyId));

describe("the demos a server sets up for itself (ADR 78)", () => {
  it("names only examples that exist", () => {
    for (const example of DEMO_STUDIES) {
      expect(existsSync(path.join(EXAMPLES_FOLDER, example, "study.yaml"))).toBe(true);
    }
  });

  it("opens each example at its own address, in a team of its own, saying it's a demo", async () => {
    await setUp();

    const [team] = await database.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.slug, DEMO_TEAM.slug));
    expect(team?.status).toBe("approved");
    // Anyone can open a demo, so it has none of the host's money to spend on a model.
    expect(team?.limits).toEqual({ starterBudgetUsd: 0 });

    const demo = await study("try-bystander");
    expect(demo?.teamId).toBe(team?.id);
    expect(demo?.liveVersionId).toBeTruthy();
    // The example's own address is left for a lab that imports it.
    expect(await study("bystander")).toBeUndefined();

    const [version] = await versions(demo?.id as string);
    const settings = version?.settings as { title: string };
    expect(settings.title).toMatch(/\(demo\)$/);
    const pages = version?.pages as Record<string, string>;
    expect(pages["pages/consent.md"]).toMatch(/^> \*\*This is a demo of Truman, not a study\.\*\*/);
    expect(pages["pages/consent.md"]).toContain("deleted after 7 days");

    const entry = await app.request("/studies/try-bystander/entry");
    expect(entry.status).toBe(200);
  });

  it("doesn't send anyone on to an example's survey, which doesn't exist", async () => {
    const demo = await study("try-vaccine-frames");
    const [version] = await versions(demo?.id as string);
    const { flow } = (version?.settings ?? {}) as { flow: { step: string; redirect?: string }[] };
    expect(flow.at(-1)).toEqual({ step: "exit" });
  });

  it("goes on when an example can't be read, and says so", () => {
    expect(said).toContain("Demos: eatsnap has errors, so it wasn't set up.");
    expect(said).toContain("Demos: try-vaccine-frames is open, at version 1.");
  });

  it("changes nothing the second time", async () => {
    const demo = await study("try-bystander");
    await setUp();

    expect(await versions(demo?.id as string)).toHaveLength(1);
    const launches = await database.db
      .select()
      .from(schema.studyLaunches)
      .where(eq(schema.studyLaunches.studyId, demo?.id as string));
    expect(launches).toHaveLength(1);
  });

  it("leaves a demo an operator stopped stopped", async () => {
    const demo = await study("try-bystander");
    await stopNewParticipants(database.db, demo?.id as string, "an operator");
    await setUp();

    expect((await study("try-bystander"))?.liveVersionId).toBeNull();
  });

  it("leaves alone a lab's own study that already has a demo's address", async () => {
    const [lab] = await database.db
      .insert(schema.teams)
      .values({ name: "A lab", slug: "a-lab" })
      .returning();
    await database.db
      .delete(schema.studyLaunches)
      .where(eq(schema.studyLaunches.studyId, (await study("try-vaccine-frames"))?.id as string));
    await database.db
      .update(schema.studies)
      .set({ teamId: lab?.id as string })
      .where(eq(schema.studies.slug, "try-vaccine-frames"));
    said.length = 0;
    await setUp();

    expect(said).toContain(
      "Demos: try-vaccine-frames belongs to another team, so it was left alone.",
    );
    const theirs = await study("try-vaccine-frames");
    expect(await versions(theirs?.id as string)).toHaveLength(1);
  });

  describe("clearing out old visits", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const enter = async (slug: string, externalId: string, daysAgo: number) => {
      const entered = await app.request(`/studies/${slug}/enter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalId }),
      });
      expect(entered.status).toBe(200);
      await database.db
        .update(schema.participants)
        .set({ enrolledAt: new Date(Date.now() - daysAgo * DAY) })
        .where(eq(schema.participants.externalId, externalId));
    };
    const still = async (externalId: string) =>
      (
        await database.db
          .select()
          .from(schema.participants)
          .where(eq(schema.participants.externalId, externalId))
      ).length === 1;

    it("deletes demo visitors from more than a week ago, and nobody else", async () => {
      const demo = await study("try-bystander");
      const [version] = await versions(demo?.id as string);
      await launchVersion(database.db, demo?.id as string, version?.id as string, "test");
      // A lab's own study from the same example, whose participants are never touched.
      await importStudyFolder(database.db, storage, path.join(folder, "bystander"), {
        launch: true,
      });

      await enter("try-bystander", "demo-old", 8);
      await enter("try-bystander", "demo-new", 6);
      await enter("bystander", "real-old", 30);

      const cleared = await clearOldDemoVisits({ db: database.db, storage, now: new Date() });

      expect(cleared).toBe(1);
      expect(await still("demo-old")).toBe(false);
      expect(await still("demo-new")).toBe(true);
      expect(await still("real-old")).toBe(true);
    });

    it("takes only so many at a time, oldest first", async () => {
      await enter("try-bystander", "demo-older", 20);
      await enter("try-bystander", "demo-oldest", 40);

      expect(
        await clearOldDemoVisits({ db: database.db, storage, now: new Date(), atMost: 1 }),
      ).toBe(1);
      expect(await still("demo-oldest")).toBe(false);
      expect(await still("demo-older")).toBe(true);
    });
  });
});
