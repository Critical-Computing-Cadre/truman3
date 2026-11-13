import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import type { StudySettings } from "@truman3/core";
import { recordEvent, schema } from "@truman3/db";
import { exportStudy, listParticipantPhotos } from "@truman3/study-export";
import { withdrawParticipant } from "@truman3/study-import";
import { and, asc, count, countDistinct, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { zipSync } from "fflate";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { loadWorldContext } from "../participants/session.ts";
import { photoZipStream } from "./photo-zip.ts";
import { researcherFromRequest } from "./session.ts";

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const studyParams = z.object({ studyId: z.uuid() });

const commonErrors = {
  401: errorResponse("Not signed in"),
  403: errorResponse("This researcher's role doesn't allow this"),
  404: errorResponse("No such study on this researcher's teams"),
};

/** Someone counts as here right now if they've done anything this recently. */
const RECENT_MS = 15 * 60_000;
const DAYS_SHOWN = 60;
const EXPORTS_SHOWN = 5;

/** What people do that's worth watching for each condition, in a running study. */
const WATCHED_ACTIONS = ["content.created", "content.liked", "content.voted", "content.flagged"];

const monitorRoute = createRoute({
  method: "get",
  path: "/admin/studies/{studyId}/monitor",
  summary: "How a study is going. Test participants aren't counted",
  request: { params: studyParams },
  responses: {
    200: {
      description: "Counts only. Nothing here identifies a participant",
      content: {
        "application/json": {
          schema: z.object({
            title: z.string(),
            slug: z.string(),
            role: z.string(),
            liveVersion: z.number().nullable(),
            enrolled: z.number(),
            inProgress: z.number(),
            completed: z.number(),
            activeRecently: z.number(),
            declined: z.number(),
            withdrawn: z.number(),
            lastActivityAt: z.iso.datetime().nullable(),
            conditions: z.array(
              z.object({
                key: z.string(),
                /** The share of people the design expects, from the live or latest version. */
                expectedShare: z.number().nullable(),
                /** People who started in it. */
                enrolled: z.number(),
                /** People in it now, after any decision points moved them (ADR 55). */
                now: z.number(),
                completed: z.number(),
                posts: z.number(),
                comments: z.number(),
                likes: z.number(),
                votes: z.number(),
                flags: z.number(),
              }),
            ),
            steps: z.array(
              z.object({
                version: z.number(),
                steps: z.array(z.object({ label: z.string(), people: z.number() })),
              }),
            ),
            /** Whether anyone has been moved between conditions by a decision point. */
            reRandomized: z.boolean(),
            enrolledByDay: z.array(z.object({ day: z.string(), people: z.number() })),
            exports: z.array(
              z.object({
                by: z.string(),
                at: z.iso.datetime(),
                includedRecruitmentIds: z.boolean(),
                contents: z.string(),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const exportRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/export",
  summary: "Download a study's data and codebook as a zip file",
  request: {
    params: studyParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            minDwellMs: z.number().nonnegative().optional(),
            maxDwellMs: z.number().positive().optional(),
            includeRecruitmentIds: z.boolean().optional(),
            /** Only synthetic participants, kept from simulations. Never mixed with real data. */
            synthetic: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "A zip file",
      content: {
        "application/zip": { schema: z.any().openapi({ type: "string", format: "binary" }) },
      },
    },
    ...commonErrors,
  },
});

const photosRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/photos",
  summary: "Download the photos participants uploaded, as a zip file",
  request: { params: studyParams },
  responses: {
    200: {
      description: "A zip file, with photos.csv tying each photo to the data",
      content: {
        "application/zip": { schema: z.any().openapi({ type: "string", format: "binary" }) },
      },
    },
    ...commonErrors,
  },
});

const uploadsRoute = createRoute({
  method: "get",
  path: "/admin/studies/{studyId}/uploads",
  summary: "Photos participants uploaded that a researcher should look at (ADR 79)",
  request: { params: studyParams },
  responses: {
    200: {
      description:
        "Flagged photos, and ones held without being scanned, that nobody has decided on",
      content: {
        "application/json": {
          schema: z.object({
            uploads: z.array(
              z.object({
                id: z.uuid(),
                url: z.string(),
                participantId: z.uuid(),
                at: z.iso.datetime(),
                scan: z.enum(["flagged", "unscanned"]),
                /** What it was flagged for, or why it couldn't be scanned. */
                labels: z.array(z.string()),
                /** Whether others in its world are kept from seeing it until someone decides. */
                held: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const decideUploadRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/uploads/{uploadId}/decision",
  summary: "Release a photo a participant uploaded, or remove it for good",
  request: {
    params: studyParams.extend({ uploadId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ decision: z.enum(["release", "remove"]) }),
        },
      },
    },
  },
  responses: {
    200: { description: "Decided", content: { "application/json": { schema: z.object({}) } } },
    ...commonErrors,
  },
});

const withdrawRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/withdraw",
  summary: "Delete everything about a participant, and stop their ID entering this study again",
  request: {
    params: studyParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            externalId: z.string().trim().min(1),
            reason: z.string().trim().min(1).max(200),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Deleted",
      content: {
        "application/json": {
          schema: z.object({ eventsDeleted: z.number(), filesDeleted: z.number() }),
        },
      },
    },
    ...commonErrors,
  },
});

/** How much of what's being written is shown to watch, newest first. */
const LIVE_SHOWN = 100;

const liveRoute = createRoute({
  method: "get",
  path: "/admin/studies/{studyId}/live",
  summary: "What participants are writing in shared worlds, newest first, to watch and remove",
  request: { params: studyParams },
  responses: {
    200: {
      description: "What participants wrote, as others in their world see it",
      content: {
        "application/json": {
          schema: z.object({
            worlds: z.array(
              z.object({
                id: z.uuid(),
                condition: z.string(),
                people: z.number(),
                startedAt: z.iso.datetime(),
              }),
            ),
            content: z.array(
              z.object({
                id: z.uuid(),
                worldId: z.uuid(),
                kind: z.enum(["post", "comment", "story", "message"]),
                author: z.string(),
                body: z.string(),
                at: z.iso.datetime(),
                removed: z.boolean(),
              }),
            ),
            /** Who removals are by: someone in the cast with moderator: true. */
            moderator: z.string().nullable(),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const removeLiveRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/live/{contentId}/remove",
  summary: "Take down what a participant wrote in a shared world, as the study's moderator",
  request: {
    params: studyParams.extend({ contentId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ reason: z.string().trim().max(200).optional() }),
        },
      },
    },
  },
  responses: {
    200: { description: "Removed", content: { "application/json": { schema: z.object({}) } } },
    409: errorResponse("There's nobody in the cast to remove it as"),
    ...commonErrors,
  },
});

const stepLabel = (step: StudySettings["flow"][number]) => {
  switch (step.step) {
    case "consent":
      return "Consent";
    case "account":
      return "Creating a profile";
    case "page":
      return `Page: ${path.basename(step.page, path.extname(step.page))}`;
    case "feed":
      return "In the feed";
    case "exit":
      return "At the exit";
  }
};

const inferredDay = (date: Date) => date.toISOString().slice(0, 10);

export function createMonitorRoutes({ db, storage }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  app.openapi(monitorRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, studyId));
    if (!role || !study) {
      return c.json(notAvailable, 404);
    }

    const realPeople = and(
      eq(schema.participants.studyId, studyId),
      eq(schema.participants.isPilot, false),
    );

    const versions = await db
      .select({
        id: schema.studyVersions.id,
        version: schema.studyVersions.version,
        settings: schema.studyVersions.settings,
      })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.studyId, studyId))
      .orderBy(desc(schema.studyVersions.version));
    const current = versions.find(({ id }) => id === study.liveVersionId) ?? versions[0];
    const currentSettings = current?.settings as StudySettings | undefined;

    const [draft] = await db
      .select({ settings: schema.studyDrafts.settings })
      .from(schema.studyDrafts)
      .where(and(eq(schema.studyDrafts.studyId, studyId), isNull(schema.studyDrafts.closedAt)));
    const title =
      currentSettings?.title ?? (draft?.settings as StudySettings | undefined)?.title ?? study.slug;

    const byStatus = await db
      .select({ status: schema.participants.status, people: count() })
      .from(schema.participants)
      .where(realPeople)
      .groupBy(schema.participants.status);
    const withStatus = (status: string) =>
      byStatus.find((row) => row.status === status)?.people ?? 0;

    const [activity] = await db
      .select({
        last: max(schema.events.recordedAt),
        recent: countDistinct(
          sql`case when ${schema.events.recordedAt} > ${new Date(Date.now() - RECENT_MS).toISOString()}::timestamptz then ${schema.events.participantId} end`,
        ),
      })
      .from(schema.events)
      .innerJoin(schema.participants, eq(schema.participants.id, schema.events.participantId))
      .where(and(realPeople, eq(schema.events.source, "participant")));

    const removals = await db
      .select({ reason: schema.dataDeletions.reason, people: count() })
      .from(schema.dataDeletions)
      .where(eq(schema.dataDeletions.studyId, studyId))
      .groupBy(schema.dataDeletions.reason);
    const declined = removals.find(({ reason }) => reason === "declined consent")?.people ?? 0;
    const removed = removals.reduce((sum, { people }) => sum + people, 0);

    const armCounts = await db
      .select({
        key: schema.conditions.key,
        status: schema.participants.status,
        people: count(),
      })
      .from(schema.assignments)
      .innerJoin(schema.participants, eq(schema.participants.id, schema.assignments.participantId))
      .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
      .where(and(realPeople, isNull(schema.assignments.decisionPoint)))
      .groupBy(schema.conditions.key, schema.participants.status);

    // Where each person is now: their latest assignment, which a decision point may have changed.
    const allAssignments = await db
      .select({
        participantId: schema.assignments.participantId,
        key: schema.conditions.key,
        decisionPoint: schema.assignments.decisionPoint,
      })
      .from(schema.assignments)
      .innerJoin(schema.participants, eq(schema.participants.id, schema.assignments.participantId))
      .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
      .where(realPeople)
      .orderBy(asc(schema.assignments.assignedAt), asc(schema.assignments.id));
    const currentKey = new Map<string, string>();
    const startKey = new Map<string, string>();
    for (const { participantId, key, decisionPoint } of allAssignments) {
      currentKey.set(participantId, key);
      if (decisionPoint === null) {
        startKey.set(participantId, key);
      }
    }
    const reRandomized = [...currentKey].some(([id, key]) => startKey.get(id) !== key);
    const nowIn = (key: string) => [...currentKey.values()].filter((each) => each === key).length;

    const actions = await db
      .select({
        key: schema.conditions.key,
        type: schema.events.type,
        kind: sql<string | null>`${schema.events.payload}->>'kind'`,
        total: count(),
      })
      .from(schema.events)
      .innerJoin(schema.participants, eq(schema.participants.id, schema.events.participantId))
      .innerJoin(schema.conditions, eq(schema.conditions.id, schema.events.conditionId))
      .where(
        and(
          realPeople,
          eq(schema.events.source, "participant"),
          inArray(schema.events.type, WATCHED_ACTIONS),
        ),
      )
      .groupBy(schema.conditions.key, schema.events.type, sql`${schema.events.payload}->>'kind'`);

    const arms = currentSettings?.conditions.arms ?? [];
    const totalWeight = arms.reduce((sum, arm) => sum + arm.weight, 0);
    const keys = [
      ...new Set([
        ...arms.map(({ key }) => key),
        ...armCounts.map(({ key }) => key),
        ...currentKey.values(),
      ]),
    ];
    const actionCount = (key: string, type: string, kind: string | null = null) =>
      actions.find(
        (row) => row.key === key && row.type === type && (kind === null || row.kind === kind),
      )?.total ?? 0;

    const positions = await db
      .select({
        versionId: schema.assignments.studyVersionId,
        position: schema.participants.flowPosition,
        people: count(),
      })
      .from(schema.participants)
      .innerJoin(schema.assignments, eq(schema.assignments.participantId, schema.participants.id))
      .where(
        and(
          realPeople,
          eq(schema.participants.status, "active"),
          isNull(schema.assignments.decisionPoint),
        ),
      )
      .groupBy(schema.assignments.studyVersionId, schema.participants.flowPosition);

    const days = await db
      .select({
        day: sql<string>`to_char(${schema.participants.enrolledAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        people: count(),
      })
      .from(schema.participants)
      .where(realPeople)
      .groupBy(sql`1`)
      .orderBy(asc(sql`1`));

    // Days with nobody stay in, so a quiet stretch looks like one.
    const enrolledByDay: { day: string; people: number }[] = [];
    const firstDay = days[0]?.day;
    if (firstDay) {
      const earliest = Date.now() - (DAYS_SHOWN - 1) * 86_400_000;
      const start = Math.max(new Date(`${firstDay}T00:00:00Z`).getTime(), earliest);
      for (let time = start; time <= Date.now(); time += 86_400_000) {
        const day = inferredDay(new Date(time));
        enrolledByDay.push({ day, people: days.find((row) => row.day === day)?.people ?? 0 });
      }
    }

    const exports = await db
      .select()
      .from(schema.studyExports)
      .where(eq(schema.studyExports.studyId, studyId))
      .orderBy(desc(schema.studyExports.id))
      .limit(EXPORTS_SHOWN);

    return c.json(
      {
        title,
        slug: study.slug,
        role,
        liveVersion: versions.find(({ id }) => id === study.liveVersionId)?.version ?? null,
        enrolled: byStatus.reduce((sum, { people }) => sum + people, 0),
        inProgress: withStatus("active"),
        completed: withStatus("completed"),
        activeRecently: activity?.recent ?? 0,
        declined,
        withdrawn: removed - declined,
        lastActivityAt: activity?.last ? new Date(activity.last).toISOString() : null,
        conditions: keys.map((key) => {
          const arm = arms.find((item) => item.key === key);
          const counts = armCounts.filter((row) => row.key === key);
          return {
            key,
            expectedShare: arm && totalWeight > 0 ? arm.weight / totalWeight : null,
            enrolled: counts.reduce((sum, { people }) => sum + people, 0),
            now: nowIn(key),
            completed: counts.find(({ status }) => status === "completed")?.people ?? 0,
            posts: actionCount(key, "content.created", "post"),
            comments: actionCount(key, "content.created", "comment"),
            likes: actionCount(key, "content.liked"),
            votes: actionCount(key, "content.voted"),
            flags: actionCount(key, "content.flagged"),
          };
        }),
        steps: versions.flatMap(({ id, version, settings }) => {
          const here = positions.filter(({ versionId }) => versionId === id);
          return here.length === 0
            ? []
            : [
                {
                  version,
                  steps: (settings as StudySettings).flow.map((step, index) => ({
                    label: stepLabel(step),
                    people: here.find(({ position }) => position === index)?.people ?? 0,
                  })),
                },
              ];
        }),
        reRandomized,
        enrolledByDay,
        exports: exports.map(({ by, at, includedRecruitmentIds, contents }) => ({
          by,
          at: at.toISOString(),
          includedRecruitmentIds,
          contents,
        })),
      },
      200,
    );
  });

  app.openapi(exportRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, studyId));
    if (!role || !study) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "Viewers can't download a study's data." }, 403);
    }
    const options = c.req.valid("json");
    if (options.includeRecruitmentIds && role !== "owner") {
      return c.json({ error: "Only the team's owner can download recruitment IDs." }, 403);
    }

    const folder = mkdtempSync(path.join(tmpdir(), "truman-export-"));
    try {
      const result = await exportStudy(db, study.slug, folder, {
        ...(options.minDwellMs === undefined ? {} : { minDwellMs: options.minDwellMs }),
        ...(options.maxDwellMs === undefined ? {} : { maxDwellMs: options.maxDwellMs }),
        ...(options.includeRecruitmentIds ? { includeRecruitmentIds: true } : {}),
        ...(options.synthetic ? { synthetic: true } : {}),
      });
      if (result.status === "not-found") {
        return c.json(notAvailable, 404);
      }
      const zipped = zipSync(
        Object.fromEntries(
          result.files.map((file) => [file, new Uint8Array(readFileSync(path.join(folder, file)))]),
        ),
      );

      // Who took the data, and whether it could identify people, is worth being able to answer.
      await db.insert(schema.studyExports).values({
        studyId,
        by: researcher.email,
        includedRecruitmentIds: options.includeRecruitmentIds ?? false,
        ...(options.synthetic ? { contents: "synthetic" } : {}),
      });

      return c.body(zipped.slice().buffer, 200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${study.slug}${options.synthetic ? "-synthetic" : ""}-${inferredDay(new Date())}.zip"`,
      });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  app.openapi(photosRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, studyId));
    if (!role || !study) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "Viewers can't download a study's data." }, 403);
    }

    const photos = await listParticipantPhotos(db, studyId);
    await db.insert(schema.studyExports).values({
      studyId,
      by: researcher.email,
      contents: "photos",
    });

    return c.body(photoZipStream(storage, photos), 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${study.slug}-photos-${inferredDay(new Date())}.zip"`,
    });
  });

  /** The uploads of one study, through the world each was made in. */
  const uploadsWithStudy = () =>
    db
      .select({ upload: schema.uploads })
      .from(schema.uploads)
      .innerJoin(schema.worlds, eq(schema.worlds.id, schema.uploads.worldId))
      .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
      .$dynamic();

  app.openapi(uploadsRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    if (!(await roleOnStudy(db, researcher.id, studyId))) {
      return c.json(notAvailable, 404);
    }
    const rows = await uploadsWithStudy()
      .where(
        and(
          eq(schema.studyVersions.studyId, studyId),
          eq(schema.uploads.needsReview, true),
          isNull(schema.uploads.decision),
        ),
      )
      .orderBy(desc(schema.uploads.createdAt))
      .limit(200);
    return c.json(
      {
        uploads: rows.map(({ upload }) => ({
          id: upload.id,
          url: `/api/media/${upload.key}`,
          participantId: upload.participantId,
          at: upload.createdAt.toISOString(),
          scan: upload.scan as "flagged" | "unscanned",
          labels: upload.labels,
          held: upload.held,
        })),
      },
      200,
    );
  });

  app.openapi(decideUploadRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId, uploadId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    if (!role) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "You can view this study, but not change it." }, 403);
    }
    const [found] = await uploadsWithStudy().where(
      and(eq(schema.studyVersions.studyId, studyId), eq(schema.uploads.id, uploadId)),
    );
    if (!found) {
      return c.json(notAvailable, 404);
    }
    const { decision } = c.req.valid("json");
    // The record first, so a photo is never gone from storage while still shown as waiting.
    await db
      .update(schema.uploads)
      .set({
        decision: decision === "release" ? "released" : "removed",
        held: decision !== "release",
        decidedBy: researcher.email,
        decidedAt: new Date(),
      })
      .where(eq(schema.uploads.id, uploadId));
    if (decision === "remove") {
      await storage.delete(found.upload.key);
    }
    return c.json({}, 200);
  });

  app.openapi(withdrawRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    const [study] = await db
      .select({ slug: schema.studies.slug })
      .from(schema.studies)
      .where(eq(schema.studies.id, studyId));
    if (!role || !study) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "You can view this study, but not change it." }, 403);
    }

    const { externalId, reason } = c.req.valid("json");
    const result = await withdrawParticipant(db, storage, {
      slug: study.slug,
      externalId,
      reason,
      requestedBy: researcher.email,
    });
    if (result.status === "not-found") {
      return c.json({ error: "There's nobody with that ID in this study. Nothing changed." }, 404);
    }
    return c.json({ eventsDeleted: result.eventsDeleted, filesDeleted: result.filesDeleted }, 200);
  });

  /** The study's shared worlds, and its moderator, for watching. */
  async function sharedWorldsOf(studyId: string) {
    const worlds = await db
      .select({
        id: schema.worlds.id,
        studyVersionId: schema.worlds.studyVersionId,
        conditionId: schema.worlds.conditionId,
        startedAt: schema.worlds.startedAt,
      })
      .from(schema.worlds)
      .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
      .where(
        and(
          eq(schema.studyVersions.studyId, studyId),
          eq(schema.worlds.mode, "shared"),
          // Not the worlds of scenario tests and simulations, which only have test participants.
          sql`exists (select 1 from ${schema.worldMemberships} m
            join ${schema.participants} p on p.id = m.participant_id
            where m.world_id = ${schema.worlds.id} and not p.is_pilot)`,
        ),
      )
      .orderBy(desc(schema.worlds.startedAt));
    return worlds;
  }

  /** Someone in the cast marked as a moderator, who removals are by. */
  async function moderatorOf(studyVersionId: string) {
    const [moderator] = await db
      .select({ id: schema.actors.id, username: schema.actors.username })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.studyVersionId, studyVersionId),
          isNull(schema.actors.worldId),
          sql`(${schema.actors.profile} ->> 'moderator')::boolean`,
        ),
      )
      .orderBy(asc(schema.actors.username))
      .limit(1);
    return moderator ?? null;
  }

  app.openapi(liveRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    if (!role) {
      return c.json(notAvailable, 404);
    }
    const worlds = await sharedWorldsOf(studyId);
    const worldIds = worlds.map(({ id }) => id);
    if (worldIds.length === 0) {
      return c.json({ worlds: [], content: [], moderator: null }, 200);
    }
    const people = await db
      .select({ worldId: schema.worldMemberships.worldId, people: count() })
      .from(schema.worldMemberships)
      .where(inArray(schema.worldMemberships.worldId, worldIds))
      .groupBy(schema.worldMemberships.worldId);
    const conditions = await db
      .select({ id: schema.conditions.id, key: schema.conditions.key })
      .from(schema.conditions)
      .where(
        inArray(
          schema.conditions.id,
          worlds.flatMap(({ conditionId }) => (conditionId ? [conditionId] : [])),
        ),
      );
    const written = await db
      .select({
        id: schema.content.id,
        worldId: schema.content.worldId,
        kind: schema.content.kind,
        author: schema.actors.username,
        body: schema.content.body,
        title: schema.content.title,
        at: schema.content.visibleAt,
      })
      .from(schema.content)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.content.authorActorId))
      .where(
        and(
          inArray(schema.content.worldId, worldIds),
          eq(schema.actors.driver, "human"),
          isNull(schema.content.withdrawnAt),
        ),
      )
      .orderBy(desc(schema.content.visibleAt))
      .limit(LIVE_SHOWN);
    const removed = written.length
      ? await db
          .select({ id: schema.notifications.targetContentId })
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.type, "remove"),
              inArray(
                schema.notifications.targetContentId,
                written.map(({ id }) => id),
              ),
            ),
          )
      : [];
    const removedIds = new Set(removed.map(({ id }) => id));
    const latest = worlds[0];
    const moderator = latest ? await moderatorOf(latest.studyVersionId) : null;
    return c.json(
      {
        worlds: worlds.map((world) => ({
          id: world.id,
          condition: conditions.find(({ id }) => id === world.conditionId)?.key ?? "",
          people: people.find(({ worldId }) => worldId === world.id)?.people ?? 0,
          startedAt: world.startedAt.toISOString(),
        })),
        content: written.map((item) => ({
          id: item.id,
          worldId: item.worldId as string,
          kind: item.kind as "post" | "comment" | "story" | "message",
          author: item.author,
          body: [item.title, item.body].filter(Boolean).join("\n"),
          at: (item.at as Date).toISOString(),
          removed: removedIds.has(item.id),
        })),
        moderator: moderator?.username ?? null,
      },
      200,
    );
  });

  app.openapi(removeLiveRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId, contentId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    if (!role) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "You can view this study, but not change it." }, 403);
    }
    const [item] = await db
      .select({
        id: schema.content.id,
        worldId: schema.content.worldId,
        authorActorId: schema.content.authorActorId,
        studyVersionId: schema.worlds.studyVersionId,
      })
      .from(schema.content)
      .innerJoin(schema.worlds, eq(schema.worlds.id, schema.content.worldId))
      .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
      .where(
        and(
          eq(schema.content.id, contentId),
          eq(schema.studyVersions.studyId, studyId),
          eq(schema.worlds.mode, "shared"),
        ),
      );
    if (!item?.worldId) {
      return c.json(notAvailable, 404);
    }
    const moderator = await moderatorOf(item.studyVersionId);
    if (!moderator) {
      return c.json(
        {
          error:
            "Nobody in the cast is a moderator, so there's nobody to remove it as. Give someone moderator: true in actors.csv.",
        },
        409,
      );
    }
    const author = await loadWorldContext(db, item.worldId, item.authorActorId);
    const { reason } = c.req.valid("json");
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(schema.notifications).values({
        worldId: item.worldId as string,
        recipientActorId: item.authorActorId,
        actorId: moderator.id,
        type: "remove",
        targetContentId: item.id,
        reason: reason || null,
        dueAt: now,
      });
      await recordEvent(tx, {
        type: "moderation.removed_live",
        payload: reason ? { reason } : {},
        worldId: item.worldId as string,
        studyVersionId: item.studyVersionId,
        participantId: author?.participantId ?? null,
        conditionId: author?.conditionId ?? null,
        actorId: moderator.id,
        targetActorId: item.authorActorId,
        targetContentId: item.id,
        source: "researcher",
        occurredAt: now,
      });
    });
    return c.json({}, 200);
  });

  return app;
}
