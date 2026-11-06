import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { TEMPLATE_KEYS } from "@truman3/core";
import { schema } from "@truman3/db";
import {
  type DraftItem,
  draftToDefinition,
  loadDraft,
  type PackContents,
  type PackSummary,
  packContents,
  savePack,
  starterFor,
  startStudy,
} from "@truman3/drafts";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { mediaUrl } from "../feed/build.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const jsonBody = <T extends z.ZodType>(bodySchema: T) => ({
  body: { required: true, content: { "application/json": { schema: bodySchema } } },
});

const listRoute = createRoute({
  method: "get",
  path: "/admin/packs",
  summary: "The content packs this researcher can start from, and the teams they can start with",
  responses: {
    200: {
      description: "Packs for everyone on this server, and their teams' own",
      content: {
        "application/json": {
          schema: z.object({
            teams: z.array(z.object({ id: z.string(), name: z.string() })),
            packs: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                description: z.string(),
                team: z.string().nullable(),
                actors: z.number(),
                posts: z.number(),
                comments: z.number(),
                conditions: z.array(z.string()),
                targeted: z.number(),
                imageUrls: z.array(z.string()),
              }),
            ),
            /** Sample content for each kind of platform that has some. */
            starters: z.array(
              z.object({
                template: z.enum(TEMPLATE_KEYS),
                actors: z.number(),
                posts: z.number(),
                comments: z.number(),
                imageUrls: z.array(z.string()),
              }),
            ),
          }),
        },
      },
    },
    401: errorResponse("Not signed in"),
  },
});

const startRoute = createRoute({
  method: "post",
  path: "/admin/studies",
  summary: "Start a new study with a draft, from a pack or from nothing",
  request: jsonBody(
    z.object({
      teamId: z.uuid(),
      title: z.string().trim().min(1).max(200),
      slug: z
        .string()
        .regex(
          /^[a-z0-9][a-z0-9_-]*$/,
          "The link name can use lowercase letters, numbers, dashes, and underscores.",
        )
        .max(60),
      /** No default: this is a design decision for the researcher. */
      assignment: z.enum(["uniform", "blocked"]),
      packId: z.uuid().nullable(),
      /** Start with the sample content for this kind of platform, instead of a pack. */
      starter: z.boolean().optional(),
      keep: z.enum(["everything", "background"]).optional(),
      /** Which kind of platform. It can't change later. Leave out for the pack's, or else Classic. */
      template: z.enum(TEMPLATE_KEYS).optional(),
    }),
  ),
  responses: {
    200: {
      description: "The draft to work on",
      content: {
        "application/json": { schema: z.object({ studyId: z.string(), draftId: z.string() }) },
      },
    },
    400: errorResponse("That isn't valid"),
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can't start studies on that team"),
    404: errorResponse("No such pack"),
    409: errorResponse("That link name is taken"),
  },
});

const saveRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/pack",
  summary: "Save what's in a draft as a new pack for this team",
  request: {
    params: z.object({ draftId: z.uuid() }),
    ...jsonBody(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(500).optional(),
      }),
    ),
  },
  responses: {
    200: {
      description: "Saved, or the same pack already exists",
      content: {
        "application/json": {
          schema: z.object({
            status: z.enum(["saved", "exists"]),
            id: z.string(),
            name: z.string(),
          }),
        },
      },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can only view"),
    404: errorResponse("No such draft on this researcher's teams"),
  },
});

export function createPackRoutes({ db, mediaPublicUrl, storage }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };

  /** The teams this researcher can do more than view on. */
  const teamsFor = (researcherId: string) =>
    db
      .select({ id: schema.teams.id, name: schema.teams.name })
      .from(schema.teamMemberships)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMemberships.teamId))
      .where(
        and(
          eq(schema.teamMemberships.researcherId, researcherId),
          ne(schema.teamMemberships.role, "viewer"),
        ),
      );

  app.openapi(listRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }

    const teams = await teamsFor(researcher.id);
    const memberOf = await db
      .select({ id: schema.teamMemberships.teamId, name: schema.teams.name })
      .from(schema.teamMemberships)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMemberships.teamId))
      .where(eq(schema.teamMemberships.researcherId, researcher.id));

    const packs = await db
      .select({
        id: schema.contentPacks.id,
        name: schema.contentPacks.name,
        description: schema.contentPacks.description,
        teamId: schema.contentPacks.teamId,
        summary: schema.contentPacks.summary,
      })
      .from(schema.contentPacks)
      .where(
        or(
          isNull(schema.contentPacks.teamId),
          inArray(
            schema.contentPacks.teamId,
            memberOf.map(({ id }) => id),
          ),
        ),
      )
      .orderBy(desc(schema.contentPacks.createdAt));

    // A starter that can't be read is left out, rather than stopping anyone starting a study.
    const starters = (
      await Promise.all(
        TEMPLATE_KEYS.map(async (template) => {
          const found = await starterFor(storage, template).catch(() => null);
          return found ? [{ template, found }] : [];
        }),
      )
    ).flat();

    return c.json(
      {
        teams,
        starters: starters.map(({ template, found }) => ({
          template,
          actors: found.summary.actors,
          posts: found.summary.posts,
          comments: found.summary.comments,
          imageUrls: found.summary.images.map((image) => mediaUrl(image, mediaPublicUrl)),
        })),
        packs: packs.map(({ summary, teamId, ...pack }) => {
          const { images, ...counts } = summary as PackSummary;
          return {
            ...pack,
            ...counts,
            team: memberOf.find(({ id }) => id === teamId)?.name ?? null,
            imageUrls: images.map((image) => mediaUrl(image, mediaPublicUrl)),
          };
        }),
      },
      200,
    );
  });

  app.openapi(startRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { teamId, title, slug, assignment, packId, keep, template, starter } =
      c.req.valid("json");

    const teams = await teamsFor(researcher.id);
    if (!teams.some(({ id }) => id === teamId)) {
      return c.json({ error: "You can't start studies on that team." }, 403);
    }

    let pack: { id: string; name: string; contents: PackContents } | undefined;
    if (starter) {
      const found = await starterFor(storage, template ?? "classic");
      if (!found) {
        return c.json({ error: "There's no sample content for that kind of platform." }, 404);
      }
      pack = found;
    } else if (packId) {
      const [row] = await db
        .select()
        .from(schema.contentPacks)
        .where(
          and(
            eq(schema.contentPacks.id, packId),
            or(isNull(schema.contentPacks.teamId), eq(schema.contentPacks.teamId, teamId)),
          ),
        );
      if (!row) {
        return c.json({ error: "That pack isn't available." }, 404);
      }
      pack = { id: row.id, name: row.name, contents: row.contents as PackContents };
    }

    const result = await startStudy(db, {
      teamId,
      researcherId: researcher.id,
      slug,
      title,
      assignment,
      pack,
      keep,
      template,
    });
    if ("problem" in result) {
      return c.json({ error: result.message }, 409);
    }
    return c.json(result, 200);
  });

  app.openapi(saveRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { draftId } = c.req.valid("param");
    const loaded = await loadDraft(db, draftId);
    const role = loaded ? await roleOnStudy(db, researcher.id, loaded.draft.studyId) : null;
    if (!loaded || !role) {
      return c.json({ error: "That isn't available." }, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "You can only view this study." }, 403);
    }

    const [study] = await db
      .select({ teamId: schema.studies.teamId })
      .from(schema.studies)
      .where(eq(schema.studies.id, loaded.draft.studyId));

    const { definition, mediaKeys, provenance } = draftToDefinition(
      loaded.settings,
      loaded.pages,
      loaded.items as DraftItem[],
    );
    const { name, description } = c.req.valid("json");
    const saved = await savePack(db, {
      teamId: study?.teamId ?? null,
      name,
      ...(description ? { description } : {}),
      createdBy: researcher.id,
      contents: packContents(definition, mediaKeys, provenance),
    });
    return c.json(saved, 200);
  });

  return app;
}
