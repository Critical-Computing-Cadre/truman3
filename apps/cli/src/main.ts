import { hasErrors, type StudyIssue } from "@truman3/core";
import { createDb, schema } from "@truman3/db";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { convertLegacyStudy, loadStudyFolder } from "@truman3/study-files";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";

const USAGE = `Usage:
  pnpm study validate <study folder>
  pnpm study import <study folder>
  pnpm study convert <old Truman repo> <new study folder> <slug>
  pnpm study export <slug> <folder> [--min-dwell-ms N] [--max-dwell-ms N] [--include-recruitment-ids]
  pnpm study withdraw <slug> <recruitment ID> <your name> [reason]`;

/** Warnings are often repetitive, so past this many it shows a count instead of every one. */
const MAX_WARNINGS_SHOWN = 5;

function describe(issue: StudyIssue): string {
  const place = [issue.file, issue.row && `row ${issue.row}`].filter(Boolean).join(", ");
  return place ? `${place}: ${issue.message}` : issue.message;
}

function printIssues(issues: StudyIssue[]) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  for (const issue of errors) {
    console.error(`Error: ${describe(issue)}`);
  }
  for (const issue of warnings.slice(0, MAX_WARNINGS_SHOWN)) {
    console.warn(`Warning: ${describe(issue)}`);
  }
  if (warnings.length > MAX_WARNINGS_SHOWN) {
    console.warn(`...and ${warnings.length - MAX_WARNINGS_SHOWN} more warnings.`);
  }
}

function validate(folder: string): number {
  const { definition, issues } = loadStudyFolder(folder);
  printIssues(issues);

  if (hasErrors(issues) || !definition) {
    console.error("\nThis study has errors, so it can't be imported yet.");
    return 1;
  }

  const { actors, posts, comments, reactions, settings } = definition;
  console.log(
    `\n"${settings.title}" is valid: ${settings.conditions.arms.length} conditions, ${actors.length} actors, ${posts.length} posts, ${comments.length} comments, ${reactions.length} reactions.`,
  );
  return 0;
}

async function importStudy(folder: string): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL isn't set. Copy .env.example to .env.");
    return 1;
  }

  const database = createDb(databaseUrl);
  const storage = createStorage(storageConfigFromEnv());
  try {
    // A lab has one team, so new studies go there. A second team would need a way to choose.
    const teams = await database.db.select({ id: schema.teams.id }).from(schema.teams);
    const result = await importStudyFolder(database.db, storage, folder, {
      teamId: teams.length === 1 ? teams[0]?.id : undefined,
    });
    printIssues(result.issues);

    if (result.status === "failed") {
      console.error("\nThis study has errors, so it wasn't imported.");
      return 1;
    }
    if (result.status === "unchanged") {
      console.log(`\nNothing changed: this content is already version ${result.version}.`);
    } else {
      console.log(
        `\nImported and froze version ${result.version}, and uploaded ${result.mediaUploaded} images.`,
      );
    }
    return 0;
  } finally {
    storage.close();
    await database.close();
  }
}

async function withdraw(slug: string, externalId: string, requestedBy: string, reason: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL isn't set. Copy .env.example to .env.");
    return 1;
  }

  const database = createDb(databaseUrl);
  const storage = createStorage(storageConfigFromEnv());
  try {
    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason,
      requestedBy,
    });
    if (result.status === "not-found") {
      console.error(`There's no participant with that ID in "${slug}". Nothing was changed.`);
      return 1;
    }
    console.log(
      `Deleted this participant's data: ${result.eventsDeleted} events and ${result.filesDeleted} uploaded files. This ID can't enter "${slug}" again.`,
    );
    return 0;
  } finally {
    storage.close();
    await database.close();
  }
}

async function exportData(slug: string, folder: string, flags: string[]) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL isn't set. Copy .env.example to .env.");
    return 1;
  }

  const numberAfter = (flag: string) => {
    const index = flags.indexOf(flag);
    return index === -1 ? undefined : Number(flags[index + 1]);
  };

  const database = createDb(databaseUrl);
  try {
    const result = await exportStudy(database.db, slug, folder, {
      minDwellMs: numberAfter("--min-dwell-ms"),
      maxDwellMs: numberAfter("--max-dwell-ms"),
      includeRecruitmentIds: flags.includes("--include-recruitment-ids"),
    });
    if (result.status === "not-found") {
      console.error(`There's no study called "${slug}".`);
      return 1;
    }
    console.log(
      `Exported ${result.participants} participants and ${result.events} events to ${folder}. Start with codebook.md.`,
    );
    return 0;
  } finally {
    await database.close();
  }
}

const [command, ...args] = process.argv.slice(2);

if (command === "validate" && args[0]) {
  process.exitCode = validate(args[0]);
} else if (command === "import" && args[0]) {
  process.exitCode = await importStudy(args[0]);
} else if (command === "export" && args[0] && args[1]) {
  process.exitCode = await exportData(args[0], args[1], args.slice(2));
} else if (command === "withdraw" && args[0] && args[1] && args[2]) {
  process.exitCode = await withdraw(args[0], args[1], args[2], args[3] ?? "withdrawal");
} else if (command === "convert" && args[0] && args[1] && args[2]) {
  convertLegacyStudy(args[0], args[1], args[2]);
  console.log(`Converted to ${args[1]}. Next: review study.yaml, then run pnpm study validate.`);
} else {
  console.error(USAGE);
  process.exitCode = 1;
}
