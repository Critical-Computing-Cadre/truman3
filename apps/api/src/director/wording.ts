import { createHash } from "node:crypto";
import type { BeatDefinition, BeatsFile, Persona } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { ALWAYS_OFF_LIMITS, NothingWritten, type Writer } from "@truman3/writer";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { writerFor } from "../ai.ts";
import type { ParticipantContext } from "../participants/session.ts";

/**
 * How a beat's words are chosen, and the record of it in `beat_runs.writing`. Fixed text is used as
 * it is. An improvised line is written live by the actor's model only when everything allows it:
 * the study turned live writing on, the server has a model, nobody paused it, the budget has room,
 * and the line passes its check. Otherwise the beat's fallback line is used, and the record says
 * why. See ADR 52.
 */

export interface Writing {
  /** Written by a model, a rehearsed line, the fallback line, or a beat's fixed text. */
  mode: "live" | "rehearsed" | "fallback" | "fixed";
  /** For a rehearsed line, which one, from 0. */
  choice?: number;
  /** For a line a model wrote when it could have picked a rehearsed one: it didn't fit. */
  strayed?: boolean;
  /** Why the fallback was used. */
  reason?: string;
  model?: string;
  prompt?: { system: string; user: string };
  /** What the model wrote, even if the check stopped it. */
  output?: string;
  check?: { allowed: boolean; reason: string };
  costUsd: number;
  /** For a beat that waits for approval: the line suggested to the researcher. */
  draft?: string | null;
  /** Who approved or skipped it. */
  decidedBy?: string;
  /** Whether they changed the line, and what it became. */
  edited?: boolean;
  final?: string;
}

type Script = Pick<BeatsFile, "live" | "cast">;
export type Wording = Extract<BeatDefinition["do"], { action: "post" | "comment" | "message" }>;

/** Whether a beat's action has words: a post, a comment, or a message. */
export function saysSomething(action: BeatDefinition["do"]): action is Wording {
  return action.action === "post" || action.action === "comment" || action.action === "message";
}

/** What the model is asked to write, for each kind of action with words. */
const ASK = {
  post: "Write a new post.",
  comment: "Write a comment.",
  message: "Write a direct message to the participant.",
} as const;
const ASKED = {
  post: "A new post.",
  comment: "A comment.",
  message: "A direct message to the participant.",
} as const;
const SYSTEM =
  "You write posts, comments, and direct messages for one person on a social media platform, in a research study. The study's script decides what happens; you decide only the wording, in this person's voice.";

interface Profile {
  name?: string;
  bio?: string;
}

/** What a study has spent on writing, across everyone in it. */
export async function spentOn(db: Database, studyVersionId: string) {
  const [row] = await db
    .select({
      spent: sql<string | null>`sum((${schema.beatRuns.writing}->>'costUsd')::numeric)`,
    })
    .from(schema.beatRuns)
    .innerJoin(schema.worlds, eq(schema.worlds.id, schema.beatRuns.worldId))
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
    .where(
      eq(
        schema.studyVersions.studyId,
        sql`(select ${schema.studyVersions.studyId} from ${schema.studyVersions} where ${schema.studyVersions.id} = ${studyVersionId})`,
      ),
    );
  return Number(row?.spent ?? 0);
}

/** The study's kill switches. */
async function controlsFor(db: Database, studyVersionId: string) {
  const [row] = await db
    .select({ livePaused: schema.studies.livePaused, pausedActors: schema.studies.pausedActors })
    .from(schema.studies)
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.studyId, schema.studies.id))
    .where(eq(schema.studyVersions.id, studyVersionId));
  return row ?? { livePaused: false, pausedActors: [] };
}

/** Whether choosing this beat's words could call a model, so a page load shouldn't wait for it. */
export function mightWrite(script: Script, beat: BeatDefinition, writer: Writer | null) {
  return (
    Boolean(writer) && script.live.enabled && "improvise" in beat.do && Boolean(beat.do.improvise)
  );
}

function personaLines(name: string, username: string, persona: Persona | undefined) {
  return [
    `You are ${name} (@${username}).`,
    persona?.about && `About you: ${persona.about}`,
    persona?.voice && `How you write: ${persona.voice}`,
    persona?.values && `What you care about: ${persona.values}`,
    persona?.goals && `What you want: ${persona.goals}`,
  ].filter(Boolean) as string[];
}

/** What the actor sees: what they're answering and the thread it's in, and what they've said. */
async function promptFor(
  db: Database,
  context: ParticipantContext,
  script: Script,
  action: Wording,
  actorId: string,
  targetId: string | null,
) {
  const people = await db
    .select({
      id: schema.actors.id,
      username: schema.actors.username,
      profile: schema.actors.profile,
    })
    .from(schema.actors)
    .where(
      sql`${schema.actors.studyVersionId} = ${context.studyVersionId} and (${schema.actors.worldId} is null or ${schema.actors.worldId} = ${context.worldId})`,
    );
  const who = (id: string) => {
    const person = people.find((row) => row.id === id);
    const name = (person?.profile as Profile | undefined)?.name ?? person?.username ?? "someone";
    return id === context.actorId ? `${name} (the participant)` : name;
  };
  const me = people.find((row) => row.id === actorId);
  const persona = script.cast[action.actor];
  const name = (me?.profile as Profile | undefined)?.name ?? action.actor;

  const limits = [...ALWAYS_OFF_LIMITS, ...script.live.redLines, ...(persona?.redLines ?? [])];
  const system = [
    SYSTEM,
    ...personaLines(name, action.actor, persona),
    `Write only the ${action.action} itself: no quotation marks, no name, no explanation. Keep it under ${script.live.maxLength} characters, and write it the way people write on social media.`,
    `Never write any of these:\n${limits.map((limit) => `- ${limit}`).join("\n")}`,
  ].join("\n\n");

  const parts: string[] = [];
  const relationships = Object.entries(persona?.relationships ?? {});
  if (relationships.length > 0) {
    parts.push(
      `How you feel about people here:\n${relationships
        .map(([username, feeling]) => {
          const person =
            username === "participant"
              ? context.actorId
              : people.find((row) => row.username === username)?.id;
          return `- ${person ? who(person) : username}: ${feeling}`;
        })
        .join("\n")}`,
    );
  }

  const said = await db
    .select({ body: schema.content.body })
    .from(schema.content)
    .where(
      and(eq(schema.content.worldId, context.worldId), eq(schema.content.authorActorId, actorId)),
    )
    .orderBy(desc(schema.content.visibleAt))
    .limit(5);
  if (said.length > 0) {
    parts.push(
      `What you've already said here, newest first:\n${said.map(({ body }) => `- ${body}`).join("\n")}`,
    );
  }

  if (targetId) {
    const [target] = await db.select().from(schema.content).where(eq(schema.content.id, targetId));
    let post = target;
    while (post?.parentId) {
      [post] = await db.select().from(schema.content).where(eq(schema.content.id, post.parentId));
    }
    if (post && target) {
      const comments = await db
        .select()
        .from(schema.content)
        .where(eq(schema.content.parentId, post.id))
        .orderBy(asc(schema.content.visibleAt))
        .limit(10);
      parts.push(
        [
          `The post, by ${who(post.authorActorId)}:${post.title ? `\n${post.title}` : ""}\n${post.body}`,
          ...comments.map((comment) => `Comment by ${who(comment.authorActorId)}: ${comment.body}`),
        ].join("\n\n"),
      );
      if (target.id !== post.id) {
        parts.push(
          `You're replying to this comment by ${who(target.authorActorId)}:\n${target.body}`,
        );
      }
    }
  }

  if (action.action === "message") {
    // Their conversation so far, which nobody else can see.
    const conversation = await db
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.worldId, context.worldId),
          eq(schema.content.kind, "message"),
          sql`(${schema.content.authorActorId} = ${actorId} and ${schema.content.recipientActorId} = ${context.actorId})
            or (${schema.content.authorActorId} = ${context.actorId} and ${schema.content.recipientActorId} = ${actorId})`,
        ),
      )
      .orderBy(desc(schema.content.visibleAt))
      .limit(20);
    parts.push(
      conversation.length === 0
        ? `You haven't messaged ${who(context.actorId)} before.`
        : `Your direct messages with ${who(context.actorId)}, oldest first:\n${conversation
            .reverse()
            .map((message) => `${who(message.authorActorId)}: ${message.body}`)
            .join("\n")}`,
    );
  }

  parts.push(`${ASK[action.action]} What happens: ${action.improvise}`);
  return { system, user: parts.join("\n\n"), limits };
}

/** The words for a post or comment beat, and how they were chosen. */
export async function chooseWords(
  db: Database,
  context: ParticipantContext,
  script: Script,
  action: Wording,
  actorId: string,
  targetId: string | null,
  writer: Writer | null,
  /** What makes this run's pick of a rehearsed line its own, such as the beat and run. */
  salt = "",
): Promise<{ text: string; writing: Writing | null }> {
  if (action.text !== undefined) {
    return { text: action.text, writing: null };
  }
  const rehearsed = action.lines ?? [];
  /**
   * When live writing can't be used: a rehearsed line, drawn the same way each time for this
   * world, if there are any, or else the fallback line.
   */
  const fallback = (reason: string, extra: Partial<Writing> = {}) => {
    if (rehearsed.length > 0) {
      const hash = createHash("sha256").update(`${context.seed}:${salt}`).digest();
      const choice = hash.readUInt32BE(0) % rehearsed.length;
      return {
        text: rehearsed[choice] as string,
        writing: {
          mode: "rehearsed" as const,
          reason,
          choice,
          costUsd: 0,
          ...extra,
          output: rehearsed[choice] as string,
        },
      };
    }
    return {
      text: action.fallback as string,
      writing: { mode: "fallback" as const, reason, costUsd: 0, ...extra },
    };
  };
  if (!script.live.enabled) {
    return fallback("live writing is off for this study");
  }
  // The study's lab's key, or the host's within its starter budget (ADR 71).
  const model = await writerFor(writer, { studyVersionId: context.studyVersionId });
  if (!model) {
    return fallback("this server has no model set up");
  }
  const controls = await controlsFor(db, context.studyVersionId);
  if (controls.livePaused) {
    return fallback("live writing is paused for this study");
  }
  if (controls.pausedActors.includes(action.actor)) {
    return fallback(`live writing is paused for ${action.actor}`);
  }
  const spent = await spentOn(db, context.studyVersionId);
  if (spent >= script.live.budgetUsd) {
    return fallback(`the study's budget of $${script.live.budgetUsd} is used up`);
  }

  const { system, user, limits } = await promptFor(db, context, script, action, actorId, targetId);
  const prompt = { system, user };
  const request = {
    model: script.live.model,
    system,
    prompt: user,
    maxLength: script.live.maxLength,
  };

  // With rehearsed lines, the model picks the one that fits, and only writes its own if allowed.
  if (rehearsed.length > 0 && script.live.stray !== "always") {
    let chosen: Awaited<ReturnType<Writer["choose"]>>;
    try {
      chosen = await model.choose({
        ...request,
        lines: rehearsed,
        allowNew: script.live.stray === "choose",
      });
    } catch (error) {
      const why = error instanceof NothingWritten ? error.message : "the model couldn't be reached";
      return fallback(why, { model: script.live.model, prompt });
    }
    if (chosen.choice !== null) {
      return {
        text: chosen.text,
        writing: {
          mode: "rehearsed",
          choice: chosen.choice,
          model: chosen.model,
          prompt,
          output: chosen.text,
          costUsd: chosen.costUsd,
        },
      };
    }
    // None fitted, so it wrote its own, which is checked like any other.
    const checked = await model.check(chosen.text, limits, script.live.model).catch(() => null);
    const costUsd = chosen.costUsd + (checked?.costUsd ?? 0);
    if (!checked?.allowed) {
      return fallback(
        checked ? `the check stopped it: ${checked.reason}` : "the check couldn't be run",
        {
          model: chosen.model,
          prompt,
          output: chosen.text,
          strayed: true,
          costUsd,
          ...(checked ? { check: { allowed: false, reason: checked.reason } } : {}),
        },
      );
    }
    return {
      text: chosen.text,
      writing: {
        mode: "live",
        strayed: true,
        model: chosen.model,
        prompt,
        output: chosen.text,
        check: { allowed: true, reason: checked.reason },
        costUsd,
      },
    };
  }
  let written: Awaited<ReturnType<Writer["write"]>>;
  try {
    written = await model.write({
      model: script.live.model,
      system,
      prompt: user,
      maxLength: script.live.maxLength,
    });
  } catch (error) {
    const why = error instanceof NothingWritten ? error.message : "the model couldn't be reached";
    return fallback(why, { model: script.live.model, prompt });
  }
  let checked: Awaited<ReturnType<Writer["check"]>>;
  try {
    checked = await model.check(written.text, limits, script.live.model);
  } catch {
    return fallback("the check couldn't be run", {
      model: written.model,
      prompt,
      output: written.text,
      costUsd: written.costUsd,
    });
  }
  const costUsd = written.costUsd + checked.costUsd;
  if (!checked.allowed) {
    return fallback(`the check stopped it: ${checked.reason}`, {
      model: written.model,
      prompt,
      output: written.text,
      check: { allowed: false, reason: checked.reason },
      costUsd,
    });
  }
  return {
    text: written.text,
    writing: {
      mode: "live",
      model: written.model,
      prompt,
      output: written.text,
      check: { allowed: true, reason: checked.reason },
      costUsd,
    },
  };
}

/**
 * What a model is told to rehearse a beat's line before launch: who the actor is and what the beat
 * asks for. Nobody has taken part yet, so there's no thread or memory to show it.
 */
export function rehearsalPrompt(
  script: Script,
  action: Wording,
  name: string,
): { system: string; user: string } {
  const persona = script.cast[action.actor];
  const limits = [...ALWAYS_OFF_LIMITS, ...script.live.redLines, ...(persona?.redLines ?? [])];
  const system = [
    SYSTEM,
    ...personaLines(name, action.actor, persona),
    `Each line is only the ${action.action} itself: no quotation marks, no name, no explanation. Keep each under ${script.live.maxLength} characters, and write them the way people write on social media.`,
    `Never write any of these:\n${limits.map((limit) => `- ${limit}`).join("\n")}`,
  ].join("\n\n");
  const relationships = Object.entries(persona?.relationships ?? {});
  const user = [
    relationships.length > 0 &&
      `How you feel about people here:\n${relationships
        .map(
          ([username, feeling]) =>
            `- ${username === "participant" ? "the participant" : username}: ${feeling}`,
        )
        .join("\n")}`,
    `${ASKED[action.action]} What happens: ${action.improvise}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user };
}
