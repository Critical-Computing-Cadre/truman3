import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import type { StudySettings } from "@truman3/core";
import { schema } from "@truman3/db";
import { desc, eq } from "drizzle-orm";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { studyAddress } from "./addresses.ts";
import { researcherFromRequest } from "./session.ts";

const recruitingRoute = createRoute({
  method: "get",
  path: "/admin/studies/{studyId}/recruiting",
  summary: "How a study takes people in and sends them on, for recruiting them anywhere",
  request: { params: z.object({ studyId: z.uuid() }) },
  responses: {
    200: {
      description:
        "The version people get (the live one, or else the newest), its link, the ID it reads, and where it sends people at the end",
      content: {
        "application/json": {
          schema: z.object({
            title: z.string(),
            versionId: z.string(),
            version: z.number(),
            live: z.boolean(),
            /** The study's link, without the ID. A platform adds that. */
            joinUrl: z.string(),
            entry: z.object({ idParam: z.string(), idLabel: z.string(), source: z.string() }),
            /** Where the last step sends people, or null where it doesn't. */
            exitRedirect: z.string().nullable(),
            hasExit: z.boolean(),
          }),
        },
      },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
    },
    404: {
      description: "Not a study they can see, or it has no versions",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
    },
  },
});

/**
 * What any recruitment platform needs from a study (ADR 98): the link to give out, the name of
 * the ID in it, and where people go when they finish. The admin app's Recruit page shows these
 * for CloudResearch, SONA, and anywhere else, and helps change them in a draft.
 */
export function createRecruitingRoutes({
  db,
  participantAppUrl = "",
  participantDomains = [],
  participantDomainDefault,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  app.openapi(recruitingRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json({ error: "Please sign in." }, 401);
    }
    const { studyId } = c.req.valid("param");
    const notAvailable = { error: "That isn't available." };
    if (!(await roleOnStudy(db, researcher.id, studyId))) {
      return c.json(notAvailable, 404);
    }
    const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, studyId));
    const versions = await db
      .select()
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.studyId, studyId))
      .orderBy(desc(schema.studyVersions.version));
    const version = versions.find(({ id }) => id === study?.liveVersionId) ?? versions[0];
    if (!study || !version) {
      return c.json(notAvailable, 404);
    }
    const settings = version.settings as StudySettings;
    const exit = settings.flow.find((step) => step.step === "exit");
    const base = studyAddress(study.participantDomain, {
      participantAppUrl,
      participantDomains,
      participantDomainDefault,
    }).replace(/\/+$/, "");
    return c.json(
      {
        title: settings.title,
        versionId: version.id,
        version: version.version,
        live: version.id === study.liveVersionId,
        joinUrl: `${base}/join/${study.slug}`,
        entry: settings.entry,
        exitRedirect: exit && "redirect" in exit ? (exit.redirect ?? null) : null,
        hasExit: Boolean(exit),
      },
      200,
    );
  });

  return app;
}
