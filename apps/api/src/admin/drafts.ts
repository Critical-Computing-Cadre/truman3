import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { feedResponseSchema, platformStyleFor } from "@truman3/core";
import { schema } from "@truman3/db";
import {
  type ActorData,
  type CommentData,
  checkDraft,
  createItem,
  deleteItem,
  freezeDraft,
  type LoadedDraft,
  loadDraft,
  openDraft,
  type PostData,
  type Provenance,
  updateItem,
} from "@truman3/drafts";
import { feedSettingsFor } from "@truman3/feed";
import { eq } from "drizzle-orm";
import type { FeedActor, FeedContent } from "../feed/build.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { previewContent } from "./preview.ts";
import { researcherFromRequest } from "./session.ts";

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

const draftParams = z.object({ draftId: z.uuid() });
const itemParams = draftParams.extend({ itemId: z.uuid() });

const commonErrors = {
  401: errorResponse("Not signed in"),
  403: errorResponse("This researcher can only view"),
  404: errorResponse("No such draft or item on this researcher's teams"),
};

const jsonBody = <T extends z.ZodType>(bodySchema: T) => ({
  body: { required: true, content: { "application/json": { schema: bodySchema } } },
});

const openRoute = createRoute({
  method: "post",
  path: "/admin/versions/{versionId}/draft",
  summary: "Open the study's draft, starting one from this version if there isn't one",
  request: { params: z.object({ versionId: z.uuid() }) },
  responses: {
    200: {
      description: "The draft to edit",
      content: {
        "application/json": { schema: z.object({ draftId: z.string(), created: z.boolean() }) },
      },
    },
    ...commonErrors,
  },
});

const infoRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}",
  summary: "A draft's details, and any problems with it",
  request: { params: draftParams },
  responses: {
    200: {
      description: "What's needed to edit it",
      content: {
        "application/json": {
          schema: z.object({
            title: z.string(),
            slug: z.string(),
            canEdit: z.boolean(),
            closed: z.boolean(),
            lengthMs: z.number(),
            conditions: z.array(
              z.object({
                key: z.string(),
                ranker: z.string(),
                windowHours: z.number().nullable(),
                platformStyle: z.string(),
              }),
            ),
            actors: z.array(z.object({ id: z.string(), username: z.string(), name: z.string() })),
            posts: z.array(z.object({ offsetMs: z.number(), conditions: z.array(z.string()) })),
            issues: z.array(
              z.object({ severity: z.enum(["error", "warning"]), message: z.string() }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const previewRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}/preview",
  summary: "The feed as the draft stands now, in a condition, at a point in the study",
  request: {
    params: draftParams,
    query: z.object({
      condition: z.string().min(1),
      elapsedMs: z.coerce.number().int().nonnegative(),
    }),
  },
  responses: {
    200: {
      description: "The feed, as participants would see it, plus what's needed to edit each item",
      content: {
        "application/json": {
          schema: feedResponseSchema.extend({
            targeting: z.record(z.string(), z.array(z.string())),
            items: z.record(
              z.string(),
              z.object({
                actorId: z.string(),
                timeMs: z.number(),
                conditions: z.array(z.string()),
                likes: z.number(),
                origin: z.string(),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const fieldsSchema = z.strictObject({
  body: z.string().max(5000).optional(),
  actorId: z.uuid().optional(),
  postId: z.uuid().optional(),
  timeMs: z.number().int().optional(),
  likes: z.number().int().nonnegative().optional(),
  conditions: z.array(z.string()).optional(),
});

const createItemRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/items",
  summary: "Add a post or comment",
  request: {
    params: draftParams,
    ...jsonBody(z.object({ kind: z.enum(["post", "comment"]), fields: fieldsSchema })),
  },
  responses: {
    200: {
      description: "Added",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    400: errorResponse("It isn't complete or valid"),
    409: errorResponse("The draft is already saved as a version"),
    ...commonErrors,
  },
});

const updateItemRoute = createRoute({
  method: "patch",
  path: "/admin/drafts/{draftId}/items/{itemId}",
  summary: "Change an item. It saves right away, and the change goes in its history",
  request: { params: itemParams, ...jsonBody(z.object({ changes: fieldsSchema })) },
  responses: {
    200: {
      description: "Saved",
      content: { "application/json": { schema: z.object({ revision: z.number() }) } },
    },
    400: errorResponse("The change isn't valid"),
    409: errorResponse("The draft is already saved as a version"),
    ...commonErrors,
  },
});

const deleteItemRoute = createRoute({
  method: "delete",
  path: "/admin/drafts/{draftId}/items/{itemId}",
  summary: "Remove an item, and any comments on it",
  request: { params: itemParams },
  responses: {
    200: {
      description: "Removed",
      content: { "application/json": { schema: z.object({ deleted: z.number() }) } },
    },
    409: errorResponse("It's still in use, or the draft is already saved"),
    ...commonErrors,
  },
});

const freezeRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/freeze",
  summary: "Save the draft as a new version, which new participants will get",
  request: { params: draftParams },
  responses: {
    200: {
      description: "Saved, or nothing had changed",
      content: {
        "application/json": {
          schema: z.object({
            status: z.enum(["frozen", "unchanged"]),
            version: z.number(),
          }),
        },
      },
    },
    400: errorResponse("It has problems that need fixing first"),
    409: errorResponse("The draft is already saved as a version"),
    ...commonErrors,
  },
});

/** A draft's items in the shape the feed expects, so drafts and frozen versions look the same. */
function asFeedContent(items: LoadedDraft["items"]): FeedContent[] {
  return items
    .filter((item) => item.kind === "post" || item.kind === "comment")
    .map((item) => {
      const data = item.data as PostData & Partial<CommentData>;
      return {
        id: item.id,
        kind: item.kind,
        parentId: data.postId ?? null,
        authorActorId: data.actorId,
        body: data.body,
        mediaKey: data.picture ?? null,
        offsetMs: data.timeMs,
        visibleAt: null,
        position: item.position,
        baseLikes: data.likes,
        conditions: data.conditions,
      };
    });
}

export function createDraftRoutes({ db, mediaPublicUrl }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };
  const viewOnly = { error: "You can view this study, but not change it." };

  /** A draft and this researcher's role on it. Team access is checked here for every route. */
  const access = async (researcherId: string, draftId: string) => {
    const loaded = await loadDraft(db, draftId);
    if (!loaded) {
      return null;
    }
    const role = await roleOnStudy(db, researcherId, loaded.draft.studyId);
    return role ? { loaded, role, canEdit: role !== "viewer" } : null;
  };

  /** Handles what every editing route starts with. Returns a response, or who and what to edit. */
  const forEditing = async (c: Parameters<typeof researcherFromRequest>[0], draftId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return { failure: [pleaseSignIn, 401] as const };
    }
    const found = await access(researcher.id, draftId);
    if (!found) {
      return { failure: [notAvailable, 404] as const };
    }
    if (!found.canEdit) {
      return { failure: [viewOnly, 403] as const };
    }
    return { researcher, loaded: found.loaded };
  };

  app.openapi(openRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { versionId } = c.req.valid("param");
    const [version] = await db
      .select({ studyId: schema.studyVersions.studyId })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    const role = version ? await roleOnStudy(db, researcher.id, version.studyId) : null;
    if (!role) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json(viewOnly, 403);
    }

    const opened = await openDraft(db, versionId, researcher.id);
    return opened ? c.json(opened, 200) : c.json(notAvailable, 404);
  });

  app.openapi(infoRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const found = await access(researcher.id, c.req.valid("param").draftId);
    if (!found) {
      return c.json(notAvailable, 404);
    }

    const { loaded, canEdit } = found;
    const { settings, items, draft } = loaded;
    return c.json(
      {
        title: settings.title,
        slug: settings.slug,
        canEdit: canEdit && draft.closedAt === null,
        closed: draft.closedAt !== null,
        lengthMs: settings.length.days * 24 * 3_600_000,
        conditions: settings.conditions.arms.map(({ key }) => {
          const feed = feedSettingsFor(settings, key);
          return {
            key,
            ranker: feed.ranker,
            windowHours: feed.windowHours ?? null,
            platformStyle: platformStyleFor(settings, key),
          };
        }),
        actors: items
          .filter((item) => item.kind === "actor")
          .map((item) => {
            const data = item.data as ActorData;
            return { id: item.id, username: data.username, name: data.name };
          }),
        posts: items
          .filter((item) => item.kind === "post")
          .map((item) => {
            const data = item.data as PostData;
            return { offsetMs: data.timeMs, conditions: data.conditions };
          }),
        issues: checkDraft(loaded).map(({ severity, message }) => ({ severity, message })),
      },
      200,
    );
  });

  app.openapi(previewRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const found = await access(researcher.id, c.req.valid("param").draftId);
    const { condition, elapsedMs } = c.req.valid("query");
    if (!found?.loaded.settings.conditions.arms.some(({ key }) => key === condition)) {
      return c.json(notAvailable, 404);
    }

    const { items, settings } = found.loaded;
    const actors = new Map<string, FeedActor>(
      items
        .filter((item) => item.kind === "actor")
        .map((item) => {
          const { username, name, picture } = item.data as ActorData;
          return [item.id, { id: item.id, username, profile: { name, picture } }];
        }),
    );

    // A draft has no seed of its own yet, and a shuffled preview only needs to be stable.
    const preview = await previewContent(
      asFeedContent(items),
      async () => actors,
      mediaPublicUrl,
      { seed: 1, settings },
      condition,
      elapsedMs,
    );

    const details: Record<
      string,
      { actorId: string; timeMs: number; conditions: string[]; likes: number; origin: string }
    > = {};
    for (const item of items) {
      if (item.kind === "post" || item.kind === "comment") {
        const data = item.data as PostData;
        details[item.id] = {
          actorId: data.actorId,
          timeMs: data.timeMs,
          conditions: data.conditions,
          likes: data.likes,
          origin: (item.provenance as Provenance).origin,
        };
      }
    }

    return c.json({ ...preview, items: details }, 200);
  });

  const stripUndefined = (fields: z.infer<typeof fieldsSchema>) =>
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

  app.openapi(createItemRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const editing = await forEditing(c, draftId);
    if ("failure" in editing) {
      const [body, status] = editing.failure;
      return c.json(body, status);
    }

    const { kind, fields } = c.req.valid("json");
    const result = await createItem(
      db,
      draftId,
      editing.researcher.id,
      kind,
      stripUndefined(fields),
    );
    if ("problem" in result) {
      return c.json({ error: result.message }, result.problem === "closed" ? 409 : 400);
    }
    return c.json(result, 200);
  });

  app.openapi(updateItemRoute, async (c) => {
    const { draftId, itemId } = c.req.valid("param");
    const editing = await forEditing(c, draftId);
    if ("failure" in editing) {
      const [body, status] = editing.failure;
      return c.json(body, status);
    }

    const result = await updateItem(
      db,
      draftId,
      itemId,
      editing.researcher.id,
      stripUndefined(c.req.valid("json").changes),
    );
    if ("problem" in result) {
      if (result.problem === "not-found") {
        return c.json({ error: result.message }, 404);
      }
      return c.json({ error: result.message }, result.problem === "closed" ? 409 : 400);
    }
    return c.json(result, 200);
  });

  app.openapi(deleteItemRoute, async (c) => {
    const { draftId, itemId } = c.req.valid("param");
    const editing = await forEditing(c, draftId);
    if ("failure" in editing) {
      const [body, status] = editing.failure;
      return c.json(body, status);
    }

    const result = await deleteItem(db, draftId, itemId, editing.researcher.id);
    if ("problem" in result) {
      return c.json({ error: result.message }, result.problem === "not-found" ? 404 : 409);
    }
    return c.json(result, 200);
  });

  app.openapi(freezeRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const editing = await forEditing(c, draftId);
    if ("failure" in editing) {
      const [body, status] = editing.failure;
      return c.json(body, status);
    }
    if (editing.loaded.draft.closedAt) {
      return c.json({ error: "This draft has already been saved as a version." }, 409);
    }

    const result = await freezeDraft(db, editing.loaded);
    if (result.status === "invalid") {
      const errors = result.issues.filter(({ severity }) => severity === "error");
      return c.json({ error: errors.map(({ message }) => message).join(" ") }, 400);
    }
    return c.json({ status: result.status, version: result.version }, 200);
  });

  return app;
}
