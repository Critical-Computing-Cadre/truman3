import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { deleteStudy, whyNotDeletable } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

/**
 * Archiving hides a study from the Studies page, and restoring brings it back. Deleting removes an
 * archived study for good, but only one that never had real participants. See ADR 58.
 */

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const studyParams = z.object({ studyId: z.uuid() });

const archiveRoute = createRoute({
  method: "put",
  path: "/admin/studies/{studyId}/archived",
  summary: "Archive a study, hiding it from the Studies page, or restore it",
  request: {
    params: studyParams,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ archived: z.boolean() }) } },
    },
  },
  responses: {
    200: {
      description: "Saved",
      content: { "application/json": { schema: z.object({ archived: z.boolean() }) } },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can only view"),
    404: errorResponse("No such study on this researcher's teams"),
    409: errorResponse("It's open to participants"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/admin/studies/{studyId}",
  summary: "Delete an archived study for good, if real people never took part in it",
  request: {
    params: studyParams,
    // Typing its address is the confirmation, so a stray click can't do it.
    query: z.object({ confirm: z.string().default("") }),
  },
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: z.object({ deleted: z.literal(true) }) } },
    },
    400: errorResponse("The confirmation doesn't match"),
    401: errorResponse("Not signed in"),
    403: errorResponse("Only a team's owners can delete its studies"),
    404: errorResponse("No such study on this researcher's teams"),
    409: errorResponse("It isn't archived, or it has data that's kept"),
  },
});

export function createArchiveRoutes({ db, storage }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  const access = async (c: Parameters<typeof researcherFromRequest>[0], studyId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return null;
    }
    const role = await roleOnStudy(db, researcher.id, studyId);
    const [study] = role
      ? await db.select().from(schema.studies).where(eq(schema.studies.id, studyId))
      : [];
    return { researcher, role, study };
  };

  app.openapi(archiveRoute, async (c) => {
    const { studyId } = c.req.valid("param");
    const found = await access(c, studyId);
    if (!found) {
      return c.json(pleaseSignIn, 401);
    }
    if (!found.role || !found.study) {
      return c.json(notAvailable, 404);
    }
    if (found.role === "viewer") {
      return c.json({ error: "You can view this study, but not change it." }, 403);
    }
    const { archived } = c.req.valid("json");
    if (archived && found.study.liveVersionId) {
      return c.json({ error: "It's open to participants. Stop it before archiving it." }, 409);
    }
    await db
      .update(schema.studies)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(schema.studies.id, studyId));
    return c.json({ archived }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { studyId } = c.req.valid("param");
    const found = await access(c, studyId);
    if (!found) {
      return c.json(pleaseSignIn, 401);
    }
    if (!found.role || !found.study) {
      return c.json(notAvailable, 404);
    }
    if (found.role !== "owner") {
      return c.json({ error: "Only the team's owners can delete its studies." }, 403);
    }
    if (c.req.valid("query").confirm.trim() !== found.study.slug) {
      return c.json({ error: `Type ${found.study.slug} to confirm.` }, 400);
    }
    if (!found.study.archivedAt) {
      return c.json({ error: "Archive it first." }, 409);
    }
    const why = await whyNotDeletable(db, studyId);
    if (why) {
      return c.json({ error: why }, 409);
    }
    await deleteStudy(db, storage, studyId, found.researcher.name);
    return c.json({ deleted: true as const }, 200);
  });

  return app;
}
