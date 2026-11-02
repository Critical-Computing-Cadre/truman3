import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import type { StudySettings } from "@truman3/core";
import { schema } from "@truman3/db";
import { exportStudy } from "@truman3/study-export";
import { withdrawParticipant } from "@truman3/study-import";
import { and, asc, count, countDistinct, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { zipSync } from "fflate";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
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
const WATCHED_ACTIONS = ["content.created", "content.liked", "content.flagged"];

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
                enrolled: z.number(),
                completed: z.number(),
                posts: z.number(),
                comments: z.number(),
                likes: z.number(),
                flags: z.number(),
              }),
            ),
            steps: z.array(
              z.object({
                version: z.number(),
                steps: z.array(z.object({ label: z.string(), people: z.number() })),
              }),
            ),
            enrolledByDay: z.array(z.object({ day: z.string(), people: z.number() })),
            exports: z.array(
              z.object({
                by: z.string(),
                at: z.iso.datetime(),
                includedRecruitmentIds: z.boolean(),
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
    const keys = [...new Set([...arms.map(({ key }) => key), ...armCounts.map(({ key }) => key)])];
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
            completed: counts.find(({ status }) => status === "completed")?.people ?? 0,
            posts: actionCount(key, "content.created", "post"),
            comments: actionCount(key, "content.created", "comment"),
            likes: actionCount(key, "content.liked"),
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
        enrolledByDay,
        exports: exports.map(({ by, at, includedRecruitmentIds }) => ({
          by,
          at: at.toISOString(),
          includedRecruitmentIds,
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
      });

      return c.body(zipped.slice().buffer, 200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${study.slug}-${inferredDay(new Date())}.zip"`,
      });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
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

  return app;
}
