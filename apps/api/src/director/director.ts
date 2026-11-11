import { createHash } from "node:crypto";
import {
  BEATS_FILE,
  type BeatDefinition,
  type BeatsFile,
  type BeatTarget,
  createRandom,
  type DecisionDefinition,
  featuresFor,
  formatStudyTime,
} from "@truman3/core";
import { type Database, schema, type Transaction } from "@truman3/db";
import { parseBeats } from "@truman3/study-files";
import type { Writer } from "@truman3/writer";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { loadWorldContext, type ParticipantContext } from "../participants/session.ts";
import { decide } from "./decisions.ts";
import { chooseWords, mightWrite, saysSomething, type Writing } from "./wording.ts";

/**
 * Christof, the director: what makes each beat in beats.yaml happen in a participant's world. See
 * ADR 51.
 *
 * Nothing runs in the background. When the participant does something, the beats it sets off are
 * written down as `pending`, with when they're due. Whenever anything is loaded, `catchUp` decides
 * each pending beat that has come due, as of when it was due, and does what it says. What it makes
 * appears at the time it was due, so a beat looks the same whether someone loads the page a second
 * after it's due or an hour later. Every decision is a row in `beat_runs`, which is its trace.
 */

/** Something the participant did that can set a beat off. */
export interface ParticipantAct {
  action: "post" | "comment" | "like" | "follow" | "repost" | "message";
  /** What they made, for a post, comment, or message, or what they acted on, for a like or repost. */
  contentId?: string;
  /** Whose content it was, who they followed, or who they messaged. */
  targetActorId?: string;
  /** Their nth of this kind of action, from 0. */
  nth: number;
}

/** What set a run off, as `beat_runs.trigger` keeps it. */
type Trigger =
  | { kind: "time" }
  | ({ kind: "participant" } & ParticipantAct)
  | { kind: "beat"; beat: string; runId: string; contentId?: string };

type Db = Database | Transaction;

type Script = Pick<BeatsFile, "beats" | "live" | "cast" | "decide">;

/**
 * Anything Christof schedules: a beat, or a decision point, which is reached the same way but
 * changes the participant's condition instead of doing something in their world.
 */
type Cue = Pick<BeatDefinition, "id" | "when" | "conditions" | "max" | "delay" | "unless"> &
  Partial<Pick<BeatDefinition, "per" | "do">>;

const asCue = (decision: DecisionDefinition): Cue => ({
  ...decision,
  max: 1,
  delay: { minMs: 0, maxMs: 0 },
  unless: [],
});

/** Beats and decision points together, for scheduling. */
const cuesOf = (script: Script): Cue[] => [...script.beats, ...script.decide.map(asCue)];

const scripts = new Map<string, Promise<Script>>();

/** A version's beats.yaml, read once per server, since a version never changes. */
export function scriptFor(db: Db, studyVersionId: string): Promise<Script> {
  const known = scripts.get(studyVersionId);
  if (known) {
    return known;
  }
  const loading = (async () => {
    const [version] = await db
      .select({ pages: schema.studyVersions.pages })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, studyVersionId));
    const text = (version?.pages as Record<string, string> | undefined)?.[BEATS_FILE];
    // A version is checked before it's saved, so a file that can't be read here never ran anyway.
    const { beats, live, cast, decide } = parseBeats(text ?? "");
    return { beats, live, cast, decide };
  })();
  scripts.set(studyVersionId, loading);
  loading.catch(() => scripts.delete(studyVersionId));
  return loading;
}

const inCondition = (beat: Cue, context: ParticipantContext) =>
  beat.conditions.length === 0 || beat.conditions.includes(context.conditionKey);

/**
 * How long after its trigger a run is due. A range is drawn from the same way every time for the
 * same world, beat, and run, so what happened can be worked out again.
 */
function delayOf(beat: Cue, context: ParticipantContext, run: number) {
  const { minMs, maxMs } = beat.delay;
  if (minMs === maxMs) {
    return minMs;
  }
  const salt = Number.parseInt(
    createHash("sha256").update(`${beat.id}:${run}`).digest("hex").slice(0, 8),
    16,
  );
  const random = createRandom((context.seed ^ salt) >>> 0);
  return Math.round(minMs + random() * (maxMs - minMs));
}

/** Writes a beat down as pending, unless it's already used up its runs in this world. */
/** Actions a beat does to "the participant", so in a shared world each participant gets their own. */
const TO_THE_PARTICIPANT = new Set(["message", "follow", "warn"]);

/**
 * Who a run is for (ADR 67). In a world of one, it's always them, so runs are counted for the world.
 * In a shared world, a beat set off by a participant is theirs, and one at a set time happens once,
 * unless what it does is to "the participant". A beat's `per` says otherwise.
 */
function forActorOf(beat: Cue, context: ParticipantContext): string | null {
  if (context.worldMode !== "shared") {
    return null;
  }
  const per =
    beat.per ??
    ("participant" in beat.when || (beat.do && TO_THE_PARTICIPANT.has(beat.do.action))
      ? "participant"
      : "world");
  return per === "participant" ? context.actorId : null;
}

async function schedule(
  tx: Transaction,
  context: ParticipantContext,
  beat: Cue,
  trigger: Trigger,
  at: Date,
) {
  const forActorId = forActorOf(beat, context);
  const runs = await tx
    .select({ run: schema.beatRuns.run })
    .from(schema.beatRuns)
    .where(
      and(
        eq(schema.beatRuns.worldId, context.worldId),
        eq(schema.beatRuns.beat, beat.id),
        forActorId
          ? eq(schema.beatRuns.forActorId, forActorId)
          : isNull(schema.beatRuns.forActorId),
      ),
    );
  if (runs.length >= beat.max) {
    return;
  }
  const run = runs.length;
  await tx
    .insert(schema.beatRuns)
    .values({
      worldId: context.worldId,
      beat: beat.id,
      run,
      status: "pending",
      trigger,
      triggeredAt: at,
      dueAt: new Date(at.getTime() + delayOf(beat, context, run)),
      forActorId,
    })
    // Two loads at once can both get here. The first one wins.
    .onConflictDoNothing();
}

/** What a beat made in this world, newest first, to find what `under` and `{ beat }` point at. */
async function madeBy(tx: Db, context: ParticipantContext, beatId: string, before: Date) {
  return tx
    .select({ contentId: schema.beatRuns.contentId })
    .from(schema.beatRuns)
    .where(
      and(
        eq(schema.beatRuns.worldId, context.worldId),
        eq(schema.beatRuns.beat, beatId),
        eq(schema.beatRuns.status, "fired"),
        lte(schema.beatRuns.dueAt, before),
      ),
    )
    .orderBy(asc(schema.beatRuns.dueAt));
}

/** Whether this content is what a beat made, or anywhere under it. */
async function isUnder(
  tx: Db,
  context: ParticipantContext,
  contentId: string,
  beatId: string,
  now: Date,
) {
  const made = new Set(
    (await madeBy(tx, context, beatId, now)).flatMap(({ contentId: id }) => (id ? [id] : [])),
  );
  let current: string | null = contentId;
  for (let step = 0; current && step < 50; step++) {
    if (made.has(current)) {
      return true;
    }
    const [row] = await tx
      .select({ parentId: schema.content.parentId })
      .from(schema.content)
      .where(eq(schema.content.id, current));
    current = row?.parentId ?? null;
  }
  return false;
}

/**
 * Notes the beats something the participant did sets off. Called in the same transaction as what
 * they did, so a beat is never set off by something that didn't save.
 */
export async function onParticipantAct(
  tx: Transaction,
  context: ParticipantContext,
  act: ParticipantAct,
  now: Date,
) {
  const beats = cuesOf(await scriptFor(tx, context.studyVersionId)).filter(
    (beat) =>
      inCondition(beat, context) &&
      "participant" in beat.when &&
      beat.when.participant === act.action &&
      (beat.when.nth === undefined || beat.when.nth === act.nth),
  );
  // A comment is on whatever it replies to, so whose that is decides `on`.
  let targetActorId = act.targetActorId;
  if (act.action === "comment" && !targetActorId && act.contentId && beats.length > 0) {
    const [comment] = await tx
      .select({ parentId: schema.content.parentId })
      .from(schema.content)
      .where(eq(schema.content.id, act.contentId));
    const [parent] = comment?.parentId
      ? await tx
          .select({ authorActorId: schema.content.authorActorId })
          .from(schema.content)
          .where(eq(schema.content.id, comment.parentId))
      : [];
    targetActorId = parent?.authorActorId;
  }
  for (const beat of beats) {
    const when = beat.when as Extract<Cue["when"], { participant: string }>;
    if (when.on) {
      const [actor] = await tx
        .select({ id: schema.actors.id })
        .from(schema.actors)
        .where(
          and(
            eq(schema.actors.studyVersionId, context.studyVersionId),
            eq(schema.actors.username, when.on),
            isNull(schema.actors.worldId),
          ),
        );
      if (!actor || actor.id !== targetActorId) {
        continue;
      }
    }
    if (
      when.under &&
      !(act.contentId && (await isUnder(tx, context, act.contentId, when.under, now)))
    ) {
      continue;
    }
    await schedule(
      tx,
      context,
      beat,
      { kind: "participant", ...act, ...(targetActorId ? { targetActorId } : {}) },
      now,
    );
  }
}

/** The person in the cast doing an action, by username. */
async function castMember(tx: Db, context: ParticipantContext, username: string) {
  const [actor] = await tx
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.studyVersionId, context.studyVersionId),
        eq(schema.actors.username, username),
        isNull(schema.actors.worldId),
      ),
    );
  return actor?.id ?? null;
}

/** What an action is done to, as of when it's due. Null if there's nothing there to act on. */
async function targetOf(
  tx: Db,
  context: ParticipantContext,
  target: BeatTarget,
  trigger: Trigger,
  dueAt: Date,
): Promise<string | null> {
  if (target === "trigger") {
    return trigger.kind === "time" ? null : (trigger.contentId ?? null);
  }
  if ("beat" in target) {
    const made = await madeBy(tx, context, target.beat, dueAt);
    return made.at(-1)?.contentId ?? null;
  }
  const [post] = await tx
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.studyVersionId, context.studyVersionId),
        eq(schema.content.sourceRef, target.post),
        isNull(schema.content.worldId),
      ),
    );
  return post?.id ?? null;
}

const NEEDS = {
  post: "posting",
  comment: "comments",
  like: "likes",
  repost: "reposts",
  follow: "following",
  message: "messages",
  remove: "removal",
  label: "labels",
  warn: "warnings",
  ban: "bans",
} as const;

type Prepared =
  | {
      ready: true;
      actorId: string;
      target: typeof schema.content.$inferSelect | null;
      /** For a ban, who's banned. */
      bannedId?: string;
    }
  | { ready: false; reason: string };

/** Who does a beat and what to, as of when it's due, or why it can't happen. */
async function prepare(
  db: Db,
  context: ParticipantContext,
  beat: BeatDefinition,
  trigger: Trigger,
  dueAt: Date,
): Promise<Prepared> {
  const action = beat.do;
  const features = featuresFor(context.settings, context.conditionKey);
  if (!features[NEEDS[action.action]]) {
    return { ready: false, reason: `${NEEDS[action.action]} is off in this condition` };
  }
  const actorId = await castMember(db, context, action.actor);
  if (!actorId) {
    return { ready: false, reason: `"${action.actor}" isn't in the cast` };
  }
  if (action.action === "ban") {
    const bannedId = await castMember(db, context, action.who);
    return bannedId
      ? { ready: true, actorId, target: null, bannedId }
      : { ready: false, reason: `"${action.who}" isn't in the cast` };
  }
  if (!("on" in action)) {
    return { ready: true, actorId, target: null };
  }
  const targetId = await targetOf(db, context, action.on, trigger, dueAt);
  const [target] = targetId
    ? await db.select().from(schema.content).where(eq(schema.content.id, targetId))
    : [];
  if (target?.kind === "message") {
    return { ready: false, reason: "a message can't be commented on, liked, or reposted" };
  }
  if (action.action === "warn" && target && target.authorActorId !== context.actorId) {
    return { ready: false, reason: "a warning can only be about what the participant wrote" };
  }
  return target
    ? { ready: true, actorId, target }
    : { ready: false, reason: "there was nothing there to act on" };
}

/** Does what a beat says, at the time it's due, with the words chosen for it. */
async function perform(
  tx: Transaction,
  context: ParticipantContext,
  beat: BeatDefinition,
  { actorId, target, bannedId }: Extract<Prepared, { ready: true }>,
  words: string | null,
  dueAt: Date,
): Promise<{ contentId: string | null; targetContentId: string | null }> {
  const action = beat.do;
  const features = featuresFor(context.settings, context.conditionKey);
  const base = {
    studyVersionId: context.studyVersionId,
    worldId: context.worldId,
    authorActorId: actorId,
    visibleAt: dueAt,
  };

  if (action.action === "post") {
    const [made] = await tx
      .insert(schema.content)
      .values({ ...base, kind: "post", body: words ?? "" })
      .returning({ id: schema.content.id });
    return { contentId: made?.id ?? null, targetContentId: null };
  }

  if (action.action === "message") {
    const [made] = await tx
      .insert(schema.content)
      .values({ ...base, kind: "message", body: words ?? "", recipientActorId: context.actorId })
      .returning({ id: schema.content.id });
    // It shows as unread on their Messages page, not as a notification.
    return { contentId: made?.id ?? null, targetContentId: null };
  }

  // Moderation is a notification to whoever wrote what it's about. Feeds read it from there, and
  // only the participant's own show on their Notifications page.
  if (action.action === "ban") {
    await tx.insert(schema.notifications).values({
      worldId: context.worldId,
      recipientActorId: bannedId as string,
      actorId,
      type: "ban",
      targetActorId: bannedId as string,
      reason: action.reason ?? null,
      dueAt,
    });
    return { contentId: null, targetContentId: null };
  }
  if (
    (action.action === "remove" || action.action === "label" || action.action === "warn") &&
    target
  ) {
    await tx.insert(schema.notifications).values({
      worldId: context.worldId,
      recipientActorId: target.authorActorId,
      actorId,
      type: action.action,
      targetContentId: target.id,
      reason:
        action.action === "label"
          ? action.label
          : action.action === "warn"
            ? action.warning
            : (action.reason ?? null),
      dueAt,
    });
    return { contentId: null, targetContentId: target.id };
  }

  if (action.action === "follow") {
    await tx.insert(schema.notifications).values({
      worldId: context.worldId,
      recipientActorId: context.actorId,
      actorId,
      type: "follow",
      targetActorId: context.actorId,
      dueAt,
    });
    return { contentId: null, targetContentId: null };
  }

  if (!target) {
    return { contentId: null, targetContentId: null };
  }
  const theirs = target.authorActorId === context.actorId;

  if (action.action === "comment") {
    // Without threads, a reply to a comment goes on the post, as it would for anyone.
    let parentId = target.id;
    if (target.kind === "comment" && !features.threads) {
      let current = target;
      while (current.parentId) {
        const [parent] = await tx
          .select()
          .from(schema.content)
          .where(eq(schema.content.id, current.parentId));
        if (!parent) {
          break;
        }
        current = parent;
      }
      parentId = current.id;
    }
    const [made] = await tx
      .insert(schema.content)
      .values({ ...base, kind: "comment", body: words ?? "", parentId })
      .returning({ id: schema.content.id });
    if (theirs) {
      await tx.insert(schema.notifications).values({
        worldId: context.worldId,
        recipientActorId: context.actorId,
        actorId,
        type: "reply",
        targetContentId: target.id,
        replyContentId: made?.id ?? null,
        dueAt,
      });
    }
    return { contentId: made?.id ?? null, targetContentId: target.id };
  }

  if (action.action === "repost") {
    const [made] = await tx
      .insert(schema.content)
      .values({ ...base, kind: "post", repostOf: target.id })
      .returning({ id: schema.content.id });
    if (theirs) {
      await tx.insert(schema.notifications).values({
        worldId: context.worldId,
        recipientActorId: context.actorId,
        actorId,
        type: "repost",
        targetContentId: target.id,
        dueAt,
      });
    }
    return { contentId: made?.id ?? null, targetContentId: target.id };
  }

  // A like counts wherever it is, and tells the participant if it's on what they wrote.
  await tx.insert(schema.notifications).values({
    worldId: context.worldId,
    recipientActorId: target.authorActorId,
    actorId,
    type: "like",
    targetContentId: target.id,
    dueAt,
  });
  return { contentId: null, targetContentId: target.id };
}

/** Beats with a set time that have come due and haven't been written down yet. */
async function scheduleTimed(tx: Transaction, context: ParticipantContext, now: Date) {
  const startMs = context.worldStartedAt.getTime();
  const timed = cuesOf(await scriptFor(tx, context.studyVersionId)).filter(
    (beat) => inCondition(beat, context) && "time" in beat.when,
  );
  if (timed.length === 0) {
    return;
  }
  // Started for this participant, or for the world, whichever the beat is (ADR 67).
  const started = new Set(
    (
      await tx
        .select({ beat: schema.beatRuns.beat, forActorId: schema.beatRuns.forActorId })
        .from(schema.beatRuns)
        .where(
          and(
            eq(schema.beatRuns.worldId, context.worldId),
            inArray(
              schema.beatRuns.beat,
              timed.map(({ id }) => id),
            ),
          ),
        )
    ).map(({ beat, forActorId }) => `${beat}:${forActorId ?? ""}`),
  );
  for (const beat of timed) {
    const at = startMs + (beat.when as { time: number }).time;
    const key = `${beat.id}:${forActorOf(beat, context) ?? ""}`;
    if (!started.has(key) && at <= now.getTime()) {
      await schedule(tx, context, beat, { kind: "time" }, new Date(at));
    }
  }
}

/** How catchUp may decide beats. */
export interface CatchUpOptions {
  now: Date;
  /** What writes improvised lines. Without one, fallback lines are used. */
  writer?: Writer | null | undefined;
  /**
   * Whether this load may wait for a model. A page someone's looking at shouldn't, so it stops at
   * the first beat that might call one, and leaves it, and everything after it, for a background
   * check such as `/me`. Order is kept, so `unless` always sees what came before.
   */
  mayWrite?: boolean;
}

/**
 * Decides every beat that has come due in this world, oldest first, and does what each says. A
 * beat that follows another is written down as that one happens, so a chain plays out in one go.
 * Called before anything is loaded and after the participant does something.
 */
/**
 * How a run is claimed while it's decided, so only one request decides it. Runs waiting for a
 * researcher are claimed as "being approved" instead, which is never retried, since their
 * `decided_at` is when they started waiting.
 */
const BEING_DECIDED = "being decided";
/** Longer than any model call, so a run still being decided is never taken back. */
const STUCK_AFTER_MS = 10 * 60_000;

export async function catchUp(
  db: Database,
  context: ParticipantContext,
  { now, writer = null, mayWrite = false }: CatchUpOptions,
) {
  const script = await scriptFor(db, context.studyVersionId);
  const cues = cuesOf(script);
  if (cues.length === 0) {
    return;
  }
  const byId = new Map(script.beats.map((beat) => [beat.id, beat]));
  const decisions = new Map(script.decide.map((decision) => [decision.id, decision]));

  await db.transaction(async (tx) => {
    await scheduleTimed(tx, context, now);
  });
  // A run claimed long ago was never finished, because the server stopped while deciding it, so
  // it's decided again.
  await db
    .update(schema.beatRuns)
    .set({ status: "pending", decidedAt: null, reason: null })
    .where(
      and(
        eq(schema.beatRuns.worldId, context.worldId),
        eq(schema.beatRuns.status, "skipped"),
        eq(schema.beatRuns.reason, BEING_DECIDED),
        lte(schema.beatRuns.decidedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    );
  await timeOutApprovals(db, context, script, now);

  // A chain can only be as long as there are beats, which bounds the loop.
  for (let round = 0; round <= cues.length * 4; round++) {
    const [run] = await db
      .select()
      .from(schema.beatRuns)
      .where(
        and(
          eq(schema.beatRuns.worldId, context.worldId),
          eq(schema.beatRuns.status, "pending"),
          lte(schema.beatRuns.dueAt, now),
        ),
      )
      .orderBy(asc(schema.beatRuns.dueAt), asc(schema.beatRuns.id))
      .limit(1);
    if (!run) {
      return;
    }
    const beat = byId.get(run.beat);
    if (beat && !mayWrite && mightWrite(script, beat, writer)) {
      return;
    }
    // Only one load decides a run, even if two arrive at once.
    const [claimed] = await db
      .update(schema.beatRuns)
      .set({ status: "skipped", decidedAt: now, reason: BEING_DECIDED })
      .where(and(eq(schema.beatRuns.id, run.id), eq(schema.beatRuns.status, "pending")))
      .returning({ id: schema.beatRuns.id });
    if (!claimed) {
      continue;
    }
    const record = (values: Partial<typeof schema.beatRuns.$inferInsert>) =>
      db.update(schema.beatRuns).set(values).where(eq(schema.beatRuns.id, run.id));
    // In a shared world, a run is decided as the participant it's for, whoever's load got here.
    const here =
      run.forActorId && run.forActorId !== context.actorId
        ? await loadWorldContext(db, context.worldId, run.forActorId)
        : context;
    if (!here) {
      await record({ reason: "they've left the study" });
      continue;
    }
    const decision = decisions.get(run.beat);
    if (decision) {
      if (!inCondition(asCue(decision), here)) {
        await record({ reason: `they're not in its conditions any more` });
        continue;
      }
      await db.transaction(async (tx) => {
        const reason = await decide(tx, here, decision, run.dueAt, now);
        await tx
          .update(schema.beatRuns)
          .set({ status: "fired", reason })
          .where(eq(schema.beatRuns.id, run.id));
        await scheduleFollowers(tx, here, cues, decision.id, run.id, null, run.dueAt);
      });
      continue;
    }
    if (!beat) {
      await record({ reason: "the beat isn't in this version" });
      continue;
    }
    // A decision point may have moved them since this was written down.
    if (!inCondition(beat, here)) {
      await record({ reason: `it isn't in "${here.conditionKey}", their condition now` });
      continue;
    }
    const blockers = beat.unless.length
      ? await db
          .select({ beat: schema.beatRuns.beat })
          .from(schema.beatRuns)
          .where(
            and(
              eq(schema.beatRuns.worldId, here.worldId),
              eq(schema.beatRuns.status, "fired"),
              inArray(schema.beatRuns.beat, beat.unless),
              lte(schema.beatRuns.dueAt, run.dueAt),
            ),
          )
          .limit(1)
      : [];
    if (blockers[0]) {
      await record({ reason: `"${blockers[0].beat}" had already happened` });
      continue;
    }
    const trigger = run.trigger as Trigger;
    const prepared = await prepare(db, here, beat, trigger, run.dueAt);
    if (!prepared.ready) {
      await record({ reason: prepared.reason });
      continue;
    }
    // Choosing words can wait on a model, so it happens outside any transaction.
    const action = beat.do;
    const chosen = saysSomething(action)
      ? await chooseWords(
          db,
          here,
          script,
          action,
          prepared.actorId,
          prepared.target?.id ?? null,
          writer,
          `${beat.id}:${run.run}`,
        )
      : { text: null, writing: null };

    if (needsApproval(script, beat)) {
      await record({
        status: "awaiting",
        reason: "waiting for a researcher",
        actorId: prepared.actorId,
        targetContentId: prepared.target?.id ?? null,
        writing: { ...(chosen.writing ?? { mode: "fixed", costUsd: 0 }), draft: chosen.text },
      });
      continue;
    }
    await fire(db, here, cues, beat, run, prepared, chosen.text, chosen.writing, run.dueAt);
  }
}

/** Whether a beat waits for a researcher before it happens. */
export function needsApproval(script: Script, beat: BeatDefinition) {
  return beat.approve ?? script.live.approval === "all";
}

/**
 * Does a beat, records that it happened, and writes down the beats that follow it, all at once.
 * What it makes appears at `at`: when it was due, or when a researcher approved it.
 */
async function fire(
  db: Database,
  context: ParticipantContext,
  cues: readonly Cue[],
  beat: BeatDefinition,
  run: { id: string },
  prepared: Extract<Prepared, { ready: true }>,
  text: string | null,
  writing: Writing | null,
  at: Date,
) {
  await db.transaction(async (tx) => {
    const done = await perform(tx, context, beat, prepared, text, at);
    await tx
      .update(schema.beatRuns)
      .set({
        status: "fired",
        reason: null,
        actorId: prepared.actorId,
        contentId: done.contentId,
        targetContentId: done.targetContentId,
        writing,
      })
      .where(eq(schema.beatRuns.id, run.id));
    const made = done.contentId ?? done.targetContentId;
    await scheduleFollowers(tx, context, cues, beat.id, run.id, made, at);
  });
}

/** Writes down what follows a beat or decision point. It counts from when that happened. */
async function scheduleFollowers(
  tx: Transaction,
  context: ParticipantContext,
  cues: readonly Cue[],
  after: string,
  runId: string,
  made: string | null,
  at: Date,
) {
  for (const next of cues) {
    if (inCondition(next, context) && "beat" in next.when && next.when.beat === after) {
      await schedule(
        tx,
        context,
        next,
        { kind: "beat", beat: after, runId, ...(made ? { contentId: made } : {}) },
        at,
      );
    }
  }
}

/**
 * The line a beat uses when nobody approves it in time. A rehearsed draft was already read by a
 * researcher when they saved the version (ADR 54), so it's used as it is. Otherwise it's the beat's
 * fixed text or its fallback, since a model's draft was never read by anyone.
 */
const unattendedLine = (beat: BeatDefinition, before: Writing) =>
  !saysSomething(beat.do)
    ? { text: null, mode: "fallback" as const }
    : before.mode === "rehearsed" && before.draft
      ? { text: before.draft, mode: "rehearsed" as const }
      : { text: beat.do.text ?? beat.do.fallback ?? null, mode: "fallback" as const };

/**
 * Beats that waited too long for a researcher. Each happens with its fallback or fixed line, as of
 * when its wait ran out, so a participant never waits forever on someone who isn't watching.
 */
async function timeOutApprovals(
  db: Database,
  context: ParticipantContext,
  script: Script,
  now: Date,
) {
  const { approvalTimeout } = script.live;
  if (approvalTimeout === null) {
    return;
  }
  const waiting = await db
    .select()
    .from(schema.beatRuns)
    .where(
      and(
        eq(schema.beatRuns.worldId, context.worldId),
        eq(schema.beatRuns.status, "awaiting"),
        lte(schema.beatRuns.decidedAt, new Date(now.getTime() - approvalTimeout)),
      ),
    );
  for (const run of waiting) {
    const [claimed] = await db
      .update(schema.beatRuns)
      .set({ status: "skipped", reason: "being approved" })
      .where(and(eq(schema.beatRuns.id, run.id), eq(schema.beatRuns.status, "awaiting")))
      .returning({ id: schema.beatRuns.id });
    const beat = script.beats.find(({ id }) => id === run.beat);
    if (!claimed || !beat) {
      continue;
    }
    // In a shared world, it happens as the participant it's for (ADR 67).
    const owner =
      run.forActorId && run.forActorId !== context.actorId
        ? await loadWorldContext(db, context.worldId, run.forActorId)
        : context;
    if (!owner) {
      continue;
    }
    const at = new Date((run.decidedAt as Date).getTime() + approvalTimeout);
    const prepared = await prepare(db, owner, beat, run.trigger as Trigger, at);
    const line = unattendedLine(beat, (run.writing ?? {}) as Writing);
    const writing = {
      ...(run.writing as Writing),
      mode: line.mode,
      reason: `nobody approved it within ${formatStudyTime(approvalTimeout)}`,
    };
    if (!prepared.ready) {
      await db
        .update(schema.beatRuns)
        .set({ reason: prepared.reason, writing })
        .where(eq(schema.beatRuns.id, run.id));
      continue;
    }
    await fire(db, owner, cuesOf(script), beat, run, prepared, line.text, writing, at);
  }
}

/** What a researcher decides about a beat that's waiting for them. */
export interface Approval {
  action: "approve" | "skip";
  /** The line to post, if they changed it. Leave out to post the draft as it is. */
  text?: string | undefined;
  /** Who decided, for the record. */
  by: string;
}

/**
 * A researcher approves, edits, or skips a beat that's waiting for them. An approved beat happens
 * now, as of the approval, and what follows it counts from then. Returns null if it isn't waiting
 * any more, because someone else decided it or its time ran out.
 */
export async function decideAwaiting(
  db: Database,
  context: ParticipantContext,
  runId: string,
  approval: Approval,
  now: Date,
): Promise<"fired" | "skipped" | null> {
  const [run] = await db
    .update(schema.beatRuns)
    .set({ status: "skipped", reason: "being approved" })
    .where(
      and(
        eq(schema.beatRuns.id, runId),
        eq(schema.beatRuns.worldId, context.worldId),
        eq(schema.beatRuns.status, "awaiting"),
      ),
    )
    .returning();
  if (!run) {
    return null;
  }
  const script = await scriptFor(db, context.studyVersionId);
  const beat = script.beats.find(({ id }) => id === run.beat);
  const before = (run.writing ?? {}) as Writing;
  const record = (values: Partial<typeof schema.beatRuns.$inferInsert>) =>
    db.update(schema.beatRuns).set(values).where(eq(schema.beatRuns.id, run.id));
  if (!beat || approval.action === "skip") {
    await record({
      reason: beat ? "a researcher skipped it" : "the beat isn't in this version",
      writing: { ...before, decidedBy: approval.by },
    });
    return "skipped";
  }
  const prepared = await prepare(db, context, beat, run.trigger as Trigger, now);
  if (!prepared.ready) {
    await record({ reason: prepared.reason, writing: { ...before, decidedBy: approval.by } });
    return "skipped";
  }
  const draft = before.draft ?? null;
  const text = saysSomething(beat.do) ? approval.text?.trim() || draft : null;
  const writing: Writing = {
    ...before,
    decidedBy: approval.by,
    ...(text !== draft ? { edited: true, final: text ?? "" } : {}),
  };
  await fire(db, context, cuesOf(script), beat, run, prepared, text, writing, now);
  return "fired";
}

/** How many times the participant has done this, counting the one just recorded, from 0. */
export async function nthOf(
  tx: Transaction,
  context: ParticipantContext,
  type: "content.liked" | "content.reposted" | "actor.followed",
) {
  const rows = await tx
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.worldId, context.worldId),
        eq(schema.events.participantId, context.participantId),
        eq(schema.events.type, type),
      ),
    );
  return Math.max(0, rows.length - 1);
}
