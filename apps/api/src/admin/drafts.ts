import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import {
  ACCENT_PATTERN,
  feedResponseSchema,
  flairSchema,
  linkSchema,
  MAX_ATTACHMENTS,
  MAX_LABEL_LENGTH,
  MAX_PLACE_LENGTH,
  MAX_RULE_MATCH_LENGTH,
  MAX_TITLE_LENGTH,
  PIN_PLACES,
  POST_TAGS,
  type Poll,
  platformFor,
  pollSchema,
} from "@truman3/core";
import { schema } from "@truman3/db";
import {
  type ActorData,
  type AppealAnswerData,
  type AutoRuleData,
  type BanData,
  type CommentData,
  type ContextNoteData,
  checkDraft,
  createItem,
  deleteItem,
  type FlagAnswerData,
  freezeDraft,
  frozenSpaceKeys,
  type LabelData,
  type LoadedDraft,
  listChanges,
  loadDraft,
  moveItem,
  openDraft,
  type PostData,
  type Provenance,
  pageSection,
  type ReactionData,
  type RemovalData,
  type ReportAnswerData,
  recordPresence,
  SETTINGS_SECTIONS,
  type SectionName,
  type SpaceData,
  STORED_IMAGE,
  type StoryData,
  saveSection,
  sectionValue,
  undoChange,
  updateItem,
} from "@truman3/drafts";
import { feedSettingsFor } from "@truman3/feed";
import { eq } from "drizzle-orm";
import { MAX_IMAGE_BYTES, storeStudyImage } from "../actions/images.ts";
import { type FeedActor, type FeedContent, mediaUrl } from "../feed/build.ts";
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
                commentBox: z.string(),
                layout: z.string(),
                features: z.record(z.string(), z.boolean()),
              }),
            ),
            actors: z.array(
              z.object({
                id: z.string(),
                username: z.string(),
                name: z.string(),
                bio: z.string(),
                location: z.string(),
                pictureUrl: z.string().nullable(),
                usedBy: z.number(),
              }),
            ),
            posts: z.array(
              z.object({
                id: z.string(),
                offsetMs: z.number(),
                conditions: z.array(z.string()),
                body: z.string(),
                authorName: z.string(),
                imageUrl: z.string().nullable(),
              }),
            ),
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

const sectionStateSchema = z.object({ revision: z.number(), value: z.unknown() });

const settingsRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}/settings",
  summary: "A draft's settings and pages, by section",
  request: { params: draftParams },
  responses: {
    200: {
      description: "Each section, with the revision to send back when saving it",
      content: {
        "application/json": {
          schema: z.object({
            title: z.string(),
            slug: z.string(),
            canEdit: z.boolean(),
            sections: z.record(z.string(), sectionStateSchema),
            pages: z.record(z.string(), z.object({ revision: z.number(), text: z.string() })),
            issues: z.array(
              z.object({
                severity: z.enum(["error", "warning"]),
                message: z.string(),
                /** Where it is, such as beats.yaml, when it's in one file. */
                file: z.string().optional(),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const saveSettingsRoute = createRoute({
  method: "put",
  path: "/admin/drafts/{draftId}/settings",
  summary: "Save one section of settings, or one page",
  request: {
    params: draftParams,
    ...jsonBody(
      z.object({
        section: z.string(),
        value: z.unknown(),
        baseRevision: z.number().int().nonnegative(),
        renames: z.record(z.string(), z.string()).optional(),
      }),
    ),
  },
  responses: {
    200: {
      description: "Saved",
      content: { "application/json": { schema: z.object({ revision: z.number() }) } },
    },
    400: errorResponse("That isn't valid"),
    409: errorResponse("Someone else saved it first, the draft is closed, or it's in use"),
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
                ups: z.number(),
                downs: z.number(),
                pictures: z.array(z.string()),
                spaceId: z.string().nullable(),
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
  /** A post's title. Null removes it. */
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).nullable().optional(),
  /** Where a post links to. Null removes it. */
  link: linkSchema.nullable().optional(),
  pinnedOn: z.array(z.enum(PIN_PLACES)).optional(),
  locked: z.boolean().optional(),
  tags: z.array(z.enum(POST_TAGS)).optional(),
  /** A post's poll. Null removes it. */
  poll: pollSchema.nullable().optional(),
  /** A post's label. Null removes it. */
  flair: z.string().min(1).nullable().optional(),
  /** The post this is a crosspost of. Null makes it an ordinary post. */
  crosspostOfId: z.uuid().nullable().optional(),
  /** The post this passes along or quotes. Null makes it an ordinary post. */
  repostOfId: z.uuid().nullable().optional(),
  quoteOfId: z.uuid().nullable().optional(),
  reposts: z.number().int().nonnegative().optional(),
  quotes: z.number().int().nonnegative().optional(),
  /** Marks it as an ad, with this label. Null makes it an ordinary post. */
  ad: z.string().trim().min(1).max(40).nullable().optional(),
  views: z.number().int().nonnegative().optional(),
  /** Someone in the cast who liked a post. Null takes them away. */
  likedById: z.uuid().nullable().optional(),
  /** Where a post says it was. Null takes it away. */
  place: z.string().trim().min(1).max(MAX_PLACE_LENGTH).nullable().optional(),
  /** People in the cast tagged in a post. */
  taggedIds: z.array(z.uuid()).optional(),
  /** Whether a post tags whoever is taking part. */
  tagsParticipant: z.boolean().optional(),
  caption: z.string().max(500).nullable().optional(),
  lastsHours: z.number().positive().nullable().optional(),
  /** The highlight that keeps a story on its poster's profile. Null takes it out. */
  highlight: z.string().trim().min(1).max(40).nullable().optional(),
  closeFriends: z.boolean().optional(),
  helpful: z.number().int().nonnegative().optional(),
  notHelpful: z.number().int().nonnegative().optional(),
  /** Someone in the cast's flair in each space, by the space's ID. */
  spaceFlair: z.record(z.uuid(), z.string()).optional(),
  postFlair: z.array(flairSchema).optional(),
  userFlair: z.array(flairSchema).optional(),
  requirePostFlair: z.boolean().optional(),
  /** Null removes the image. */
  picture: z.string().regex(STORED_IMAGE).nullable().optional(),
  /** A post's photos, in order. Anything new has to be stored here (see updateItem). */
  pictures: z.array(z.string().max(2000)).max(MAX_ATTACHMENTS).optional(),
  actorId: z.uuid().optional(),
  postId: z.uuid().optional(),
  replyToId: z.uuid().optional(),
  timeMs: z.number().int().optional(),
  likes: z.number().int().nonnegative().optional(),
  ups: z.number().int().nonnegative().optional(),
  downs: z.number().int().nonnegative().optional(),
  conditions: z.array(z.string()).optional(),
  // For a moderator's decisions, as well as actorId, timeMs, body, and conditions above.
  on: z.enum(["post", "comment", "both"]).nullable().optional(),
  targetId: z.uuid().nullable().optional(),
  /** Null gives no reason. */
  reason: z.string().trim().min(1).max(2000).nullable().optional(),
  nth: z.number().int().nonnegative().optional(),
  type: z.enum(["remove", "warn", "label"]).optional(),
  /** A label's text, such as "Spam". */
  label: z.string().trim().min(1).max(MAX_LABEL_LENGTH).optional(),
  /** Whether a label covers what it's on until someone presses Show. */
  hides: z.boolean().optional(),
  afterMs: z.number().int().nonnegative().optional(),
  /** A flag's answer. It's for any flag without `targetId`, and null takes one away. */
  action: z
    .enum(["remove", "answer", "ban", "confirm", "warn", "hold", "uphold", "restore"])
    .optional(),
  /** What an automatic rule looks for. */
  match: z.string().trim().min(1).max(MAX_RULE_MATCH_LENGTH).optional(),
  /** How a hold ends. Null is approved. */
  holdOutcome: z.enum(["approve", "remove"]).nullable().optional(),
  bannedActorId: z.uuid().optional(),
  /** Who a report's answer is for. Null makes it for any report. */
  reportedActorId: z.uuid().nullable().optional(),
  message: z.string().trim().min(1).max(2000).nullable().optional(),
  // For people in the cast.
  name: z.string().trim().min(1).max(100).optional(),
  username: z.string().trim().max(30).optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(100).optional(),
  moderator: z.boolean().optional(),
  karma: z.number().int().optional(),
  followers: z.number().int().nonnegative().optional(),
  following: z.number().int().nonnegative().optional(),
  startsFollowed: z.union([z.boolean(), z.array(z.string())]).optional(),
  /** Null takes it away. */
  badge: z.string().trim().min(1).max(40).nullable().optional(),
  suggested: z.boolean().optional(),
  // For spaces, as well as name and conditions above. Null removes a post from its space.
  spaceId: z.uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  rules: z.string().max(5000).nullable().optional(),
  startsJoined: z.boolean().optional(),
  members: z.number().int().nonnegative().nullable().optional(),
  banner: z.string().regex(STORED_IMAGE).nullable().optional(),
  accent: z.string().regex(ACCENT_PATTERN).nullable().optional(),
  /** Part of a space's address. */
  key: z.string().trim().min(1).max(100).optional(),
});

const uploadRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/images",
  summary: "Upload an image to use in this draft",
  request: {
    params: draftParams,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            image: z.instanceof(File).openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Stored. Set it as a post's picture to use it",
      content: {
        "application/json": { schema: z.object({ picture: z.string(), url: z.string() }) },
      },
    },
    400: errorResponse("It isn't a usable image"),
    ...commonErrors,
  },
});

const createItemRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/items",
  summary: "Add a post, comment, or person in the cast",
  request: {
    params: draftParams,
    ...jsonBody(
      z.object({
        kind: z.enum([
          "post",
          "comment",
          "actor",
          "space",
          "removal",
          "label",
          "reaction",
          "flagAnswer",
          "ban",
          "reportAnswer",
          "autoRule",
          "appealAnswer",
          "contextNote",
          "story",
        ]),
        fields: fieldsSchema,
      }),
    ),
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

const moveItemRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/items/{itemId}/move",
  summary: "Change when a post appears. Its comments move with it",
  request: { params: itemParams, ...jsonBody(z.object({ timeMs: z.number().int() })) },
  responses: {
    200: {
      description: "Moved",
      content: { "application/json": { schema: z.object({ moved: z.number() }) } },
    },
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

const presenceRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/presence",
  summary: "Say you're here, and find out who else is, and whether anything has changed",
  request: {
    params: draftParams,
    ...jsonBody(z.object({ itemId: z.uuid().nullable(), section: z.string().nullish() })),
  },
  responses: {
    200: {
      description: "Who else is here, and a number that goes up when anything in the draft changes",
      content: {
        "application/json": {
          schema: z.object({
            latestChange: z.number(),
            others: z.array(
              z.object({
                name: z.string(),
                itemId: z.string().nullable(),
                section: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const changesRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}/changes",
  summary: "Recent changes to the draft, and who made them",
  request: { params: draftParams },
  responses: {
    200: {
      description: "Newest first",
      content: {
        "application/json": {
          schema: z.object({
            changes: z.array(
              z.object({
                changeId: z.string(),
                who: z.string(),
                mine: z.boolean(),
                action: z.string(),
                summary: z.string(),
                at: z.iso.datetime(),
                canUndo: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const undoRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/changes/{changeId}/undo",
  summary: "Undo a change",
  request: { params: draftParams.extend({ changeId: z.uuid() }) },
  responses: {
    200: {
      description: "Undone. That goes in the history too",
      content: { "application/json": { schema: z.object({ undone: z.number() }) } },
    },
    409: errorResponse("Someone has changed it since, or it can't be undone"),
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
        parentId: data.replyToId ?? data.postId ?? null,
        spaceId: data.spaceId ?? null,
        authorActorId: data.actorId,
        title: data.title ?? null,
        linkUrl: data.link ?? null,
        pinnedOn: data.pinnedOn ?? [],
        locked: data.locked ?? false,
        tags: data.tags ?? [],
        poll: data.poll ?? null,
        flair: data.flair ?? null,
        crosspostOf: data.crosspostOfId ?? null,
        repostOf: data.repostOfId ?? null,
        quoteOf: data.quoteOfId ?? null,
        baseReposts: data.reposts ?? 0,
        baseQuotes: data.quotes ?? 0,
        adLabel: data.ad ?? null,
        likedByActorId: data.likedById ?? null,
        place: data.place ?? null,
        taggedActorIds: data.taggedIds ?? [],
        tagsParticipant: data.tagsParticipant ?? false,
        baseViews: data.views ?? 0,
        body: data.body,
        attachments: (data.pictures ?? []).map((key) => ({ type: "image" as const, key })),
        offsetMs: data.timeMs,
        visibleAt: null,
        position: item.position,
        baseLikes: data.likes,
        baseUps: data.ups ?? 0,
        baseDowns: data.downs ?? 0,
        conditions: data.conditions,
      };
    });
}

export function createDraftRoutes({ db, storage, mediaPublicUrl }: ParticipantRouteDependencies) {
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
    const frozenKeys = await frozenSpaceKeys(db, draft.studyId);
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
            ...platformFor(settings, key),
          };
        }),
        actors: items
          .filter((item) => item.kind === "actor")
          .map((item) => {
            const data = item.data as ActorData;
            const usedBy = items.filter((other) => {
              const { actorId, bannedActorId, reportedActorId } = other.data as {
                actorId?: string;
                bannedActorId?: string;
                reportedActorId?: string;
              };
              return [actorId, bannedActorId, reportedActorId].includes(item.id);
            }).length;
            return {
              id: item.id,
              username: data.username,
              name: data.name,
              bio: data.bio ?? "",
              location: data.location ?? "",
              pictureUrl: data.picture ? mediaUrl(data.picture, mediaPublicUrl) : null,
              bannerUrl: data.banner ? mediaUrl(data.banner, mediaPublicUrl) : null,
              moderator: data.moderator ?? false,
              karma: data.karma ?? 0,
              followers: data.followers ?? 0,
              following: data.following ?? 0,
              startsFollowed: data.startsFollowed ?? false,
              badge: data.badge ?? "",
              suggested: data.suggested ?? false,
              spaceFlair: data.spaceFlair ?? {},
              usedBy,
            };
          }),
        spaces: items
          .filter((item) => item.kind === "space")
          .map((item) => {
            const data = item.data as SpaceData;
            return {
              id: item.id,
              key: data.key,
              name: data.name,
              description: data.description ?? "",
              rules: data.rules ?? "",
              startsJoined: data.startsJoined,
              members: data.members ?? null,
              postFlair: data.postFlair ?? [],
              userFlair: data.userFlair ?? [],
              requirePostFlair: data.requirePostFlair ?? false,
              pictureUrl: data.picture ? mediaUrl(data.picture, mediaPublicUrl) : null,
              bannerUrl: data.banner ? mediaUrl(data.banner, mediaPublicUrl) : null,
              accent: data.accent ?? null,
              keyLocked: frozenKeys.has(data.key),
              conditions: data.conditions,
              usedBy: items.filter(
                (other) => (other.data as { spaceId?: string }).spaceId === item.id,
              ).length,
            };
          }),
        posts: items
          .filter((item) => item.kind === "post")
          .map((item) => {
            const data = item.data as PostData;
            const author = items.find(({ id }) => id === data.actorId)?.data as
              | ActorData
              | undefined;
            return {
              id: item.id,
              offsetMs: data.timeMs,
              conditions: data.conditions,
              body: data.body,
              title: data.title ?? null,
              crosspostOfId: data.crosspostOfId ?? null,
              repostOfId: data.repostOfId ?? null,
              quoteOfId: data.quoteOfId ?? null,
              authorName: author?.name ?? "",
              imageUrl: data.pictures?.[0] ? mediaUrl(data.pictures[0], mediaPublicUrl) : null,
            };
          }),
        comments: items
          .filter((item) => item.kind === "comment")
          .map((item) => {
            const data = item.data as CommentData;
            const author = items.find(({ id }) => id === data.actorId)?.data as
              | ActorData
              | undefined;
            return {
              id: item.id,
              offsetMs: data.timeMs,
              body: data.body,
              authorName: author?.name ?? "",
            };
          }),
        removals: items
          .filter((item) => item.kind === "removal")
          .map((item) => {
            const data = item.data as RemovalData;
            return {
              id: item.id,
              on: data.on,
              targetId: data.targetId,
              actorId: data.actorId,
              timeMs: data.timeMs,
              reason: data.reason ?? "",
              conditions: data.conditions,
            };
          }),
        labels: items
          .filter((item) => item.kind === "label")
          .map((item) => {
            const data = item.data as LabelData;
            return {
              id: item.id,
              on: data.on,
              targetId: data.targetId,
              actorId: data.actorId,
              timeMs: data.timeMs,
              label: data.label,
              hides: data.hides,
              reason: data.reason ?? "",
              conditions: data.conditions,
            };
          }),
        stories: items
          .filter((item) => item.kind === "story")
          .map((item) => {
            const data = item.data as StoryData;
            return {
              id: item.id,
              actorId: data.actorId,
              pictureUrl: data.picture ? mediaUrl(data.picture, mediaPublicUrl) : null,
              caption: data.caption ?? "",
              timeMs: data.timeMs,
              lastsHours: data.lastsHours ?? null,
              highlight: data.highlight ?? null,
              closeFriends: data.closeFriends ?? false,
              conditions: data.conditions,
            };
          }),
        contextNotes: items
          .filter((item) => item.kind === "contextNote")
          .map((item) => {
            const data = item.data as ContextNoteData;
            return {
              id: item.id,
              targetId: data.targetId,
              body: data.body,
              timeMs: data.timeMs,
              helpful: data.helpful ?? 0,
              notHelpful: data.notHelpful ?? 0,
              conditions: data.conditions,
            };
          }),
        autoRules: items
          .filter((item) => item.kind === "autoRule")
          .sort((a, b) => a.position - b.position)
          .map((item) => {
            const data = item.data as AutoRuleData;
            return {
              id: item.id,
              on: data.on,
              match: data.match,
              action: data.action,
              actorId: data.actorId,
              afterMs: data.afterMs,
              message: data.message ?? "",
              holdOutcome: data.holdOutcome ?? "approve",
              conditions: data.conditions,
            };
          }),
        appealAnswers: items
          .filter((item) => item.kind === "appealAnswer")
          .sort((a, b) => a.position - b.position)
          .map((item) => {
            const data = item.data as AppealAnswerData;
            return {
              id: item.id,
              action: data.action,
              actorId: data.actorId,
              afterMs: data.afterMs,
              message: data.message ?? "",
              conditions: data.conditions,
            };
          }),
        bans: items
          .filter((item) => item.kind === "ban")
          .map((item) => {
            const data = item.data as BanData;
            return {
              id: item.id,
              bannedActorId: data.bannedActorId,
              actorId: data.actorId,
              timeMs: data.timeMs,
              reason: data.reason ?? "",
              spaceId: data.spaceId ?? null,
              conditions: data.conditions,
            };
          }),
        reportAnswers: items
          .filter((item) => item.kind === "reportAnswer")
          .map((item) => {
            const data = item.data as ReportAnswerData;
            return {
              id: item.id,
              reportedActorId: data.reportedActorId ?? null,
              action: data.action,
              actorId: data.actorId,
              afterMs: data.afterMs,
              message: data.message ?? "",
              conditions: data.conditions,
            };
          }),
        flagAnswers: items
          .filter((item) => item.kind === "flagAnswer")
          .map((item) => {
            const data = item.data as FlagAnswerData;
            return {
              id: item.id,
              on: data.on ?? null,
              targetId: data.targetId ?? null,
              action: data.action,
              actorId: data.actorId,
              afterMs: data.afterMs,
              message: data.message ?? "",
              conditions: data.conditions,
            };
          }),
        // Only a moderator's, since other reactions don't have a screen yet.
        moderatorReactions: items
          .filter(
            (item) =>
              item.kind === "reaction" &&
              ["remove", "warn", "label"].includes((item.data as ReactionData).type),
          )
          .map((item) => {
            const data = item.data as ReactionData;
            return {
              id: item.id,
              on: data.on,
              nth: data.nth,
              type: data.type as "remove" | "warn" | "label",
              actorId: data.actorId,
              afterMs: data.afterMs,
              body: data.body ?? "",
              conditions: data.conditions,
            };
          }),
        issues: checkDraft(loaded).map(({ severity, message }) => ({ severity, message })),
      },
      200,
    );
  });

  app.openapi(settingsRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const found = await access(researcher.id, c.req.valid("param").draftId);
    if (!found) {
      return c.json(notAvailable, 404);
    }

    const { loaded, canEdit } = found;
    const { settings, pages, sections, draft } = loaded;
    return c.json(
      {
        title: settings.title,
        slug: settings.slug,
        canEdit: canEdit && draft.closedAt === null,
        sections: Object.fromEntries(
          (Object.keys(SETTINGS_SECTIONS) as SectionName[]).map((section) => [
            section,
            {
              revision: sections.get(section)?.revision ?? 0,
              value: sectionValue(settings, section),
            },
          ]),
        ),
        pages: Object.fromEntries(
          Object.entries(pages).map(([key, text]) => [
            key,
            { revision: sections.get(pageSection(key))?.revision ?? 0, text },
          ]),
        ),
        issues: checkDraft(loaded).map(({ severity, message, file }) => ({
          severity,
          message,
          ...(file ? { file } : {}),
        })),
      },
      200,
    );
  });

  app.openapi(saveSettingsRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const editing = await forEditing(c, draftId);
    if ("failure" in editing) {
      const [body, status] = editing.failure;
      return c.json(body, status);
    }

    const { section, value, baseRevision, renames } = c.req.valid("json");
    const result = await saveSection(db, draftId, editing.researcher.id, {
      section,
      value,
      baseRevision,
      ...(renames ? { renames } : {}),
    });
    if ("problem" in result) {
      if (result.problem === "not-found") {
        return c.json({ error: result.message }, 404);
      }
      return c.json({ error: result.message }, result.problem === "invalid" ? 400 : 409);
    }
    return c.json(result, 200);
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
    const spaceKeyOf = new Map(
      items
        .filter((item) => item.kind === "space")
        .map((item) => [item.id, (item.data as SpaceData).key]),
    );
    const actors = new Map<string, FeedActor>(
      items
        .filter((item) => item.kind === "actor")
        .map((item) => {
          const { username, name, picture, moderator, karma, spaceFlair, badge } =
            item.data as ActorData;
          const flair = Object.entries(spaceFlair ?? {}).map(([spaceId, text]) => [
            spaceKeyOf.get(spaceId) ?? spaceId,
            text,
          ]);
          return [
            item.id,
            {
              id: item.id,
              username,
              profile: {
                name,
                picture,
                moderator,
                karma,
                badge,
                spaceFlair: Object.fromEntries(flair),
              },
            },
          ];
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
      items
        .filter((item) => item.kind === "space")
        .map((item) => {
          const { key, name, conditions, picture, postFlair, userFlair } = item.data as SpaceData;
          return { id: item.id, key, name, conditions, picture, postFlair, userFlair };
        }),
      new Date(),
      [],
      [],
      true,
    );

    const details: Record<
      string,
      {
        actorId: string;
        timeMs: number;
        conditions: string[];
        likes: number;
        ups: number;
        downs: number;
        pictures: string[];
        spaceId: string | null;
        link: string | null;
        pinnedOn: string[];
        locked: boolean;
        tags: string[];
        poll: Poll | null;
        flair: string | null;
        crosspostOfId: string | null;
        repostOfId: string | null;
        quoteOfId: string | null;
        reposts: number;
        quotes: number;
        ad: string | null;
        views: number;
        likedById: string | null;
        place: string | null;
        taggedIds: string[];
        tagsParticipant: boolean;
        origin: string;
      }
    > = {};
    for (const item of items) {
      if (item.kind === "post" || item.kind === "comment") {
        const data = item.data as PostData;
        details[item.id] = {
          actorId: data.actorId,
          timeMs: data.timeMs,
          conditions: data.conditions,
          likes: data.likes,
          ups: data.ups ?? 0,
          downs: data.downs ?? 0,
          pictures: data.pictures ?? [],
          spaceId: data.spaceId ?? null,
          link: data.link ?? null,
          pinnedOn: data.pinnedOn ?? [],
          locked: data.locked ?? false,
          tags: data.tags ?? [],
          poll: data.poll ?? null,
          flair: data.flair ?? null,
          crosspostOfId: data.crosspostOfId ?? null,
          repostOfId: data.repostOfId ?? null,
          quoteOfId: data.quoteOfId ?? null,
          reposts: data.reposts ?? 0,
          quotes: data.quotes ?? 0,
          ad: data.ad ?? null,
          views: data.views ?? 0,
          likedById: data.likedById ?? null,
          place: data.place ?? null,
          taggedIds: data.taggedIds ?? [],
          tagsParticipant: data.tagsParticipant ?? false,
          origin: (item.provenance as Provenance).origin,
        };
      }
    }

    return c.json({ ...preview, items: details }, 200);
  });

  app.openapi(uploadRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const editing = await forEditing(c, draftId);
    if ("failure" in editing) {
      const [body, status] = editing.failure;
      return c.json(body, status);
    }

    const picture = await storeStudyImage(storage, c.req.valid("form").image);
    if (!picture) {
      return c.json(
        {
          error: `That can't be used. Use a JPEG, PNG, GIF, or WebP under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
        },
        400,
      );
    }
    return c.json({ picture, url: mediaUrl(picture, mediaPublicUrl) }, 200);
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

  app.openapi(moveItemRoute, async (c) => {
    const { draftId, itemId } = c.req.valid("param");
    const editing = await forEditing(c, draftId);
    if ("failure" in editing) {
      const [body, status] = editing.failure;
      return c.json(body, status);
    }

    const result = await moveItem(
      db,
      draftId,
      itemId,
      editing.researcher.id,
      c.req.valid("json").timeMs,
    );
    if ("problem" in result) {
      return c.json({ error: result.message }, result.problem === "not-found" ? 404 : 409);
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

  app.openapi(presenceRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { draftId } = c.req.valid("param");
    if (!(await access(researcher.id, draftId))) {
      return c.json(notAvailable, 404);
    }
    const { itemId, section } = c.req.valid("json");
    return c.json(await recordPresence(db, draftId, researcher.id, itemId, section ?? null), 200);
  });

  app.openapi(changesRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { draftId } = c.req.valid("param");
    if (!(await access(researcher.id, draftId))) {
      return c.json(notAvailable, 404);
    }
    return c.json({ changes: await listChanges(db, draftId, researcher.id) }, 200);
  });

  app.openapi(undoRoute, async (c) => {
    const { draftId, changeId } = c.req.valid("param");
    const editing = await forEditing(c, draftId);
    if ("failure" in editing) {
      const [body, status] = editing.failure;
      return c.json(body, status);
    }

    const result = await undoChange(db, draftId, changeId, editing.researcher.id);
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
