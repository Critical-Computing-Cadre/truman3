import { addResearcherToTeam, resetPassword, setUpTeam, type TeamRole } from "@truman3/accounts";
import { createDb } from "@truman3/db";

const USAGE = `Usage:
  pnpm admin setup <team name> <team slug> <your email> <your name>
  pnpm admin add <team slug> <email> <name> <owner|editor|viewer>
  pnpm admin reset-password <email>`;

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
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} finally {
  await database.close();
}
