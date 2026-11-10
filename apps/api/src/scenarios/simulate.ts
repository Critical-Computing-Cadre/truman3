import { randomUUID } from "node:crypto";
import {
  createRandom,
  type FeedResponse,
  featuresFor,
  PERSONAS_FILE,
  pickFrom,
  type StudySettings,
} from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { parsePersonas } from "@truman3/study-files";
import { deleteParticipant } from "@truman3/study-import";
import type { Writer } from "@truman3/writer";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { scriptFor } from "../director/director.ts";
import { createHarness, type TestParticipant } from "./harness.ts";
import { type Budget, BudgetSpent, personaBehavior, type Transcript } from "./personas.ts";

/**
 * Simulated participants: many test participants who each go through a version on a fast-forwarded
 * clock, doing things to what they see, and a report on what happened to them all. A behavior
 * decides what each one does. The random one here needs no model, so a run costs nothing and can
 * try many paths through a study's beats. See ADR 59.
 */

export const MAX_SIMULATED = 200;

const HOUR_MS = 60 * 60_000;

type FeedPost = FeedResponse["posts"][number];

/** What a simulated participant sees when they decide what to do next. */
export interface View {
  /** How long since they started, in milliseconds. */
  at: number;
  posts: readonly FeedPost[];
}

/** One thing a simulated participant does. A comment's `on` can be a post or, with threads, a comment. */
export type SimulatedAction =
  | { do: "like" | "upvote" | "downvote" | "repost" | "flag"; on: string }
  | { do: "comment"; on: string; text: string }
  | { do: "post"; text: string }
  | { do: "follow"; username: string };

/** Decides what one simulated participant does each time they look. Null is doing nothing. */
export interface Behavior {
  next: (view: View) => Promise<SimulatedAction | null> | SimulatedAction | null;
}

const COMMENTS = [
  "I agree",
  "Not sure about this",
  "haha",
  "That's not okay",
  "Love this!",
  "Why would you say that?",
  "Interesting",
  "Thanks for sharing",
  "lol",
  "Be nice",
];
const POSTS = [
  "Long day. Anyone else tired?",
  "Just finished my coffee",
  "What's everyone up to this weekend?",
  "This weather though",
  "Trying something new today",
];

/**
 * Behaves at random, within limits: some participants are quiet and some are busy, and what they
 * do is spread across liking, commenting, replying, reposting, following, posting, and flagging,
 * on things they can see. The same random numbers always give the same choices.
 */
/** Keeps world seeds apart from the participants' own random choices. */
const WORLD_SEEDS = 1_000_003;

export function randomBehavior(random: () => number): Behavior {
  const busy = pickFrom([0.1, 0.25, 0.5], random);
  return {
    next: ({ posts }) => {
      if (random() >= busy) {
        return null;
      }
      const roll = random();
      const others = posts.filter(({ author }) => !author.isViewer);
      if (roll < 0.12 || others.length === 0) {
        return { do: "post", text: pickFrom(POSTS, random) };
      }
      // Newer things are likelier to be acted on, as they're what's at the top.
      const post = others[Math.floor(random() ** 2 * others.length)] as FeedPost;
      const comments = post.comments.filter(({ author }) => !author.isViewer);
      if (roll < 0.45) {
        return { do: "like", on: post.id };
      }
      if (roll < 0.6) {
        return { do: "comment", on: post.id, text: pickFrom(COMMENTS, random) };
      }
      if (roll < 0.75 && comments.length > 0) {
        const comment = pickFrom(comments, random);
        return random() < 0.5
          ? { do: "comment", on: comment.id, text: pickFrom(COMMENTS, random) }
          : { do: "like", on: comment.id };
      }
      if (roll < 0.83) {
        return { do: "repost", on: post.id };
      }
      if (roll < 0.93) {
        return { do: "follow", username: post.author.username };
      }
      return { do: "flag", on: comments.length > 0 ? pickFrom(comments, random).id : post.id };
    },
  };
}

/**
 * When a simulated participant looks at the study: a first visit when they start, and on a study
 * of a day or more, a few more each day. Each visit has the times they look within it.
 */
export function visitTimes(settings: StudySettings, random: () => number): number[] {
  const lengthMs = settings.length.days * 24 * HOUR_MS;
  const starts = [0];
  for (let day = 0; day < Math.floor(settings.length.days); day++) {
    const extra = Math.floor(random() * 4);
    for (let i = 0; i < extra; i++) {
      starts.push(day * 24 * HOUR_MS + random() * 24 * HOUR_MS);
    }
  }
  const times: number[] = [];
  for (const start of starts.sort((a, b) => a - b)) {
    const minutes = start === 0 ? 5 + random() * 20 : 3 + random() * 12;
    let at = start;
    while (at < start + minutes * 60_000 && at < lengthMs) {
      times.push(at);
      at += (20 + random() * 160) * 1000;
    }
  }
  return times;
}

export interface SimulationSettings {
  participants: number;
  /** Where their random choices start, so a run can be repeated exactly. */
  seed: number;
  /**
   * Personas from personas.yaml, by id, for a model to play: one participant each, in this order.
   * Leave out for participants who behave at random. See ADR 60.
   */
  personas?: string[];
  /** The most the model playing personas can spend on this run, in US dollars. */
  budgetUsd?: number;
  /** Keep them as synthetic data, instead of deleting them afterwards. See ADR 60. */
  keep?: boolean;
}

export interface SimulationReport {
  participants: number;
  /** How many started in each condition. */
  conditions: Record<string, number>;
  /** How many times they did each thing, and how many of those the study refused, like a feature that's off. */
  actions: Record<string, { done: number; refused: number }>;
  beats: {
    id: string;
    /** The conditions it's in. Empty is all of them. */
    conditions: string[];
    /** For each condition they started in, how many it happened for at least once. */
    happenedFor: Record<string, number>;
    /** How many times it happened in all. */
    times: number;
    /** The most times it happened for one participant. */
    mostForOne: number;
    /** Why it was skipped, and how often. */
    skipped: Record<string, number>;
    /** How many times it was still due when they finished. */
    stillDue: number;
  }[];
  decisions: {
    id: string;
    /** How many it decided for. */
    reached: number;
    /** Where it sent them, by condition, and by group. */
    to: Record<string, number>;
    groups: Record<string, number>;
  }[];
  /** What went wrong, which is worth a look: errors from the API, not refusals. */
  problems: { text: string; count: number; participant: number }[];
  /** What the model playing personas cost, in US dollars. */
  costUsd: number;
  /** What the cast's live writing cost in their worlds, in US dollars. */
  castCostUsd: number;
  /** Why the run stopped before everyone went through, such as reaching its budget. */
  stopped: string | null;
  /** Each persona's run, in order, for a persona run. */
  transcripts: Transcript[];
}

export interface SimulateOptions {
  db: Database;
  storage: Storage;
  versionId: string;
  settings: SimulationSettings;
  /** Chooses how participant `n` behaves. Random by default, or the personas in the settings. */
  behaviorFor?: (n: number, random: () => number) => Behavior;
  /** Whether to delete each participant afterwards, as on a real server. Kept ones never are. */
  cleanUp?: boolean;
  /**
   * What plays personas, and writes the cast's improvised lines if the study writes live. Without
   * it, the cast uses rehearsed or fallback lines, and personas can't run.
   */
  writer?: Writer | null;
}

export async function simulate({
  db,
  storage,
  versionId,
  settings,
  behaviorFor,
  cleanUp = false,
  writer = null,
}: SimulateOptions): Promise<SimulationReport> {
  const [version] = await db
    .select({ settings: schema.studyVersions.settings, pages: schema.studyVersions.pages })
    .from(schema.studyVersions)
    .where(eq(schema.studyVersions.id, versionId));
  const studySettings = version?.settings as StudySettings;
  const personasText = (version?.pages as Record<string, string> | undefined)?.[PERSONAS_FILE];
  const cast = personasText ? parsePersonas(personasText).personas : null;
  const playing = (settings.personas ?? []).map((id) => {
    const persona = cast?.personas.find((item) => item.id === id);
    if (!persona) {
      throw new Error(`There's no persona "${id}" in this version.`);
    }
    return persona;
  });
  if (playing.length > 0 && !writer) {
    throw new Error("Personas need a model, and none is set up.");
  }
  const budget: Budget = { limitUsd: settings.budgetUsd ?? 2, spentUsd: 0 };
  const lengthMs = studySettings.length.days * 24 * HOUR_MS;
  const conditionKeys = (
    await db
      .select({ key: schema.conditions.key })
      .from(schema.conditions)
      // Weight 0 is a condition only a decision point sends people to.
      .where(and(eq(schema.conditions.studyVersionId, versionId), gt(schema.conditions.weight, 0)))
  ).map(({ key }) => key);
  const script = await scriptFor(db, versionId);
  // The cast writes live only when personas play, since random participants are for checking logic.
  const harness = createHarness({
    db,
    storage,
    versionId,
    writer: playing.length > 0 ? writer : null,
  });

  const report: SimulationReport = {
    participants: 0,
    conditions: Object.fromEntries(conditionKeys.map((key) => [key, 0])),
    actions: {},
    beats: script.beats.map(({ id, conditions }) => ({
      id,
      conditions: [...conditions],
      happenedFor: Object.fromEntries(conditionKeys.map((key) => [key, 0])),
      times: 0,
      mostForOne: 0,
      skipped: {},
      stillDue: 0,
    })),
    decisions: script.decide.map(({ id }) => ({ id, reached: 0, to: {}, groups: {} })),
    problems: [],
    costUsd: 0,
    castCostUsd: 0,
    stopped: null,
    transcripts: [],
  };
  const problem = (text: string, participant: number) => {
    const known = report.problems.find((item) => item.text === text);
    if (known) {
      known.count++;
    } else {
      report.problems.push({ text, count: 1, participant });
    }
  };

  const count = playing.length > 0 ? playing.length : settings.participants;
  for (let n = 0; n < count; n++) {
    const random = createRandom(settings.seed + n);
    const persona = playing[n];
    const condition = persona?.condition ?? (conditionKeys[n % conditionKeys.length] as string);
    // Kept ones finish by now, so synthetic data has no times in the future.
    const start = settings.keep ? new Date(Date.now() - lengthMs - 60_000) : new Date();
    harness.setNow(start);
    // Their world's own draws, like delays and rehearsed lines, come from the run's seed too.
    const worldSeed = Math.floor(createRandom(settings.seed + n + WORLD_SEEDS)() * 2 ** 31);
    const participant = await harness.start(condition, worldSeed);
    if (!participant) {
      problem(`They couldn't start in "${condition}".`, n);
      continue;
    }
    if (settings.keep) {
      await db
        .update(schema.participants)
        .set({ synthetic: true })
        .where(eq(schema.participants.id, participant.participantId));
    }
    report.participants++;
    report.conditions[condition] = (report.conditions[condition] ?? 0) + 1;
    const playedBy =
      persona && writer
        ? personaBehavior({
            persona,
            condition,
            features: featuresFor(studySettings, condition),
            writer,
            model: cast?.model ?? "",
            budget,
          })
        : null;
    const behavior = behaviorFor?.(n, random) ?? playedBy ?? randomBehavior(random);
    let spent = false;
    try {
      for (const at of visitTimes(studySettings, random)) {
        harness.setNow(new Date(start.getTime() + at));
        await participant.send("GET", "/me");
        const feed = await participant.send("GET", "/feed");
        if (feed.status >= 500) {
          problem("Loading the feed failed.", n);
          continue;
        }
        const posts = [...((feed.json as unknown as FeedResponse).posts ?? [])];
        // Some platforms show comments only on a post's own page, so now and then they open one.
        const closed = posts.filter((post) => post.commentCount > post.comments.length);
        if (closed.length > 0 && random() < 0.5) {
          const post = pickFrom(closed, random);
          const opened = await participant.send("GET", `/feed?surface=post&post=${post.id}`);
          const full = (opened.json as unknown as FeedResponse).posts?.[0];
          if (full) {
            posts[posts.indexOf(post)] = full;
          }
        }
        const action = await behavior.next({ at, posts });
        if (action) {
          await act(participant, action, harness.now(), report, (text) => problem(text, n));
        }
      }
    } catch (error) {
      if (error instanceof BudgetSpent) {
        spent = true;
      } else {
        problem(
          `Something went wrong: ${error instanceof Error ? error.message : String(error)}`,
          n,
        );
      }
    }
    await tally(db, participant, condition, report);
    if (playedBy) {
      report.transcripts.push(playedBy.transcript);
    }
    if (cleanUp && !settings.keep) {
      await deleteParticipant(db, storage, participant.participantId, "scenario test", "Truman");
    }
    if (spent) {
      report.stopped = `It reached its $${budget.limitUsd} budget during participant ${n + 1} of ${count}.`;
      break;
    }
  }
  report.costUsd = budget.spentUsd;
  return report;
}

async function act(
  participant: TestParticipant,
  action: SimulatedAction,
  now: Date,
  report: SimulationReport,
  problem: (text: string) => void,
) {
  const meta = { clientEventId: randomUUID(), occurredAt: now.toISOString() };
  let done: Awaited<ReturnType<TestParticipant["send"]>>;
  if (action.do === "post") {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...meta, body: action.text })) {
      form.set(key, value);
    }
    done = await participant.send("POST", "/posts", form);
  } else if (action.do === "follow") {
    done = await participant.send("POST", `/actors/${action.username}/relation`, {
      ...meta,
      action: "follow",
    });
  } else if (action.do === "upvote" || action.do === "downvote") {
    done = await participant.send("POST", `/content/${action.on}/vote`, {
      ...meta,
      value: action.do === "upvote" ? "up" : "down",
    });
  } else if (action.do === "comment") {
    done = await participant.send("POST", `/content/${action.on}/comments`, {
      ...meta,
      body: action.text,
    });
  } else {
    done = await participant.send("POST", `/content/${action.on}/${action.do}`, {
      ...meta,
      active: true,
    });
  }
  const counts = report.actions[action.do] ?? { done: 0, refused: 0 };
  report.actions[action.do] = counts;
  counts.done++;
  if (done.status >= 500) {
    problem(`A ${action.do} failed: ${String(done.json.error ?? `error ${done.status}`)}`);
  } else if (!done.ok) {
    counts.refused++;
  }
  // What they did can set beats off, as a background check would notice.
  await participant.send("GET", "/me");
}

/** Adds what happened in one participant's world to the report. */
async function tally(
  db: Database,
  participant: TestParticipant,
  condition: string,
  report: SimulationReport,
) {
  const runs = await db
    .select({
      writing: schema.beatRuns.writing,
      beat: schema.beatRuns.beat,
      status: schema.beatRuns.status,
      reason: schema.beatRuns.reason,
    })
    .from(schema.beatRuns)
    .where(eq(schema.beatRuns.worldId, participant.worldId));
  for (const { writing } of runs) {
    report.castCostUsd += Number((writing as { costUsd?: number } | null)?.costUsd ?? 0);
  }
  for (const beat of report.beats) {
    const mine = runs.filter((run) => run.beat === beat.id);
    const fired = mine.filter(({ status }) => status === "fired").length;
    if (fired > 0) {
      beat.happenedFor[condition] = (beat.happenedFor[condition] ?? 0) + 1;
    }
    beat.times += fired;
    beat.mostForOne = Math.max(beat.mostForOne, fired);
    for (const run of mine) {
      if (run.status === "skipped") {
        const reason = run.reason ?? "no reason recorded";
        beat.skipped[reason] = (beat.skipped[reason] ?? 0) + 1;
      } else if (run.status === "pending" || run.status === "awaiting") {
        beat.stillDue++;
      }
    }
  }
  const decided = await db
    .select({
      point: schema.assignments.decisionPoint,
      key: schema.conditions.key,
      details: schema.assignments.details,
    })
    .from(schema.assignments)
    .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
    .where(
      and(
        eq(schema.assignments.participantId, participant.participantId),
        isNotNull(schema.assignments.decisionPoint),
      ),
    );
  for (const row of decided) {
    const decision = report.decisions.find(({ id }) => id === row.point);
    if (!decision) {
      continue;
    }
    decision.reached++;
    decision.to[row.key] = (decision.to[row.key] ?? 0) + 1;
    const group = (row.details as { group?: string | null }).group ?? "(no group)";
    decision.groups[group] = (decision.groups[group] ?? 0) + 1;
  }
}

/** What in a report deserves a researcher's attention, in plain words. */
export function findings(report: SimulationReport): string[] {
  const notes: string[] = [];
  for (const beat of report.beats) {
    const eligible = Object.entries(report.conditions)
      .filter(([key]) => beat.conditions.length === 0 || beat.conditions.includes(key))
      .reduce((sum, [, count]) => sum + count, 0);
    if (eligible > 0 && beat.times === 0) {
      notes.push(`"${beat.id}" never happened, for any of the ${eligible} who could have had it.`);
    }
    for (const [key, count] of Object.entries(beat.happenedFor)) {
      if (count > 0 && beat.conditions.length > 0 && !beat.conditions.includes(key)) {
        notes.push(`"${beat.id}" happened in "${key}", which it isn't in.`);
      }
    }
  }
  for (const decision of report.decisions) {
    if (decision.reached === 0 && report.participants > 0) {
      notes.push(`The decision "${decision.id}" was never made.`);
    }
  }
  if (report.stopped) {
    notes.push(report.stopped);
  }
  for (const { text, count } of report.problems) {
    notes.push(`${text}${count > 1 ? ` (${count} times)` : ""}`);
  }
  return notes;
}
