import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { StudySettings } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { type Bundle, bundleVersion, loadBundle, readBundle } from "@truman3/drafts";
import { and, desc, eq, ne, or } from "drizzle-orm";
import { unzipSync, zipSync } from "fflate";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { realClock } from "../participants/session.ts";
import { loadVersion } from "./preview.ts";
import { studiesForResearcher } from "./routes.ts";
import { researcherFromRequest } from "./session.ts";

/**
 * The library (ADR 92): studies that labs on this Truman have published for each other to copy. A
 * published study is a replication bundle (ADR 91), kept as its own file. Publishing makes one from
 * a saved version. Copying loads it into the copier's lab as a draft, with placeholder consent.
 *
 * On a hosted Truman a published study waits for an operator before it's listed. On your own
 * server there's nobody to wait for, so it's listed at once.
 */

/** What a lab can let others do with a study. "Ask" means: get in touch first. */
export const LICENSES = ["CC BY 4.0", "CC BY-NC 4.0", "CC0 1.0", "Ask the authors first"] as const;
const PICTURES_SHOWN = 4;

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: z.object({ error: z.string() }) } },
});
const ok = {
  description: "Done",
  content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
};
const idParams = z.object({ id: z.uuid() });
const errors = {
  401: errorResponse("Not signed in"),
  403: errorResponse("This researcher can't do this"),
  404: errorResponse("Not available"),
};

const aboutSchema = z.object({
  kind: z.string(),
  days: z.number(),
  conditions: z.array(z.string()),
  cast: z.number(),
  posts: z.number(),
  comments: z.number(),
  /** A few of its pictures, as storage keys. */
  pictures: z.array(z.string()),
});

const entrySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  paper: z.string(),
  license: z.string(),
  lab: z.string(),
  status: z.enum(["waiting", "listed", "removed"]),
  publishedAt: z.string(),
  about: aboutSchema.extend({ pictures: z.array(z.string()) }),
  /** Whether it's from one of this researcher's labs, so they can take it down. */
  mine: z.boolean(),
  /** Whether anyone can read it, without an account. */
  open: z.boolean(),
});

/** What anyone can see of a study, without an account. Never who published it by name or email. */
const openEntrySchema = entrySchema.omit({ status: true, mine: true, open: true });

const openListRoute = createRoute({
  method: "get",
  path: "/admin/public/library",
  summary: "Published studies whose labs let anyone read them. No sign-in needed",
  responses: {
    200: {
      description: "Listed, open studies, newest first",
      content: {
        "application/json": { schema: z.object({ studies: z.array(openEntrySchema) }) },
      },
    },
  },
});

const openBundleRoute = createRoute({
  method: "get",
  path: "/admin/public/library/{id}/bundle",
  summary: "Download an open study's replication bundle. No sign-in needed",
  request: { params: idParams },
  responses: {
    200: {
      description: "The zip file, as published",
      content: {
        "application/zip": { schema: z.any().openapi({ type: "string", format: "binary" }) },
      },
    },
    404: errorResponse("Not an open study"),
  },
});

const openRoute = createRoute({
  method: "put",
  path: "/admin/library/{id}/open",
  summary: "Let anyone read a published study without an account, or stop letting them",
  request: {
    params: idParams,
    body: {
      required: true,
      content: { "application/json": { schema: z.strictObject({ open: z.boolean() }) } },
    },
  },
  responses: { 200: ok, ...errors },
});

const listRoute = createRoute({
  method: "get",
  path: "/admin/library",
  summary: "Studies published on this Truman for others to copy",
  responses: {
    200: {
      description: "Listed ones, and this researcher's own that are waiting",
      content: {
        "application/json": {
          schema: z.object({
            studies: z.array(entrySchema),
            /** Whether this researcher decides what's listed. */
            decides: z.boolean(),
            licenses: z.array(z.string()),
          }),
        },
      },
    },
    401: errors[401],
  },
});

const publishRoute = createRoute({
  method: "post",
  path: "/admin/versions/{versionId}/publish",
  summary: "Publish a saved version to the library, for other labs to copy",
  request: {
    params: z.object({ versionId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            summary: z.string().trim().min(20).max(1500),
            paper: z.string().trim().max(500).default(""),
            license: z.enum(LICENSES),
            /** They have to say they may share everything in it, pictures included. */
            mayShare: z.literal(true),
            /** Whether anyone may read it and download it, without an account (ADR 93). */
            open: z.boolean().default(false),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Published, or waiting for an operator",
      content: {
        "application/json": {
          schema: z.object({ id: z.string(), status: z.enum(["waiting", "listed"]) }),
        },
      },
    },
    400: errorResponse("Something's missing"),
    409: errorResponse("This version is already in the library"),
    ...errors,
  },
});

const copyRoute = createRoute({
  method: "post",
  path: "/admin/library/{id}/copy",
  summary: "Start a new study in your lab from one in the library",
  request: {
    params: idParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.strictObject({
            teamId: z.uuid(),
            title: z.string().trim().min(1).max(120),
            slug: z
              .string()
              .regex(/^[a-z0-9][a-z0-9_-]*$/)
              .max(60),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The new study and its draft",
      content: {
        "application/json": { schema: z.object({ studyId: z.string(), draftId: z.string() }) },
      },
    },
    400: errorResponse("The published study couldn't be loaded"),
    409: errorResponse("That link name is taken"),
    ...errors,
  },
});

const bundleRoute = createRoute({
  method: "post",
  path: "/admin/library/{id}/bundle",
  summary: "Download a library study's replication bundle",
  request: { params: idParams },
  responses: {
    200: {
      description: "The zip file, as published",
      content: {
        "application/zip": { schema: z.any().openapi({ type: "string", format: "binary" }) },
      },
    },
    ...errors,
  },
});

const decideRoute = createRoute({
  method: "put",
  path: "/admin/library/{id}/status",
  summary: "List a study that's waiting, or take one down",
  request: {
    params: idParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: z.strictObject({ status: z.enum(["listed", "removed"]) }) },
      },
    },
  },
  responses: { 200: ok, ...errors },
});

/** What a study is listed by, worked out once when it's published. */
function aboutOf(bundle: Bundle): z.infer<typeof aboutSchema> {
  const settings = bundle.settings as StudySettings;
  const count = (kind: string) => bundle.items.filter((item) => item.kind === kind).length;
  // Pictures from posts say more about a study than its cast's faces.
  const pictures = bundle.items
    .filter((item) => item.kind === "post")
    .flatMap((item) => (item.data as { pictures?: string[] }).pictures ?? [])
    .filter((key) => bundle.media.some((file) => file.key === key));
  return {
    kind: settings.platform?.template ?? "classic",
    days: settings.length.days,
    conditions: settings.conditions.arms.map(({ key }) => key),
    cast: count("actor"),
    posts: count("post"),
    comments: count("comment"),
    pictures: [...new Set(pictures)].slice(0, PICTURES_SHOWN),
  };
}

export function createLibraryRoutes({
  db,
  storage,
  hosted = false,
  mediaPublicUrl,
  participantAppUrl,
  clock = realClock,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  /** The labs someone can change things in, and whether they run this Truman. */
  const standingOf = async (database: Database, researcherId: string) => {
    const teams = await database
      .select({ id: schema.teamMemberships.teamId })
      .from(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.researcherId, researcherId),
          ne(schema.teamMemberships.role, "viewer"),
        ),
      );
    const [who] = await database
      .select({ operator: schema.researchers.operator })
      .from(schema.researchers)
      .where(eq(schema.researchers.id, researcherId));
    return { teams: new Set(teams.map(({ id }) => id)), operator: who?.operator ?? false };
  };

  const read = async (key: string) => {
    const stream = await storage.get(key);
    return stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : null;
  };

  /** A study someone may see: listed, or their own lab's, or anything if they decide. */
  const visible = async (id: string, researcherId: string) => {
    const [entry] = await db
      .select()
      .from(schema.libraryStudies)
      .where(eq(schema.libraryStudies.id, id));
    if (!entry) {
      return null;
    }
    const standing = await standingOf(db, researcherId);
    const mine = standing.teams.has(entry.teamId);
    const may =
      entry.status === "listed" || (entry.status === "waiting" && (mine || standing.operator));
    return may ? { entry, mine, standing } : null;
  };

  app.openapi(listRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const standing = await standingOf(db, researcher.id);
    const rows = await db
      .select({ entry: schema.libraryStudies, lab: schema.teams.name })
      .from(schema.libraryStudies)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.libraryStudies.teamId))
      .where(
        or(eq(schema.libraryStudies.status, "listed"), eq(schema.libraryStudies.status, "waiting")),
      )
      .orderBy(desc(schema.libraryStudies.publishedAt));
    const base = mediaPublicUrl.replace(/\/+$/, "");
    return c.json(
      {
        studies: rows
          .filter(
            ({ entry }) =>
              entry.status === "listed" || standing.operator || standing.teams.has(entry.teamId),
          )
          .map(({ entry, lab }) => {
            const about = entry.about as z.infer<typeof aboutSchema>;
            return {
              id: entry.id,
              title: entry.title,
              summary: entry.summary,
              paper: entry.paper,
              license: entry.license,
              lab,
              status: entry.status as "waiting" | "listed",
              publishedAt: entry.publishedAt.toISOString(),
              about: { ...about, pictures: about.pictures.map((key) => `${base}/${key}`) },
              mine: standing.teams.has(entry.teamId),
              open: entry.open,
            };
          }),
        // On your own server, whoever publishes decides. Nobody else is there to.
        decides: standing.operator,
        licenses: [...LICENSES],
      },
      200,
    );
  });

  app.openapi(publishRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { versionId } = c.req.valid("param");
    const version = await loadVersion(db, versionId);
    const allowed = version ? await studiesForResearcher(db, researcher.id) : [];
    const study = allowed.find((item) => item.study.id === version?.studyId);
    if (!version || !study) {
      return c.json(notAvailable, 404);
    }
    if (study.role === "viewer") {
      return c.json({ error: "Viewers can't publish a study." }, 403);
    }
    const input = c.req.valid("json");
    const made = await bundleVersion(db, storage, versionId, clock());
    if (!made) {
      return c.json(notAvailable, 404);
    }
    if (made.bundle.missingMedia.length > 0) {
      return c.json(
        {
          error: "Some of this study's pictures couldn't be read, so it can't be published whole.",
        },
        400,
      );
    }
    const id = crypto.randomUUID();
    const bundleKey = `library/${id}.zip`;
    // Listed at once where nobody runs the place, or when the person who does is publishing.
    const { operator } = await standingOf(db, researcher.id);
    const status = hosted && !operator ? ("waiting" as const) : ("listed" as const);
    const [created] = await db
      .insert(schema.libraryStudies)
      .values({
        id,
        teamId: study.study.teamId as string,
        title: made.bundle.title,
        summary: input.summary,
        paper: input.paper,
        license: input.license,
        bundleKey,
        contentHash: made.bundle.contentHash,
        about: aboutOf(made.bundle),
        status,
        open: input.open,
        publishedBy: researcher.email,
        ...(status === "listed" ? { decidedBy: researcher.email, decidedAt: clock() } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: schema.libraryStudies.id });
    if (!created) {
      return c.json({ error: "This version is already in the library." }, 409);
    }
    await storage.put(
      bundleKey,
      zipSync(
        Object.fromEntries(
          [...made.files].map(([name, bytes]) => [
            name,
            [bytes, { level: name.startsWith("media/") ? 0 : 6 }] as [Uint8Array, { level: 0 | 6 }],
          ]),
        ),
      ),
      "application/zip",
    );
    return c.json({ id, status }, 200);
  });

  app.openapi(copyRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const found = await visible(c.req.valid("param").id, researcher.id);
    if (!found) {
      return c.json(notAvailable, 404);
    }
    const { teamId, title, slug } = c.req.valid("json");
    if (!found.standing.teams.has(teamId)) {
      return c.json({ error: "You can't start studies on that team." }, 403);
    }
    const zip = await read(found.entry.bundleKey);
    if (!zip) {
      return c.json({ error: "The published study's file is missing." }, 400);
    }
    const files = new Map(Object.entries(unzipSync(zip)));
    const bundle = readBundle(files);
    if ("problem" in bundle) {
      return c.json({ error: bundle.message }, 400);
    }
    // Its pictures were in this Truman's storage when it was published, under the same keys.
    const stored = new Set<string>();
    for (const { key } of bundle.media) {
      if (await storage.exists(key)) {
        stored.add(key);
      }
    }
    const result = await loadBundle(db, bundle, {
      teamId,
      researcherId: researcher.id,
      slug,
      title,
      stored,
    });
    if ("problem" in result) {
      return c.json({ error: result.message }, result.problem === "in-use" ? 409 : 400);
    }
    return c.json(result, 200);
  });

  app.openapi(bundleRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const found = await visible(c.req.valid("param").id, researcher.id);
    const zip = found ? await read(found.entry.bundleKey) : null;
    if (!found || !zip) {
      return c.json(notAvailable, 404);
    }
    const name = found.entry.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return new Response(zip as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${name || "study"}-replication.zip"`,
      },
    }) as never;
  });

  const fileName = (title: string) =>
    `${
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "study"
    }-replication.zip`;

  /**
   * Open to anyone (ADR 93). These two give out only what a lab chose to make public, and only
   * once it's listed. Another site's page may read the list, so it says so. Nothing here knows or
   * says who's asking.
   */
  app.openapi(openListRoute, async (c) => {
    const rows = await db
      .select({ entry: schema.libraryStudies, lab: schema.teams.name })
      .from(schema.libraryStudies)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.libraryStudies.teamId))
      .where(and(eq(schema.libraryStudies.status, "listed"), eq(schema.libraryStudies.open, true)))
      .orderBy(desc(schema.libraryStudies.publishedAt));
    // A page on another site needs whole addresses for the pictures, not ones relative to here.
    const origin = participantAppUrl ?? new URL(c.req.url).origin;
    const media = new URL(
      mediaPublicUrl.endsWith("/") ? mediaPublicUrl : `${mediaPublicUrl}/`,
      origin,
    );
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "public, max-age=300");
    return c.json(
      {
        studies: rows.map(({ entry, lab }) => {
          const about = entry.about as z.infer<typeof aboutSchema>;
          return {
            id: entry.id,
            title: entry.title,
            summary: entry.summary,
            paper: entry.paper,
            license: entry.license,
            lab,
            publishedAt: entry.publishedAt.toISOString(),
            about: { ...about, pictures: about.pictures.map((key) => new URL(key, media).href) },
          };
        }),
      },
      200,
    );
  });

  app.openapi(openBundleRoute, async (c) => {
    const [entry] = await db
      .select()
      .from(schema.libraryStudies)
      .where(
        and(
          eq(schema.libraryStudies.id, c.req.valid("param").id),
          eq(schema.libraryStudies.status, "listed"),
          eq(schema.libraryStudies.open, true),
        ),
      );
    // Sent as it's read from storage, so a large file is never held in memory for a stranger.
    const stream = entry ? await storage.get(entry.bundleKey) : null;
    if (!entry || !stream) {
      return c.json(notAvailable, 404);
    }
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${fileName(entry.title)}"`,
      },
    }) as never;
  });

  app.openapi(openRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { id } = c.req.valid("param");
    const [entry] = await db
      .select()
      .from(schema.libraryStudies)
      .where(eq(schema.libraryStudies.id, id));
    const standing = await standingOf(db, researcher.id);
    // Only its own lab decides this. Whoever runs the place can take a study down, not open it.
    if (!entry || !standing.teams.has(entry.teamId)) {
      return c.json(notAvailable, 404);
    }
    await db
      .update(schema.libraryStudies)
      .set({ open: c.req.valid("json").open })
      .where(eq(schema.libraryStudies.id, id));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(decideRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const [entry] = await db
      .select()
      .from(schema.libraryStudies)
      .where(eq(schema.libraryStudies.id, id));
    const standing = await standingOf(db, researcher.id);
    const mine = entry ? standing.teams.has(entry.teamId) : false;
    if (!entry || entry.status === "removed" || !(mine || standing.operator)) {
      return c.json(notAvailable, 404);
    }
    // A lab can take its own study down. Only whoever runs this Truman lists one that's waiting.
    if (status === "listed" && !standing.operator) {
      return c.json({ error: "Only whoever runs this Truman can list a study." }, 403);
    }
    if (status === "removed") {
      // Taken down means gone: the entry and its file. Studies already copied from it are their
      // labs' own, and stay. The lab can publish the version again later.
      await db.delete(schema.libraryStudies).where(eq(schema.libraryStudies.id, id));
      await storage.delete(entry.bundleKey);
    } else {
      await db
        .update(schema.libraryStudies)
        .set({ status, decidedBy: researcher.email, decidedAt: clock() })
        .where(eq(schema.libraryStudies.id, id));
    }
    return c.json({ ok: true as const }, 200);
  });

  return app;
}
