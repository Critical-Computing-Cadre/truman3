import path from "node:path";
import type { StudyDefinition } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { importStudyFolder, launchVersion } from "@truman3/study-import";
import { eq } from "drizzle-orm";
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
  limits: { starterBudgetUsd: 0 },
};

/** A demo's address, which can't collide with a lab's own study of the same example. */
export const demoSlug = (example: string) => `try-${example}`;

const DEMO_NOTE = `> **This is a demo of Truman, not a study.** Everyone you'll meet here is made up, and nothing you do is used for research. Please don't post anything private. What you post is deleted from time to time.

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
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(eq(schema.teams.slug, DEMO_TEAM.slug));
  if (!team) {
    log("Demos: the team couldn't be made.");
    return;
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
