import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import type { StudySettings } from "@truman3/core";
import { schema } from "@truman3/db";
import {
  createProlificClient,
  decryptSecret,
  ProlificError,
  type ProlificSubmission,
  parseSecretKey,
} from "@truman3/recruit";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { describeError } from "../errors.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { realClock } from "../participants/session.ts";
import { studyAddress } from "./addresses.ts";
import { researcherFromRequest } from "./session.ts";

/**
 * Reminders to come back (ADR 90). In a study that lasts days, someone who's part way through and
 * hasn't visited for a while gets a message in their Prolific inbox, with their own link back in.
 * A study turns them on once, on its Prolific page, and they go out by themselves. They can also
 * be sent there and then.
 *
 * Truman has no way to reach a participant itself: it holds a recruitment ID and nothing else.
 * Prolific does, so the message goes through Prolific, as whoever turned the reminders on.
 */

/** Nobody gets one sooner than this after their last visit, however a study sets it. */
export const SHORTEST_HOURS = 1;
export const DEFAULT_HOURS = 20;
export const DEFAULT_MESSAGE =
  "You're part way through {site}, and there's more to see. Pick up where you left off: {link}";
/** Prolific doesn't say how long a message can be. This keeps it to a few lines. */
const LONGEST_MESSAGE = 1000;

/** Submissions that are over on Prolific's side: these people aren't coming back. */
const OVER_ON_PROLIFIC = new Set(["RETURNED", "REJECTED", "TIMED-OUT"]);

const HOUR_MS = 60 * 60 * 1000;
const day = (when: Date) => when.toISOString().slice(0, 10);

/** What's wrong with a reminder's wording, or null. */
export function problemWithMessage(message: string): string | null {
  if (!message.includes("{link}")) {
    return "The message needs {link} in it, which becomes each person's own way back in.";
  }
  if (message.length > LONGEST_MESSAGE) {
    return `Keep the message under ${LONGEST_MESSAGE} characters.`;
  }
  return null;
}

/** The message one person gets. */
export function wordReminder(message: string, link: string, site: string) {
  return message.replaceAll("{link}", link).replaceAll("{site}", site);
}

/** Their own link: the study's address with their ID in it, which is all they need to get back. */
export function wayBackIn(address: string, slug: string, idParam: string, prolificId: string) {
  return `${address.replace(/\/+$/, "")}/join/${slug}?${idParam}=${encodeURIComponent(prolificId)}`;
}

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: z.object({ error: z.string() }) } },
});
const errors = {
  400: errorResponse("Prolific refused, or something's missing"),
  401: errorResponse("Not signed in"),
  403: errorResponse("This researcher can't do this"),
  404: errorResponse("Not available"),
  409: errorResponse("This study doesn't recruit through Prolific yet"),
  502: errorResponse("Prolific couldn't be reached"),
  503: errorResponse("This server isn't set up to connect to Prolific"),
};
const studyParams = z.object({ studyId: z.uuid() });

const stateSchema = z.object({
  /** Whether they go out by themselves, and after how long away. */
  on: z.boolean(),
  afterHours: z.number(),
  message: z.string(),
  /** Whose Prolific connection sends them. */
  by: z.string().nullable(),
  /** How many people would get one now. Null if Prolific couldn't be asked. */
  due: z.number().nullable(),
  problem: z.string().nullable(),
  /** How many went out on each of the last few days. */
  sent: z.array(z.object({ day: z.string(), people: z.number() })),
});

const stateRoute = createRoute({
  method: "get",
  path: "/admin/studies/{studyId}/prolific/reminders",
  summary: "A study's reminders to come back, and how many people are due one",
  request: { params: studyParams },
  responses: {
    200: { description: "As it stands", content: { "application/json": { schema: stateSchema } } },
    ...errors,
  },
});

const saveRoute = createRoute({
  method: "put",
  path: "/admin/studies/{studyId}/prolific/reminders",
  summary: "Turn a study's reminders on or off, and say when they go and what they say",
  request: {
    params: studyParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            on: z.boolean(),
            afterHours: z
              .number()
              .int()
              .min(SHORTEST_HOURS)
              .max(24 * 14),
            message: z.string().trim().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Saved",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    ...errors,
  },
});

const sendRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/prolific/reminders/send",
  summary: "Send a reminder now to everyone who's due one",
  request: { params: studyParams },
  responses: {
    200: {
      description: "How many went",
      content: {
        "application/json": {
          schema: z.object({ sent: z.number(), failed: z.number() }),
        },
      },
    },
    ...errors,
  },
});

type Dependencies = Pick<
  ParticipantRouteDependencies,
  "db" | "labKeys" | "prolific" | "participantDomains" | "participantDomainDefault" | "clock"
>;

/** What reminders need, shared by the routes and the schedule. */
export function createReminders({
  db,
  labKeys,
  prolific: config,
  participantDomains = [],
  participantDomainDefault,
  clock = realClock,
}: Dependencies) {
  const secretKey = parseSecretKey(config?.secretKey);

  const clientFor = async (researcherId: string) => {
    if (!secretKey || !config) {
      return null;
    }
    const [row] = await db
      .select()
      .from(schema.prolificConnections)
      .where(eq(schema.prolificConnections.researcherId, researcherId));
    if (!row) {
      return null;
    }
    try {
      return createProlificClient({
        token: decryptSecret(row.tokenEncrypted, secretKey),
        ...(config.apiUrl ? { apiUrl: config.apiUrl } : {}),
        ...(config.fetch ? { fetch: config.fetch } : {}),
      });
    } catch {
      // The server's key changed, so this person has to connect again.
      return null;
    }
  };

  /** A study as reminders need it: its link to Prolific, and the version people are in. */
  const studyFor = async (studyId: string) => {
    const [found] = await db
      .select({ study: schema.studies, link: schema.prolificLinks })
      .from(schema.studies)
      .innerJoin(schema.prolificLinks, eq(schema.prolificLinks.studyId, schema.studies.id))
      .where(eq(schema.studies.id, studyId));
    if (!found) {
      return null;
    }
    const versions = await db
      .select({ id: schema.studyVersions.id, settings: schema.studyVersions.settings })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.studyId, studyId))
      .orderBy(desc(schema.studyVersions.version));
    const version = versions.find(({ id }) => id === found.study.liveVersionId) ?? versions[0];
    return version ? { ...found, settings: version.settings as StudySettings } : null;
  };

  /**
   * Who'd get a reminder now, from Prolific's list of who took the study. Someone is due one when:
   * they're in the study here and haven't finished or withdrawn, the study's days aren't up for
   * them, they haven't done anything for `afterHours`, and they haven't had a reminder today.
   */
  const whoIsDue = async (
    studyId: string,
    settings: StudySettings,
    submissions: readonly ProlificSubmission[],
    afterHours: number,
    now: Date,
  ) => {
    const prolificIds = [
      ...new Set(
        submissions
          .filter(({ status }) => !OVER_ON_PROLIFIC.has(status))
          .map((submission) => submission.participant_id),
      ),
    ];
    if (prolificIds.length === 0) {
      return [];
    }
    // Where the lab has its own key, people are stored by a stand-in for their ID (ADR 82).
    const sealer = await labKeys?.forStudy(db, studyId);
    const standIn = (id: string) => sealer?.lookup(id);
    const people = await db
      .select({
        id: schema.participants.id,
        externalId: schema.participants.externalId,
        enrolledAt: schema.participants.enrolledAt,
      })
      .from(schema.participants)
      .where(
        and(
          eq(schema.participants.studyId, studyId),
          eq(schema.participants.status, "active"),
          inArray(schema.participants.externalId, [
            ...prolificIds,
            ...prolificIds.flatMap((id) => standIn(id) ?? []),
          ]),
        ),
      );
    if (people.length === 0) {
      return [];
    }
    const theirs = people.map(({ id }) => id);
    // When each of them started, which is when their study's days are counted from.
    const started = new Map(
      (
        await db
          .select({
            participantId: schema.worldMemberships.participantId,
            at: sql<string>`min(${schema.worlds.startedAt})`,
          })
          .from(schema.worldMemberships)
          .innerJoin(schema.worlds, eq(schema.worlds.id, schema.worldMemberships.worldId))
          .where(inArray(schema.worldMemberships.participantId, theirs))
          .groupBy(schema.worldMemberships.participantId)
      ).map(({ participantId, at }) => [participantId, new Date(at)]),
    );
    // The last thing each of them did.
    const lastActive = new Map(
      (
        await db
          .select({
            participantId: schema.events.participantId,
            at: sql<string>`max(${schema.events.occurredAt})`,
          })
          .from(schema.events)
          .where(
            and(
              inArray(schema.events.participantId, theirs),
              eq(schema.events.source, "participant"),
            ),
          )
          .groupBy(schema.events.participantId)
      ).map(({ participantId, at }) => [participantId, new Date(at)]),
    );
    const remindedToday = new Set(
      (
        await db
          .select({ participantId: schema.remindersSent.participantId })
          .from(schema.remindersSent)
          .where(
            and(
              inArray(schema.remindersSent.participantId, theirs),
              eq(schema.remindersSent.sentOn, day(now)),
            ),
          )
      ).map(({ participantId }) => participantId),
    );
    const lengthMs = settings.length.days * 24 * HOUR_MS;
    return prolificIds.flatMap((prolificId) => {
      const person = people.find(
        ({ externalId }) => externalId === prolificId || externalId === standIn(prolificId),
      );
      if (!person || remindedToday.has(person.id)) {
        return [];
      }
      const began = started.get(person.id) ?? person.enrolledAt;
      if (now.getTime() - began.getTime() >= lengthMs) {
        return [];
      }
      const lastSeen = lastActive.get(person.id) ?? person.enrolledAt;
      return now.getTime() - lastSeen.getTime() >= afterHours * HOUR_MS
        ? [{ participantId: person.id, prolificId }]
        : [];
    });
  };

  /**
   * Sends a reminder to everyone due one. Each person is claimed for the day before their message
   * goes, so two sends at once, or two servers, can't message anyone twice. If Prolific refuses
   * one, their claim is given back, so a later send can try them again.
   */
  const send = async (studyId: string, researcherId: string, by: string, now = clock()) => {
    const found = await studyFor(studyId);
    const client = await clientFor(researcherId);
    if (!found || !client || !config) {
      return { sent: 0, failed: 0, reached: false as const };
    }
    const { study, link, settings } = found;
    const submissions = await client.submissions(link.prolificStudyId);
    const due = await whoIsDue(
      studyId,
      settings,
      submissions,
      link.remindAfterHours ?? DEFAULT_HOURS,
      now,
    );
    const address = studyAddress(study.participantDomain, {
      participantAppUrl: config.participantAppUrl,
      participantDomains,
      participantDomainDefault,
    });
    let sent = 0;
    let failed = 0;
    for (const { participantId, prolificId } of due) {
      const [claimed] = await db
        .insert(schema.remindersSent)
        .values({ participantId, sentOn: day(now), by })
        .onConflictDoNothing()
        .returning({ id: schema.remindersSent.id });
      if (!claimed) {
        continue;
      }
      try {
        await client.message({
          recipientId: prolificId,
          studyId: link.prolificStudyId,
          body: wordReminder(
            link.remindMessage ?? DEFAULT_MESSAGE,
            wayBackIn(address, study.slug, settings.entry.idParam, prolificId),
            settings.site.name,
          ),
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        await db.delete(schema.remindersSent).where(eq(schema.remindersSent.id, claimed.id));
        // Their token stopped working, or Prolific is down: the rest would fail the same way.
        if (!(error instanceof ProlificError) || error.status === 401 || error.status >= 500) {
          throw error;
        }
      }
    }
    if (sent > 0) {
      await db
        .insert(schema.prolificActions)
        .values({ studyId, by, action: "sent reminders", people: sent });
    }
    return { sent, failed, reached: true as const };
  };

  /** Every study with reminders on gets its send. One study's trouble doesn't stop the others. */
  const sendAllDue = async (now = clock()) => {
    const links = await db
      .select({ studyId: schema.prolificLinks.studyId, by: schema.prolificLinks.remindBy })
      .from(schema.prolificLinks)
      .innerJoin(schema.studies, eq(schema.studies.id, schema.prolificLinks.studyId))
      .where(
        and(
          isNotNull(schema.prolificLinks.remindAfterHours),
          isNotNull(schema.prolificLinks.remindBy),
          // A study that's stopped takes nobody new, but people in it can still come back.
          isNull(schema.studies.archivedAt),
        ),
      );
    let sent = 0;
    for (const { studyId, by } of links) {
      try {
        sent += (await send(studyId, by as string, "the schedule", now)).sent;
      } catch (error) {
        console.error("Reminders couldn't be sent for a study:", describeError(error));
      }
    }
    return sent;
  };

  return { clientFor, studyFor, whoIsDue, send, sendAllDue };
}

/** Sends due reminders every so often, for as long as the API runs. */
export function startReminding(dependencies: Dependencies, everyMs = 15 * 60 * 1000) {
  const { sendAllDue } = createReminders(dependencies);
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      await sendAllDue();
    } catch (error) {
      console.error("Reminders failed:", describeError(error));
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

export function createReminderRoutes(dependencies: ParticipantRouteDependencies) {
  const { db, clock = realClock } = dependencies;
  const reminders = createReminders(dependencies);
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };
  const viewersCant = { error: "Viewers can't see a study's Prolific details." };
  const notLinked = { error: "This study doesn't recruit through Prolific yet." };
  const notConnected = { error: "Connect your Prolific account first." };

  /** Who's asking, if they may change this study, and the study with its link to Prolific. */
  const allowed = async (c: Parameters<typeof researcherFromRequest>[0], studyId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return { refuse: { body: pleaseSignIn, status: 401 as const } };
    }
    const role = await roleOnStudy(db, researcher.id, studyId);
    if (!role) {
      return { refuse: { body: notAvailable, status: 404 as const } };
    }
    if (role === "viewer") {
      return { refuse: { body: viewersCant, status: 403 as const } };
    }
    const found = await reminders.studyFor(studyId);
    return found ? { researcher, ...found } : { refuse: { body: notLinked, status: 409 as const } };
  };

  const prolificProblem = (error: unknown) => {
    if (error instanceof ProlificError && error.status === 401) {
      return {
        status: 400 as const,
        message: "Prolific didn't accept your token. Connect your account again.",
      };
    }
    if (error instanceof ProlificError && (error.status === 403 || error.status === 404)) {
      return {
        status: 403 as const,
        message:
          "Your Prolific account can't do this. Ask whoever runs this study on Prolific to add you.",
      };
    }
    if (error instanceof ProlificError && error.status < 500) {
      return { status: 400 as const, message: `Prolific said: ${error.message}` };
    }
    console.error("Prolific request failed:", describeError(error));
    return { status: 502 as const, message: "Prolific couldn't be reached. Try again." };
  };

  app.openapi(stateRoute, async (c) => {
    const { studyId } = c.req.valid("param");
    const asked = await allowed(c, studyId);
    if ("refuse" in asked) {
      return c.json(asked.refuse.body, asked.refuse.status);
    }
    const { link, settings, researcher } = asked;
    const afterHours = link.remindAfterHours ?? DEFAULT_HOURS;
    let due: number | null = null;
    let problem: string | null = null;
    const client = await reminders.clientFor(researcher.id);
    if (!client) {
      problem = "Connect your Prolific account to see who's due a reminder.";
    } else {
      // Only asking Prolific is tried here. Anything that goes wrong after is ours, and shows.
      let submissions: ProlificSubmission[] | null = null;
      try {
        submissions = await client.submissions(link.prolificStudyId);
      } catch (error) {
        problem = prolificProblem(error).message;
      }
      if (submissions) {
        due = (await reminders.whoIsDue(studyId, settings, submissions, afterHours, clock()))
          .length;
      }
    }
    const [by] = link.remindBy
      ? await db
          .select({ name: schema.researchers.name })
          .from(schema.researchers)
          .where(eq(schema.researchers.id, link.remindBy))
      : [];
    const sent = await db
      .select({
        day: schema.remindersSent.sentOn,
        people: sql<number>`count(*)::int`,
      })
      .from(schema.remindersSent)
      .innerJoin(
        schema.participants,
        eq(schema.participants.id, schema.remindersSent.participantId),
      )
      .where(eq(schema.participants.studyId, studyId))
      .groupBy(schema.remindersSent.sentOn)
      .orderBy(desc(schema.remindersSent.sentOn))
      .limit(7);
    return c.json(
      {
        on: link.remindAfterHours !== null && link.remindBy !== null,
        afterHours,
        message: link.remindMessage ?? DEFAULT_MESSAGE,
        by: by?.name ?? null,
        due,
        problem,
        sent,
      },
      200,
    );
  });

  app.openapi(saveRoute, async (c) => {
    const { studyId } = c.req.valid("param");
    const asked = await allowed(c, studyId);
    if ("refuse" in asked) {
      return c.json(asked.refuse.body, asked.refuse.status);
    }
    const { researcher, link } = asked;
    const input = c.req.valid("json");
    const wrong = problemWithMessage(input.message);
    if (wrong) {
      return c.json({ error: wrong }, 400);
    }
    // They're sent as whoever turns them on, so that person has to be connected.
    if (input.on && !(await reminders.clientFor(researcher.id))) {
      return c.json(notConnected, 400);
    }
    const wasOn = link.remindAfterHours !== null && link.remindBy !== null;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.prolificLinks)
        .set({
          remindAfterHours: input.on ? input.afterHours : null,
          remindMessage: input.message,
          remindBy: input.on ? researcher.id : null,
        })
        .where(eq(schema.prolificLinks.studyId, studyId));
      if (input.on !== wasOn) {
        await tx.insert(schema.prolificActions).values({
          studyId,
          by: researcher.email,
          action: input.on ? "turned reminders on" : "turned reminders off",
        });
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(sendRoute, async (c) => {
    const { studyId } = c.req.valid("param");
    const asked = await allowed(c, studyId);
    if ("refuse" in asked) {
      return c.json(asked.refuse.body, asked.refuse.status);
    }
    const { researcher } = asked;
    if (!(await reminders.clientFor(researcher.id))) {
      return c.json(notConnected, 400);
    }
    try {
      const { sent, failed } = await reminders.send(studyId, researcher.id, researcher.email);
      return c.json({ sent, failed }, 200);
    } catch (error) {
      const { status, message } = prolificProblem(error);
      return c.json({ error: message }, status);
    }
  });

  return app;
}
