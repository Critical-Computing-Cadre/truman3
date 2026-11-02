import { hasErrors, type StudyIssue } from "@truman3/core";
import { createDb } from "@truman3/db";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { convertLegacyStudy, loadStudyFolder } from "@truman3/study-files";
import { importStudyFolder } from "@truman3/study-import";

const USAGE = `Usage:
  pnpm study validate <study folder>
  pnpm study import <study folder>
  pnpm study convert <old Truman repo> <new study folder> <slug>`;

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
    const result = await importStudyFolder(database.db, storage, folder);
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

const [command, ...args] = process.argv.slice(2);

if (command === "validate" && args[0]) {
  process.exitCode = validate(args[0]);
} else if (command === "import" && args[0]) {
  process.exitCode = await importStudy(args[0]);
} else if (command === "convert" && args[0] && args[1] && args[2]) {
  convertLegacyStudy(args[0], args[1], args[2]);
  console.log(`Converted to ${args[1]}. Next: review study.yaml, then run pnpm study validate.`);
} else {
  console.error(USAGE);
  process.exitCode = 1;
}
