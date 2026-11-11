import { type Database, schema } from "@truman3/db";
import type { Writer } from "@truman3/writer";
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { SHOWN_TO_PARTICIPANTS } from "./actions/notifications.ts";
import { catchUp } from "./director/director.ts";
import { type ParticipantContext, participantFromRequest } from "./participants/session.ts";

/**
 * Live updates in shared worlds (ADR 68). A participant's page listens with server-sent events,
 * and is told when something new is there for them: a post or comment from someone else, a
 * notification, or a message. The page then fetches it as usual. What it's told says only what
 * kind of thing changed, never what it says.
 *
 * Every two seconds, each copy of the API looks at the worlds of the people listening to it:
 * - it catches each one up, so the cast's beats happen on time even when nobody loads a page
 * - then it looks for what has newly come due in them, in one query each for content, notifications,
 *   and the study's own posts.
 *
 * Looking in the database, rather than being told by whatever wrote it, means it also finds what
 * was written earlier to appear later, like a reaction due in two minutes, and what another copy
 * of the API wrote.
 */

/** What a page is told. */
export type LiveEvent =
  /**
   * Something new to see. `posts` is true when it's a new post, not just a comment. `removed` is true
   * when a moderator took something down or put it back, which should leave every page at once.
   */
  | { type: "feed"; posts: boolean; removed?: true }
  | { type: "notifications" }
  | { type: "messages" };

interface Listener {
  context: ParticipantContext;
  send: (event: LiveEvent) => void;
}

/** How far back each look goes, so a row whose time was set just before it was saved is found. */
const OVERLAP_MS = 10_000;

export function createLive({ db, writer }: { db: Database; writer: Writer | null }) {
  const listeners = new Map<string, Set<Listener>>();
  /** When each world was last looked at. A world starts being looked at when someone listens. */
  const looked = new Map<string, number>();
  /**
   * What each world was already told about, by id, with when it was due, so each is told once
   * although the looks overlap. Forgotten once it's too old to be looked at again.
   */
  const told = new Map<string, Map<string, number>>();

  function listen(context: ParticipantContext, send: Listener["send"]) {
    const listener = { context, send };
    const world = listeners.get(context.worldId) ?? new Set();
    world.add(listener);
    listeners.set(context.worldId, world);
    return () => {
      world.delete(listener);
      if (world.size === 0) {
        listeners.delete(context.worldId);
        looked.delete(context.worldId);
        told.delete(context.worldId);
      }
    };
  }

  async function tick(now: Date) {
    const worldIds = [...listeners.keys()];
    if (worldIds.length === 0) {
      return;
    }
    const fromOf = new Map(
      worldIds.map((worldId) => [worldId, (looked.get(worldId) ?? now.getTime()) - OVERLAP_MS]),
    );
    const earliest = new Date(Math.min(...fromOf.values()));
    for (const worldId of worldIds) {
      looked.set(worldId, now.getTime());
    }
    /** Whether something due at `at` in this world is in its window and new, remembering it. */
    const fresh = (worldId: string, id: string, at: number) => {
      const from = fromOf.get(worldId) ?? 0;
      const seen = told.get(worldId) ?? new Map<string, number>();
      told.set(worldId, seen);
      if (at <= from || seen.has(id)) {
        return false;
      }
      seen.set(id, at);
      return true;
    };
    /** What each listener will be told, by kind, so each kind is told once a look. */
    const pending = new Map<Listener, Map<string, LiveEvent>>();
    const tell = (worldId: string, events: (listener: Listener) => LiveEvent[]) => {
      for (const listener of listeners.get(worldId) ?? []) {
        for (const event of events(listener)) {
          const theirs = pending.get(listener) ?? new Map<string, LiveEvent>();
          pending.set(listener, theirs);
          const before = theirs.get(event.type);
          if (event.type === "feed" && before?.type === "feed") {
            const removed = event.removed || before.removed;
            theirs.set("feed", {
              type: "feed",
              posts: event.posts || before.posts,
              ...(removed ? { removed } : {}),
            });
          } else {
            theirs.set(event.type, event);
          }
        }
      }
    };

    // What the cast does on its own time, as if someone had loaded a page.
    for (const worldId of worldIds) {
      const [first] = listeners.get(worldId) ?? [];
      if (first) {
        await catchUp(db, first.context, { writer, mayWrite: true, now });
      }
    }

    const content = await db
      .select({
        id: schema.content.id,
        worldId: schema.content.worldId,
        kind: schema.content.kind,
        authorActorId: schema.content.authorActorId,
        recipientActorId: schema.content.recipientActorId,
        visibleAt: schema.content.visibleAt,
      })
      .from(schema.content)
      .where(
        and(
          inArray(schema.content.worldId, worldIds),
          gt(schema.content.visibleAt, earliest),
          lte(schema.content.visibleAt, now),
          isNull(schema.content.withdrawnAt),
        ),
      );
    for (const row of content) {
      if (!row.worldId || !row.visibleAt || !fresh(row.worldId, row.id, row.visibleAt.getTime())) {
        continue;
      }
      tell(row.worldId, ({ context }) => {
        if (row.authorActorId === context.actorId) {
          return [];
        }
        if (row.kind === "message") {
          return row.recipientActorId === context.actorId ? [{ type: "messages" }] : [];
        }
        return [{ type: "feed", posts: row.kind === "post" }];
      });
    }

    const notifications = await db
      .select({
        id: schema.notifications.id,
        worldId: schema.notifications.worldId,
        type: schema.notifications.type,
        recipientActorId: schema.notifications.recipientActorId,
        dueAt: schema.notifications.dueAt,
      })
      .from(schema.notifications)
      .where(
        and(
          inArray(schema.notifications.worldId, worldIds),
          gt(schema.notifications.dueAt, earliest),
          lte(schema.notifications.dueAt, now),
        ),
      );
    for (const row of notifications) {
      if (!fresh(row.worldId, row.id, row.dueAt.getTime())) {
        continue;
      }
      tell(row.worldId, ({ context }) => {
        const events: LiveEvent[] = [];
        // Moderation changes what everyone sees.
        if (["remove", "restore", "label"].includes(row.type)) {
          events.push({ type: "feed", posts: false, removed: true });
        }
        if (
          row.recipientActorId === context.actorId &&
          (SHOWN_TO_PARTICIPANTS as readonly string[]).includes(row.type)
        ) {
          events.push({ type: "notifications" });
        }
        return events;
      });
    }

    // The study's own posts, which appear at a time from each world's start.
    for (const worldId of worldIds) {
      const [first] = listeners.get(worldId) ?? [];
      if (!first) {
        continue;
      }
      const start = first.context.worldStartedAt.getTime();
      const due = await db
        .select({
          id: schema.content.id,
          offsetMs: schema.content.offsetMs,
          conditions: schema.content.conditions,
        })
        .from(schema.content)
        .where(
          and(
            isNull(schema.content.worldId),
            eq(schema.content.studyVersionId, first.context.studyVersionId),
            gt(schema.content.offsetMs, (fromOf.get(worldId) ?? 0) - start),
            lte(schema.content.offsetMs, now.getTime() - start),
          ),
        );
      // Everyone in a shared world is in its condition, so the first listener's is everyone's.
      const { conditionKey } = first.context;
      const shown = due.filter(
        ({ id, offsetMs, conditions }) =>
          (conditions.length === 0 || conditions.includes(conditionKey)) &&
          fresh(worldId, id, start + (offsetMs ?? 0)),
      );
      if (shown.length > 0) {
        tell(worldId, () => [{ type: "feed", posts: true }]);
      }
    }

    for (const [listener, events] of pending) {
      for (const event of events.values()) {
        listener.send(event);
      }
    }
    // Forget what's too old to be looked at again.
    for (const [worldId, seen] of told) {
      const from = (looked.get(worldId) ?? 0) - OVERLAP_MS;
      for (const [id, at] of seen) {
        if (at <= from) {
          seen.delete(id);
        }
      }
    }
  }

  /** Looks every so often, for as long as the API runs. */
  function start(everyMs = 2_000) {
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        await tick(new Date());
      } catch (error) {
        console.error("Live updates failed:", error instanceof Error ? error.message : error);
      } finally {
        busy = false;
      }
    }, everyMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  return {
    listen,
    tick,
    start,
    listenersIn: (worldId: string) => listeners.get(worldId)?.size ?? 0,
  };
}

export type Live = ReturnType<typeof createLive>;

/** How often a quiet connection is reminded it's open, so nothing between closes it. */
const HEARTBEAT_MS = 15_000;

/**
 * `GET /live`, for a signed-in participant in a shared world. Not in the OpenAPI document, since it
 * streams. A participant on their own, or in a world that hasn't started, gets 204, and the page doesn't ask again.
 */
export async function liveStream(
  c: Context,
  { db, live, clock }: { db: Database; live: Live; clock: () => Date },
) {
  const context = await participantFromRequest(c, db, clock());
  if (!context) {
    return c.json({ error: "Not signed in." }, 401);
  }
  // On their own, or still waiting for others, there's nothing to tell them yet.
  if (context.worldMode !== "shared" || context.worldStartedAt > clock()) {
    return c.body(null, 204);
  }
  return streamSSE(c, async (stream) => {
    const stop = live.listen(context, (event) => {
      void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
    });
    stream.onAbort(stop);
    while (!stream.aborted) {
      await stream.sleep(HEARTBEAT_MS);
      if (!stream.aborted) {
        await stream.write(": still here\n\n");
      }
    }
    stop();
  });
}
