import {
  addResearcherToTeam,
  makeOperator,
  resetPassword,
  setUpTeam,
  type TeamRole,
} from "@truman3/accounts";
import { createDb, schema } from "@truman3/db";
import { atHost, type Counts, compareCounts } from "./restore-check.ts";

const USAGE = `Usage:
  pnpm admin setup <team name> <team slug> <your email> <your name>
  pnpm admin add <team slug> <email> <name> <owner|editor|viewer>
  pnpm admin reset-password <email>
  pnpm admin operator <email>      lets them approve labs on a hosted Truman (ADR 70)
  pnpm admin counts                how many rows the main tables have
  pnpm admin check-restore <host>  compares this database with a copy restored from a backup, at
                                   that address, and fails if the copy is missing data`;

const ROLES: readonly string[] = ["owner", "editor", "viewer"];

function showPassword(email: string, password: string | null) {
  if (password) {
    console.log(
      `\nPassword for ${email}: ${password}\nShare it privately. It won't be shown again.`,
    );
  } else {
    console.log(`\n${email} already has an account, so their password is unchanged.`);
  }
}

/** Numbers only, never what's in the rows, so this is safe to run on real data (ADR 73). */
async function countRows(db: ReturnType<typeof createDb>["db"]): Promise<Counts> {
  const tables = {
    teams: schema.teams,
    researchers: schema.researchers,
    studies: schema.studies,
    participants: schema.participants,
    content: schema.content,
    events: schema.events,
  };
  const counts: Counts = {};
  for (const [name, table] of Object.entries(tables)) {
    counts[name] = await db.$count(table);
  }
  return counts;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL isn't set. Copy .env.example to .env.");
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
const database = createDb(databaseUrl);

try {
  if (command === "setup" && args.length === 4) {
    const [teamName, slug, email, name] = args as [string, string, string, string];
    const result = await setUpTeam(database.db, { teamName, slug, email, name });
    console.log(
      `Created team "${teamName}", which now has ${result.studiesAdopted} existing studies.`,
    );
    showPassword(email, result.password);
  } else if (command === "add" && args.length === 4 && ROLES.includes(args[3] as string)) {
    const [teamSlug, email, name, role] = args as [string, string, string, TeamRole];
    const result = await addResearcherToTeam(database.db, { teamSlug, email, name, role });
    if (result.status === "no-team") {
      console.error(`There's no team called "${teamSlug}".`);
      process.exitCode = 1;
    } else {
      console.log(`Added ${email} to ${teamSlug} as ${role}.`);
      showPassword(email, result.password);
    }
  } else if (command === "reset-password" && args[0]) {
    const password = await resetPassword(database.db, args[0]);
    if (password) {
      showPassword(args[0], password);
    } else {
      console.error(`There's no account for ${args[0]}.`);
      process.exitCode = 1;
    }
  } else if (command === "counts") {
    for (const [name, count] of Object.entries(await countRows(database.db))) {
      console.log(`${name.padEnd(13)} ${count}`);
    }
  } else if (command === "check-restore" && args[0]) {
    // The exit code is the answer, so nobody has to read this log to know (docs/guides/restoring.md).
    const copy = createDb(atHost(databaseUrl, args[0]));
    try {
      const { ok, lines } = compareCounts(await countRows(database.db), await countRows(copy.db));
      console.log(lines.join("\n"));
      if (!ok) {
        process.exitCode = 1;
      }
    } finally {
      await copy.close();
    }
  } else if (command === "operator" && args[0]) {
    if (await makeOperator(database.db, args[0])) {
      console.log(`${args[0]} is now an operator. They'll see "Labs" in the admin app.`);
    } else {
      console.error(`There's no account for ${args[0]}.`);
      process.exitCode = 1;
    }
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} finally {
  await database.close();
}
