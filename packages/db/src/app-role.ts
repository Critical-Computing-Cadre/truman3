import { sql } from "drizzle-orm";
import type { Database } from "./client.ts";

/** The login the running API uses. It doesn't own anything. See ADR 21. */
export const DEFAULT_APP_ROLE = "truman_app";

const WITHDRAWAL_FUNCTION = "delete_participant_data(uuid, text, text)";

type Rows<T> = readonly T[];

/** Quotes a name or password on the server, since these statements can't take parameters. */
async function statementFor(
  tx: Pick<Database, "execute">,
  template: string,
  role: string,
  password?: string,
) {
  const rows = (await tx.execute(
    password === undefined
      ? sql`select format(${template}, ${role}::text) as statement`
      : sql`select format(${template}, ${role}::text, ${password}::text) as statement`,
  )) as unknown as Rows<{ statement: string }>;
  return sql.raw((rows[0] as { statement: string }).statement);
}

/**
 * Sets out what the API's login can do, after every migration, so a new table is always covered.
 * It's safe to repeat, and starts from nothing each time, so a right taken away here really goes.
 * Without a password it only updates a login that already exists, which leaves local development
 * alone. Returns whether there was a login to update.
 */
export async function applyAppRole(
  db: Database,
  { role = DEFAULT_APP_ROLE, password }: { role?: string; password?: string | undefined } = {},
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = (await tx.execute(
      sql`select 1 from pg_roles where rolname = ${role}`,
    )) as unknown as Rows<unknown>;

    if (password) {
      await tx.execute(
        await statementFor(
          tx,
          existing.length > 0
            ? "ALTER ROLE %I LOGIN PASSWORD %L"
            : "CREATE ROLE %I LOGIN PASSWORD %L",
          role,
          password,
        ),
      );
    } else if (existing.length === 0) {
      return false;
    }

    const run = async (template: string) => {
      await tx.execute(await statementFor(tx, template, role));
    };

    await run("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I");
    await run("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I");
    await run("REVOKE CREATE ON SCHEMA public FROM %I");
    await run("GRANT USAGE ON SCHEMA public TO %I");
    await run("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I");
    await run("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I");

    // The append-only rule lets deletions through when a setting is on, and anyone can turn that
    // setting on. So the login can't update or delete these at all, whatever the setting says.
    const appendOnly = (await tx.execute(sql`
      select distinct c.relname as name
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where p.proname = 'forbid_change' and n.nspname = 'public' and not t.tgisinternal
    `)) as unknown as Rows<{ name: string }>;
    for (const { name } of appendOnly) {
      await tx.execute(
        await statementFor(tx, `REVOKE UPDATE, DELETE ON TABLE ${quoteName(name)} FROM %I`, role),
      );
    }

    // Withdrawal is the one way to delete those rows, so it runs with its owner's rights. A function
    // like that has to fix its search path, or a caller could point its table names elsewhere.
    await tx.execute(
      sql.raw(
        `ALTER FUNCTION ${WITHDRAWAL_FUNCTION} SECURITY DEFINER SET search_path = public, pg_temp`,
      ),
    );
    await tx.execute(sql.raw(`REVOKE EXECUTE ON FUNCTION ${WITHDRAWAL_FUNCTION} FROM PUBLIC`));
    await run(`GRANT EXECUTE ON FUNCTION ${WITHDRAWAL_FUNCTION} TO %I`);
    return true;
  });
}

/** Table names come from the database's own catalog. `%` would otherwise mean something to format. */
function quoteName(name: string) {
  return `"${name.replaceAll('"', '""').replaceAll("%", "%%")}"`;
}

/** Whether this login could change tables, or get around the rules, which the API's never should. */
export async function connectedAsOwner(db: Database): Promise<boolean> {
  const rows = (await db.execute(sql`
    select (
      (select rolsuper from pg_roles where rolname = current_user)
      or exists (
        select 1 from pg_tables where schemaname = 'public' and tableowner = current_user
      )
    ) as owner
  `)) as unknown as Rows<{ owner: boolean }>;
  return rows[0]?.owner === true;
}
