import type { BeatDefinition, BeatsFile, Persona } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { ALWAYS_OFF_LIMITS, NothingWritten, type Writer } from "@truman3/writer";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { ParticipantContext } from "../participants/session.ts";

/**
 * How a beat's words are chosen, and the record of it in `beat_runs.writing`. Fixed text is used as
 * it is. An improvised line is written live by the actor's model only when everything allows it:
 * the study turned live writing on, the server has a model, nobody paused it, the budget has room,
 * and the line passes its check. Otherwise the beat's fallback line is used, and the record says
 * why. See ADR 52.
 */

export interface Writing {
  mode: "live" | "fallback";
  /** Why the fallback was used. */
  reason?: string;
  model?: string;
  prompt?: { system: string; user: string };
  /** What the model wrote, even if the check stopped it. */
  output?: string;
  check?: { allowed: boolean; reason: string };
  costUsd: number;
}

type Script = Pick<BeatsFile, "live" | "cast">;
type Wording = Extract<BeatDefinition["do"], { action: "post" | "comment" }>;

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
    "You write posts and comments for one person on a social media platform, in a research study. The study's script decides what happens; you decide only the wording, in this person's voice.",
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

  parts.push(
    `${action.action === "post" ? "Write a new post." : "Write a comment."} What happens: ${action.improvise}`,
  );
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
): Promise<{ text: string; writing: Writing | null }> {
  if (action.text !== undefined) {
    return { text: action.text, writing: null };
  }
  const fallback = (reason: string, extra: Partial<Writing> = {}) => ({
    text: action.fallback as string,
    writing: { mode: "fallback" as const, reason, costUsd: 0, ...extra },
  });
  if (!script.live.enabled) {
    return fallback("live writing is off for this study");
  }
  if (!writer) {
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
  let written: Awaited<ReturnType<Writer["write"]>>;
  try {
    written = await writer.write({
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
    checked = await writer.check(written.text, limits, script.live.model);
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
