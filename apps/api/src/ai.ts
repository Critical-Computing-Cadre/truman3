import { teamLimitsSchema } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { decryptSecret } from "@truman3/recruit";
import { anthropicWriter, NothingWritten, type Writer } from "@truman3/writer";
import { and, eq, sql, sum } from "drizzle-orm";

/**
 * Whose Claude key each model call uses, and what it cost (ADR 71). A lab with its own key pays for
 * its own use. Otherwise it uses the host's key: on a hosted Truman, only once it's approved, and
 * only up to its starter budget. Every call is recorded in ai_spending either way.
 */

/** What a model call is for, so it's charged to the right team and study. */
export type AiScope = { studyId: string } | { studyVersionId: string } | { draftId: string };

/** A writer that can be narrowed to a study, choosing whose key pays. */
export interface ScopedWriter extends Writer {
  scoped(scope: AiScope): Promise<Writer>;
  /** Why this study can't use a model now, or null if it can. */
  whyNot(scope: AiScope): Promise<string | null>;
}

/**
 * The writer to use for this study. A plain writer, as in tests and scenario runs, is used as it
 * is. Without one, there's nothing to write with, so the result is null.
 */
export async function writerFor(
  writer: Writer | null | undefined,
  scope: AiScope,
): Promise<Writer | null> {
  if (!writer) {
    return null;
  }
  return "scoped" in writer ? (writer as ScopedWriter).scoped(scope) : writer;
}

/**
 * Why a study can't use a model now, as a sentence to show a researcher, or null if it can. For a
 * page that offers live writing, rehearsing, personas, or an agent.
 */
export async function whyNoModel(
  writer: Writer | null | undefined,
  scope: AiScope,
): Promise<string | null> {
  const why = !writer
    ? "this server has no Claude key"
    : "whyNot" in writer
      ? await (writer as ScopedWriter).whyNot(scope)
      : null;
  return why === null ? null : `${why.charAt(0).toUpperCase()}${why.slice(1)}.`;
}

/** A writer that refuses every call, saying why, so callers use their fallbacks. */
function refusing(why: string): Writer {
  const no = async (): Promise<never> => {
    throw new NothingWritten(why);
  };
  return { write: no, check: no, choose: no, rehearse: no, act: no, runAgent: no };
}

async function studyOf(db: Database, scope: AiScope): Promise<string | null> {
  if ("studyId" in scope) {
    return scope.studyId;
  }
  if ("studyVersionId" in scope) {
    const [row] = await db
      .select({ studyId: schema.studyVersions.studyId })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, scope.studyVersionId));
    return row?.studyId ?? null;
  }
  const [row] = await db
    .select({ studyId: schema.studyDrafts.studyId })
    .from(schema.studyDrafts)
    .where(eq(schema.studyDrafts.id, scope.draftId));
  return row?.studyId ?? null;
}

/** What a team has spent on the host's key, in all. */
export async function hostSpending(db: Database, teamId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(schema.aiSpending.costUsd) })
    .from(schema.aiSpending)
    .where(and(eq(schema.aiSpending.teamId, teamId), eq(schema.aiSpending.paidBy, "host")));
  return Number(row?.total ?? 0);
}

/** The last characters of a key, to show which one it is without showing it. */
export const keyHint = (key: string) => `…${key.trim().slice(-4)}`;

export interface AiOptions {
  db: Database;
  /** The host's own writer, from ANTHROPIC_API_KEY. Null if the host has none. */
  host: Writer | null;
  hosted: boolean;
  /** Decrypts labs' keys. Without it, labs can't store one. */
  secretKey: Buffer | null;
  /** Makes a writer from a lab's key. Tests give their own. */
  writerForKey?: (apiKey: string) => Writer;
}

/**
 * The server's writer: used as it is, it's the host's key, uncounted against any team. Narrowed
 * with `scoped`, it picks the study's team's key or the host's, and records each call.
 */
export function createAi({
  db,
  host,
  hosted,
  secretKey,
  writerForKey = anthropicWriter,
}: AiOptions): ScopedWriter | null {
  const byKey = new Map<string, Writer>();
  const labWriter = (apiKey: string) => {
    let made = byKey.get(apiKey);
    if (!made) {
      made = writerForKey(apiKey);
      byKey.set(apiKey, made);
    }
    return made;
  };

  /** Wraps a writer so each call is recorded, and, on the host's key, kept within a budget. */
  const metered = (
    inner: Writer,
    charge: { teamId: string | null; studyId: string | null; paidBy: "lab" | "host" },
    budgetUsd?: number,
  ): Writer => {
    const record = async <T extends { model: string; costUsd: number }>(
      purpose: string,
      result: T,
    ) => {
      if (result.costUsd > 0) {
        await db.insert(schema.aiSpending).values({
          ...charge,
          purpose,
          model: result.model,
          costUsd: result.costUsd,
        });
      }
      return result;
    };
    const withinBudget = async () => {
      if (budgetUsd !== undefined && charge.teamId) {
        if ((await hostSpending(db, charge.teamId)) >= budgetUsd) {
          throw new NothingWritten(outOfStarter(budgetUsd));
        }
      }
    };
    return {
      write: async (request) => {
        await withinBudget();
        return record("write", await inner.write(request));
      },
      check: async (text, limits, model) => {
        await withinBudget();
        return record("check", await inner.check(text, limits, model));
      },
      choose: async (request) => {
        await withinBudget();
        return record("choose", await inner.choose(request));
      },
      rehearse: async (request) => {
        await withinBudget();
        return record("rehearse", await inner.rehearse(request));
      },
      act: async (request) => {
        await withinBudget();
        return record("act", await inner.act(request));
      },
      runAgent: async (request) => {
        await withinBudget();
        // An agent on the starter budget stops at what's left of it.
        const left =
          budgetUsd !== undefined && charge.teamId
            ? Math.max(0, budgetUsd - (await hostSpending(db, charge.teamId)))
            : request.budgetUsd;
        return record(
          "agent",
          await inner.runAgent({ ...request, budgetUsd: Math.min(request.budgetUsd, left) }),
        );
      },
    };
  };

  /** The writer for a study, or why there's none. */
  const decide = async (scope: AiScope): Promise<{ writer: Writer } | { why: string }> => {
    const studyId = await studyOf(db, scope);
    const [team] = studyId
      ? await db
          .select({
            id: schema.teams.id,
            status: schema.teams.status,
            limits: schema.teams.limits,
            key: schema.teams.anthropicKeyEncrypted,
          })
          .from(schema.studies)
          .innerJoin(schema.teams, eq(schema.teams.id, schema.studies.teamId))
          .where(eq(schema.studies.id, studyId))
      : [];
    if (hosted && team?.key && secretKey) {
      let apiKey: string;
      try {
        apiKey = decryptSecret(team.key, secretKey);
      } catch {
        return { why: "your lab's Claude key can't be read, so please add it again" };
      }
      return { writer: metered(labWriter(apiKey), { teamId: team.id, studyId, paidBy: "lab" }) };
    }
    if (!host) {
      return { why: "there's no Claude key, so add your lab's own" };
    }
    if (!team) {
      return { writer: metered(host, { teamId: null, studyId, paidBy: "host" }) };
    }
    if (hosted && team.status !== "approved") {
      return { why: "your lab isn't approved yet, so add your lab's own Claude key to use one" };
    }
    const { starterBudgetUsd } = teamLimitsSchema.parse(team.limits);
    if (starterBudgetUsd !== undefined && (await hostSpending(db, team.id)) >= starterBudgetUsd) {
      return { why: outOfStarter(starterBudgetUsd) };
    }
    return {
      writer: metered(host, { teamId: team.id, studyId, paidBy: "host" }, starterBudgetUsd),
    };
  };
  const scoped = async (scope: AiScope): Promise<Writer> => {
    const decided = await decide(scope);
    return "writer" in decided ? decided.writer : refusing(decided.why);
  };
  const whyNot = async (scope: AiScope) => {
    const decided = await decide(scope);
    return "why" in decided ? decided.why : null;
  };

  // Labs bring their own keys only on a hosted Truman. A lab running its own sets the host's key.
  if (!host && !(hosted && secretKey)) {
    return null;
  }
  const unscoped = host ?? refusing("there's no Claude key on this server");
  return { ...unscoped, scoped, whyNot };
}

const outOfStarter = (budgetUsd: number) =>
  `your lab's starter budget of $${budgetUsd} is used up, so add your lab's own Claude key`;

/** Totals for a team, for its own page and the operator's. */
export async function teamSpending(db: Database, teamId: string) {
  const rows = await db
    .select({
      paidBy: schema.aiSpending.paidBy,
      total: sum(schema.aiSpending.costUsd),
      last30Days: sql<string>`coalesce(sum(${schema.aiSpending.costUsd}) filter (where ${schema.aiSpending.at} > now() - interval '30 days'), 0)`,
    })
    .from(schema.aiSpending)
    .where(eq(schema.aiSpending.teamId, teamId))
    .groupBy(schema.aiSpending.paidBy);
  const of = (paidBy: string) => rows.find((row) => row.paidBy === paidBy);
  return {
    hostUsd: Number(of("host")?.total ?? 0),
    labUsd: Number(of("lab")?.total ?? 0),
    labLast30DaysUsd: Number(of("lab")?.last30Days ?? 0),
  };
}
