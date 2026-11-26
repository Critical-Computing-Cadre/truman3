import { featuresFor, type LiveCommunity, type StudySettings, TEMPLATES } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { ALWAYS_OFF_LIMITS, type Writer } from "@truman3/writer";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { whyNoModel, writerFor } from "../ai.ts";
import { scriptFor } from "../director/director.ts";
import { spentOn } from "../director/wording.ts";
import {
  communitySystem,
  dayPrompt,
  earlierLine,
  type WrittenPost,
  writeCheckedDay,
} from "./write.ts";

// A community written while the study runs (ADR 102): one for each condition, or one for all of
// them, a day ahead of whoever is furthest along. Its posts are ordinary scripted content, timed
// from each participant's arrival, so everyone in a condition sees the same thing at the same point
// in their own study.

const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
/** A day not heard from in this long was being written by a server that died, and is taken over. */
const STALE_MS = 20 * MINUTE;
/** How long a day that failed waits before it's tried again. */
const RETRY_MS = 10 * MINUTE;

/** Which community a condition gets: its own, or the one everyone shares, which is "". */
export const communityOf = (community: LiveCommunity, conditionKey: string) =>
  community.conditions.mode === "each" ? conditionKey : "";

/** How far each community is known to be written, so most loads ask the database nothing. */
const settled = new Map<string, number>();
const working = new Map<string, Promise<void>>();

/** Forgets what's known, for tests that start again. */
export function forgetCommunities() {
  settled.clear();
}

type DayRow = typeof schema.communityDays.$inferSelect;

async function versionOf(db: Database, studyVersionId: string) {
  const [row] = await db
    .select({
      settings: schema.studyVersions.settings,
      livePaused: schema.studies.livePaused,
    })
    .from(schema.studyVersions)
    .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
    .where(eq(schema.studyVersions.id, studyVersionId));
  return row ? { settings: row.settings as StudySettings, livePaused: row.livePaused } : null;
}

/** Why nothing more is being written now, or null if it can be. */
export async function whyNotWriting(
  db: Database,
  writer: Writer | null | undefined,
  studyVersionId: string,
): Promise<string | null> {
  const script = await scriptFor(db, studyVersionId);
  const version = await versionOf(db, studyVersionId);
  if (!script.community?.live || !version) {
    return "It isn't turned on for this version.";
  }
  if (version.livePaused) {
    return "Live writing is paused for this study.";
  }
  if ((await spentOn(db, studyVersionId)) >= script.live.budgetUsd) {
    return `The study's budget of $${script.live.budgetUsd} is used up.`;
  }
  // No key here, or the lab's starter budget is used up (ADR 71).
  return whyNoModel(writer, { studyVersionId });
}

/** The reference a post has in every world it's copied into. */
export const postRef = (day: Pick<DayRow, "condition" | "day">, index: number) =>
  `live-${day.condition || "all"}-d${day.day}-p${index}`;

/**
 * Lets participants see a day. Only a day that's being written or held can be published, and only
 * once. Its posts reach each participant's world as they get to that day.
 */
export async function publishDay(db: Database, dayId: string, decidedBy?: string) {
  const [published] = await db
    .update(schema.communityDays)
    .set({
      status: "published",
      publishedAt: new Date(),
      ...(decidedBy ? { decidedBy } : {}),
    })
    .where(
      and(
        eq(schema.communityDays.id, dayId),
        inArray(schema.communityDays.status, ["writing", "held"]),
      ),
    )
    .returning({ id: schema.communityDays.id });
  return Boolean(published);
}

/**
 * Copies into a participant's world the published days they've reached and don't have yet. A saved
 * version never changes, so what's written while a study runs lives in worlds, like everything
 * else that happens during one. Each post is timed from when the participant arrived.
 */
async function bringIntoWorld(
  db: Database,
  context: { studyVersionId: string; worldId: string; worldStartedAt: Date },
  condition: string,
  reached: number,
) {
  const due = await db
    .select({ day: schema.communityDays })
    .from(schema.communityDays)
    .leftJoin(
      schema.communityDayWorlds,
      and(
        eq(schema.communityDayWorlds.dayId, schema.communityDays.id),
        eq(schema.communityDayWorlds.worldId, context.worldId),
      ),
    )
    .where(
      and(
        eq(schema.communityDays.studyVersionId, context.studyVersionId),
        eq(schema.communityDays.condition, condition),
        eq(schema.communityDays.status, "published"),
        lte(schema.communityDays.day, reached),
        isNull(schema.communityDayWorlds.dayId),
      ),
    );
  if (due.length === 0) {
    return;
  }
  const actors = await db
    .select({ id: schema.actors.id, username: schema.actors.username })
    .from(schema.actors)
    .where(
      and(eq(schema.actors.studyVersionId, context.studyVersionId), isNull(schema.actors.worldId)),
    );
  const idOf = new Map(actors.map(({ id, username }) => [username, id]));
  for (const { day } of due) {
    await db.transaction(async (tx) => {
      // Whoever records the day for this world copies it. A second load at once finds it there.
      const [mine] = await tx
        .insert(schema.communityDayWorlds)
        .values({ dayId: day.id, worldId: context.worldId })
        .onConflictDoNothing()
        .returning({ dayId: schema.communityDayWorlds.dayId });
      if (!mine) {
        return;
      }
      const provenance = {
        origin: "generated",
        detail: { by: "community", live: true, day: day.id, model: day.model },
      };
      const start = context.worldStartedAt.getTime() + day.day * DAY;
      for (const [index, post] of (day.written as WrittenPost[]).entries()) {
        const author = idOf.get(post.actor);
        if (!author || day.removed.includes(index)) {
          continue;
        }
        const at = start + post.minute * MINUTE;
        const [made] = await tx
          .insert(schema.content)
          .values({
            studyVersionId: context.studyVersionId,
            worldId: context.worldId,
            authorActorId: author,
            kind: "post",
            title: post.title || null,
            body: post.body,
            visibleAt: new Date(at),
            baseLikes: post.likes,
            provenance,
            sourceRef: postRef(day, index),
          })
          .returning({ id: schema.content.id });
        if (!made) {
          continue;
        }
        const replyIds: (string | undefined)[] = [];
        for (const [r, reply] of post.replies.entries()) {
          const replier = idOf.get(reply.actor);
          const parent = reply.replyTo === null ? made.id : replyIds[reply.replyTo];
          if (!replier || !parent) {
            replyIds.push(undefined);
            continue;
          }
          const [comment] = await tx
            .insert(schema.content)
            .values({
              studyVersionId: context.studyVersionId,
              worldId: context.worldId,
              authorActorId: replier,
              parentId: parent,
              kind: "comment",
              body: reply.body,
              visibleAt: new Date(at + reply.minutesAfter * MINUTE),
              provenance,
              sourceRef: `${postRef(day, index)}-r${r}`,
            })
            .returning({ id: schema.content.id });
          replyIds.push(comment?.id);
        }
      }
    });
  }
}

async function writeDays(
  db: Database,
  writer: Writer | null | undefined,
  studyVersionId: string,
  condition: string,
  upTo: number,
) {
  const script = await scriptFor(db, studyVersionId);
  const community = script.community;
  if (!community?.live) {
    return;
  }
  const key = `${studyVersionId}:${condition}`;
  const last = Math.min(upTo, community.daysDuring - 1);
  for (;;) {
    const rows = await db
      .select()
      .from(schema.communityDays)
      .where(
        and(
          eq(schema.communityDays.studyVersionId, studyVersionId),
          eq(schema.communityDays.condition, condition),
        ),
      );
    const byDay = new Map(rows.map((row) => [row.day, row]));
    // Days are written in order, since each carries on from the last.
    let next: number | undefined;
    let again: DayRow | undefined;
    for (let day = -community.daysBefore; day <= last; day++) {
      const row = byDay.get(day);
      if (!row) {
        next = day;
        break;
      }
      if (row.status === "writing" || row.status === "error") {
        const since = Date.now() - (row.finishedAt ?? row.startedAt).getTime();
        if (since < (row.status === "writing" ? STALE_MS : RETRY_MS)) {
          return;
        }
        next = day;
        again = row;
        break;
      }
    }
    if (next === undefined) {
      settled.set(key, Math.max(settled.get(key) ?? Number.NEGATIVE_INFINITY, last));
      return;
    }
    if ((await whyNotWriting(db, writer, studyVersionId)) !== null) {
      return;
    }
    const version = await versionOf(db, studyVersionId);
    const model = await writerFor(writer, { studyVersionId });
    if (!version || !model) {
      return;
    }
    // Whoever makes the row writes the day. Anyone else finds it there and leaves it.
    const [mine] = again
      ? await db
          .update(schema.communityDays)
          .set({ status: "writing", startedAt: new Date(), finishedAt: null, error: null })
          .where(
            and(
              eq(schema.communityDays.id, again.id),
              eq(schema.communityDays.status, again.status),
              eq(schema.communityDays.startedAt, again.startedAt),
            ),
          )
          .returning()
      : await db
          .insert(schema.communityDays)
          .values({ studyVersionId, condition, day: next, status: "writing" })
          .onConflictDoNothing()
          .returning();
    if (!mine) {
      return;
    }
    try {
      const { settings } = version;
      const arms = settings.conditions.arms.map(({ key: arm }) => arm);
      const actors = await db
        .select({ username: schema.actors.username, profile: schema.actors.profile })
        .from(schema.actors)
        .where(
          and(eq(schema.actors.studyVersionId, studyVersionId), isNull(schema.actors.worldId)),
        );
      const cast = actors
        .filter(({ username }) => community.cast.length === 0 || community.cast.includes(username))
        .map(({ username, profile }) => {
          const { name, bio } = profile as { name?: string; bio?: string };
          return { username, name: name ?? username, bio: bio ?? "" };
        });
      if (cast.length < 2) {
        throw new Error("A community needs at least two people in the cast.");
      }
      const titles = (condition ? [condition] : arms).some(
        (arm) => featuresFor(settings, arm).titles,
      );
      const maxLength = settings.platform.maxPostLength ?? 1000;
      const limits = [...ALWAYS_OFF_LIMITS, ...script.live.redLines, ...community.neverSay];
      const earlier = rows
        .filter(({ day, status }) => day < next && (status === "published" || status === "held"))
        .sort((a, b) => a.day - b.day)
        .flatMap(({ written }) =>
          [...(written as WrittenPost[])].sort((a, b) => a.minute - b.minute).map(earlierLine),
        );
      const written = await writeCheckedDay(model, {
        modelName: script.live.model,
        system: communitySystem({
          site: TEMPLATES[settings.platform.template ?? "classic"].about,
          brief: community,
          inThisVersion:
            community.conditions.mode === "each"
              ? (community.conditions.about[condition] ?? "")
              : "",
          cast,
          personas: script.cast,
          maxLength,
          titles,
          limits,
        }),
        prompt: dayPrompt(community, next, earlier),
        cast: cast.map(({ username }) => username),
        maxLength,
        titles,
        limits,
      });
      const [day] = await db
        .update(schema.communityDays)
        .set({
          written: written.posts,
          dropped: written.dropped,
          model: written.model,
          costUsd: written.costUsd,
          finishedAt: new Date(),
          ...(community.hold ? { status: "held" as const } : {}),
        })
        .where(eq(schema.communityDays.id, mine.id))
        .returning();
      if (day && !community.hold) {
        await publishDay(db, day.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      console.error("A day of a live community failed:", message);
      await db
        .update(schema.communityDays)
        .set({ status: "error", error: message, finishedAt: new Date() })
        .where(eq(schema.communityDays.id, mine.id));
      return;
    }
  }
}

/**
 * Makes sure a community is written through a day, writing what's missing. One piece of work at a
 * time for each community on this server, and the database keeps servers off each other's days.
 * It never throws: a community that can't be written goes quiet.
 */
export function writeCommunityThrough(
  db: Database,
  writer: Writer | null | undefined,
  studyVersionId: string,
  condition: string,
  upTo: number,
): Promise<void> {
  const key = `${studyVersionId}:${condition}`;
  if ((settled.get(key) ?? Number.NEGATIVE_INFINITY) >= upTo) {
    return Promise.resolve();
  }
  const already = working.get(key);
  if (already) {
    return already;
  }
  const work = writeDays(db, writer, studyVersionId, condition, upTo)
    .catch((error) => console.error("A live community couldn't be written:", error))
    .finally(() => working.delete(key));
  working.set(key, work);
  return work;
}

/**
 * Called as a participant loads their feed: the days they've reached are put into their world, and
 * the community for their condition is kept a day ahead of them. Writing doesn't hold up the feed.
 */
export async function keepCommunityAhead(
  db: Database,
  writer: Writer | null | undefined,
  context: {
    studyVersionId: string;
    worldId: string;
    conditionKey: string;
    worldStartedAt: Date;
    worldMode: "solo" | "shared";
  },
  now: Date,
) {
  // Shared worlds aren't covered yet.
  if (context.worldMode !== "solo") {
    return;
  }
  const script = await scriptFor(db, context.studyVersionId);
  if (!script.community?.live) {
    return;
  }
  const condition = communityOf(script.community, context.conditionKey);
  const day = Math.max(0, Math.floor((now.getTime() - context.worldStartedAt.getTime()) / DAY));
  await bringIntoWorld(db, context, condition, day);
  void writeCommunityThrough(
    db,
    writer,
    context.studyVersionId,
    condition,
    Math.min(day + 1, script.community.daysDuring - 1),
  );
}

/** Called at launch: the days before anyone arrives, and their first day, for every community. */
export async function startCommunity(
  db: Database,
  writer: Writer | null | undefined,
  studyVersionId: string,
) {
  const script = await scriptFor(db, studyVersionId);
  const version = await versionOf(db, studyVersionId);
  if (!script.community?.live || !version) {
    return;
  }
  const conditions =
    script.community.conditions.mode === "each"
      ? version.settings.conditions.arms.map(({ key }) => key)
      : [""];
  for (const condition of conditions) {
    await writeCommunityThrough(db, writer, studyVersionId, condition, 0);
  }
}
