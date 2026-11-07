import { randomInt } from "node:crypto";
import {
  armProbability,
  COUNTABLE,
  type DecisionDefinition,
  type Measure,
  pickUniformArm,
} from "@truman3/core";
import { type Database, schema, type Transaction } from "@truman3/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { ParticipantContext } from "../participants/session.ts";

/**
 * Decision points, for adaptive designs such as SMART designs and just-in-time adaptive
 * interventions. Christof reaches one the way it reaches a beat. Then the participant's measures
 * are taken from the event log, as of when it was due, the first group they fit says where they go,
 * and the choice is written to `assignments` with its probability, so a standard analysis can
 * weight it. See ADR 55.
 */

const RANDOM_RANGE = 2 ** 32;

type Db = Database | Transaction;

/** One measure, as of `at`. */
async function measureOne(db: Db, context: ParticipantContext, measure: Measure, at: Date) {
  if ("fired" in measure) {
    const [run] = await db
      .select({ id: schema.beatRuns.id })
      .from(schema.beatRuns)
      .where(
        and(
          eq(schema.beatRuns.worldId, context.worldId),
          eq(schema.beatRuns.beat, measure.fired),
          eq(schema.beatRuns.status, "fired"),
          lte(schema.beatRuns.dueAt, at),
        ),
      )
      .limit(1);
    return run ? 1 : 0;
  }
  const mine = [
    eq(schema.events.worldId, context.worldId),
    eq(schema.events.participantId, context.participantId),
    eq(schema.events.source, "participant"),
    lte(schema.events.occurredAt, at),
    ...(measure.within === undefined
      ? []
      : [gte(schema.events.occurredAt, new Date(at.getTime() - measure.within))]),
  ];
  if ("activeMinutes" in measure) {
    const [row] = await db
      .select({
        ms: sql<string>`coalesce(sum((${schema.events.payload}->>'activeMs')::numeric), 0)`,
      })
      .from(schema.events)
      .where(and(...mine, eq(schema.events.type, "session.heartbeat")));
    return Math.round(Number(row?.ms ?? 0) / 6_000) / 10;
  }
  const named = COUNTABLE[measure.count as keyof typeof COUNTABLE] as
    | { type: string; kind?: string }
    | undefined;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.events)
    .where(
      and(
        ...mine,
        eq(schema.events.type, named?.type ?? measure.count),
        ...(named?.kind ? [sql`${schema.events.payload}->>'kind' = ${named.kind}`] : []),
      ),
    );
  return row?.count ?? 0;
}

/** Every measure a decision point takes, by name. */
export async function takeMeasures(
  db: Db,
  context: ParticipantContext,
  decision: DecisionDefinition,
  at: Date,
): Promise<Record<string, number>> {
  const measures: Record<string, number> = {};
  for (const [name, measure] of Object.entries(decision.measure)) {
    measures[name] = await measureOne(db, context, measure, at);
  }
  return measures;
}

/** The first group someone fits, by their measures, or undefined for none. */
export function groupFor(decision: DecisionDefinition, measures: Record<string, number>) {
  return decision.groups.find((group) =>
    Object.entries(group.if).every(([name, { atLeast, atMost }]) => {
      const value = measures[name] ?? 0;
      return (
        (atLeast === undefined || value >= atLeast) && (atMost === undefined || value <= atMost)
      );
    }),
  );
}

/** Where someone goes, and the chance they had of going there. `random` is from 0 up to 1. */
export function destination(
  to: "stay" | Record<string, number> | undefined,
  current: string,
  random: number,
): { condition: string; probability: number } {
  if (to === undefined || to === "stay") {
    return { condition: current, probability: 1 };
  }
  const arms = Object.entries(to).map(([key, weight]) => ({ key, weight }));
  const condition = pickUniformArm(arms, random);
  return { condition, probability: armProbability(arms, condition) };
}

/**
 * Makes a decision for one participant, inside the transaction that records its run. Their
 * condition changes from now on, including in `context`, so the rest of this load sees it.
 * Returns what to record as the run's reason.
 */
export async function decide(
  tx: Transaction,
  context: ParticipantContext,
  decision: DecisionDefinition,
  dueAt: Date,
  now: Date,
): Promise<string> {
  const measures = await takeMeasures(tx, context, decision, dueAt);
  const group = groupFor(decision, measures);
  const from = context.conditionKey;
  const { condition, probability } = destination(
    group?.to,
    from,
    randomInt(RANDOM_RANGE) / RANDOM_RANGE,
  );
  const [row] = await tx
    .select({ id: schema.conditions.id })
    .from(schema.conditions)
    .where(
      and(
        eq(schema.conditions.studyVersionId, context.studyVersionId),
        eq(schema.conditions.key, condition),
      ),
    );
  if (!row) {
    throw new Error(`Study version ${context.studyVersionId} has no condition "${condition}".`);
  }
  await tx.insert(schema.assignments).values({
    participantId: context.participantId,
    studyVersionId: context.studyVersionId,
    conditionId: row.id,
    decisionPoint: decision.id,
    method: "decision",
    probability,
    details: { group: group?.name ?? null, from, measures },
    assignedAt: now,
  });
  context.conditionId = row.id;
  context.conditionKey = condition;

  const measured = Object.entries(measures)
    .map(([name, value]) => `${name} ${value}`)
    .join(", ");
  const who = group ? `In "${group.name}"` : "In no group";
  const where =
    condition === from ? `stayed in "${from}"` : `moved from "${from}" to "${condition}"`;
  return `${who}${measured ? ` (${measured})` : ""}, ${where}, with a chance of ${Math.round(probability * 100)}%.`;
}
