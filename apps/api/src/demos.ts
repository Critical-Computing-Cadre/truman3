import path from "node:path";
import type { StudyDefinition } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { deleteParticipant, importStudyFolder, launchVersion } from "@truman3/study-import";
import { and, asc, eq, lt } from "drizzle-orm";
import { describeError } from "./errors.ts";

/** Where the example studies live, in the repo and in the API's container. */
export const EXAMPLES_FOLDER = path.resolve(import.meta.dirname, "../../../studies/examples");

/**
 * The example studies anyone can try from the public site (ADR 78). Town talk isn't one: it puts
 * strangers in a world together, and nobody would be reading what they write to each other.
 */
export const DEMO_STUDIES = ["bystander", "eatsnap", "flag-source", "vaccine-frames"] as const;

/** The team the demos belong to. It has no researchers, so only an operator sees it. */
export const DEMO_TEAM = {
  name: "Demos",
  slug: "demos",
  // Nothing of the host's to spend on a model, so the cast uses its written lines. An operator can
  // raise it on the Labs page. Anyone on the internet can open a demo, and that would be their bill.
  // And a small room for photos, since anyone can upload one and they're kept a week (ADR 80).
  limits: { starterBudgetUsd: 0, uploadsGb: 1 },
};

/** A demo's address, which can't collide with a lab's own study of the same example. */
export const demoSlug = (example: string) => `try-${example}`;

/** How long a demo visitor's world is kept. The longest example runs for two days. */
export const DEMO_VISITS_KEPT_DAYS = 7;

const DEMO_NOTE = `> **This is a demo of Truman, not a study.** Everyone you'll meet here is made up, and nothing you do is used for research. Please don't post anything private. What you post is deleted after ${DEMO_VISITS_KEPT_DAYS} days.

`;

/**
 * An example as a demo: at its own address, saying it's a demo before anything else, and ending
 * without sending anyone on to a survey that doesn't exist.
 */
export function asDemo(study: StudyDefinition): StudyDefinition {
  const consent = study.settings.flow.find((step) => step.step === "consent");
  return {
    ...study,
    settings: {
      ...study.settings,
      slug: demoSlug(study.settings.slug),
      title: `${study.settings.title} (demo)`,
      flow: study.settings.flow.map((step) => (step.step === "exit" ? { step: "exit" } : step)),
    },
    pages: consent
      ? { ...study.pages, [consent.page]: DEMO_NOTE + (study.pages[consent.page] ?? "") }
      : study.pages,
  };
}

/**
 * Makes sure this server has the demos, and that they're the examples as they are now. Run as the
 * server starts. Importing the same content twice changes nothing, so most starts do nothing.
 *
 * A demo is opened when it's first made and when an example changes. One an operator has stopped
 * stays stopped until then.
 */
export async function setUpDemos({
  db,
  storage,
  folder = EXAMPLES_FOLDER,
  log = console.log,
}: {
  db: Database;
  storage: Storage;
  folder?: string;
  log?: (line: string) => void;
}): Promise<void> {
  await db.insert(schema.teams).values(DEMO_TEAM).onConflictDoNothing();
  const [team] = await db
    .select({ id: schema.teams.id, limits: schema.teams.limits })
    .from(schema.teams)
    .where(eq(schema.teams.slug, DEMO_TEAM.slug));
  if (!team) {
    log("Demos: the team couldn't be made.");
    return;
  }
  // A Demos team from before a limit existed gets it now. One an operator has set is left alone.
  const missing = Object.fromEntries(
    Object.entries(DEMO_TEAM.limits).filter(([key]) => !(key in (team.limits as object))),
  );
  if (Object.keys(missing).length > 0) {
    await db
      .update(schema.teams)
      .set({ limits: { ...(team.limits as object), ...missing } })
      .where(eq(schema.teams.id, team.id));
  }

  for (const example of DEMO_STUDIES) {
    // One example that can't be read doesn't stop the others, or the server.
    try {
      const slug = demoSlug(example);
      const bySlug = () =>
        db
          .select({ id: schema.studies.id, teamId: schema.studies.teamId })
          .from(schema.studies)
          .where(eq(schema.studies.slug, slug));
      // Checked first, so a lab's own study at this address never gets a version from here.
      const [taken] = await bySlug();
      if (taken && taken.teamId !== team.id) {
        log(`Demos: ${slug} belongs to another team, so it was left alone.`);
        continue;
      }
      const result = await importStudyFolder(db, storage, path.join(folder, example), {
        teamId: team.id,
        change: asDemo,
      });
      if (result.status === "failed") {
        log(`Demos: ${example} has errors, so it wasn't set up.`);
        continue;
      }
      const [study] = await bySlug();
      if (!study) {
        continue;
      }
      const [launched] = await db
        .select({ id: schema.studyLaunches.id })
        .from(schema.studyLaunches)
        .where(eq(schema.studyLaunches.studyId, study.id))
        .limit(1);
      if (result.status === "imported" || !launched) {
        await launchVersion(db, study.id, result.studyVersionId, "demos");
        log(`Demos: ${slug} is open, at version ${result.version}.`);
      }
    } catch (error) {
      log(`Demos: ${example} couldn't be set up: ${JSON.stringify(describeError(error))}`);
    }
  }
}

/**
 * Deletes demo visitors who started more than a week ago, with what they posted and uploaded, the
 * way a withdrawal does. Only participants of the Demos team's studies. Returns how many.
 *
 * It takes some at a time, oldest first, so one run can't hold the database for long. The next run
 * takes more.
 */
export async function clearOldDemoVisits({
  db,
  storage,
  now,
  atMost = 200,
}: {
  db: Database;
  storage: Storage;
  now: Date;
  atMost?: number;
}): Promise<number> {
  const before = new Date(now.getTime() - DEMO_VISITS_KEPT_DAYS * 24 * 60 * 60 * 1000);
  const old = await db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .innerJoin(schema.studies, eq(schema.studies.id, schema.participants.studyId))
    .innerJoin(schema.teams, eq(schema.teams.id, schema.studies.teamId))
    .where(and(eq(schema.teams.slug, DEMO_TEAM.slug), lt(schema.participants.enrolledAt, before)))
    .orderBy(asc(schema.participants.enrolledAt))
    .limit(atMost);
  let cleared = 0;
  for (const { id } of old) {
    // Another server may be clearing the same ones, so one that's already gone isn't a problem.
    try {
      await deleteParticipant(db, storage, id, "demo visit", "demos");
      cleared += 1;
    } catch {
      // Left for the next run.
    }
  }
  return cleared;
}

/** Clears old demo visits soon after the server starts, and every few hours after. */
export function startClearingDemoVisits(
  options: Omit<Parameters<typeof clearOldDemoVisits>[0], "now">,
  everyMs = 6 * 60 * 60 * 1000,
) {
  const run = async () => {
    try {
      const cleared = await clearOldDemoVisits({ ...options, now: new Date() });
      if (cleared > 0) {
        console.log(`Demos: deleted ${cleared} visits older than ${DEMO_VISITS_KEPT_DAYS} days.`);
      }
    } catch (error) {
      console.error("Demo visits couldn't be cleared:", describeError(error));
    }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
