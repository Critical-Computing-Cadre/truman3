import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { type Database, schema } from "@truman3/db";
import { bundleVersion, loadBundle, readBundle } from "@truman3/drafts";
import type { Storage } from "@truman3/storage";
import { and, eq, ne } from "drizzle-orm";
import { zipSync } from "fflate";
import { detectImageType, MAX_IMAGE_BYTES } from "../actions/images.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { realClock } from "../participants/session.ts";
import { loadVersion } from "./preview.ts";
import { studiesForResearcher } from "./routes.ts";
import { researcherFromRequest } from "./session.ts";
import { MAX_SHEETS_ZIP_BYTES, zipFiles } from "./sheets.ts";

/**
 * Replication bundles (ADR 91): a saved version of a study, whole, as one zip file to deposit with
 * a paper, and a way to start a new study from one. The package makes and checks the files. This
 * zips them, unzips what's uploaded, and puts a bundle's pictures into storage.
 */

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: z.object({ error: z.string() }) } },
});

const downloadRoute = createRoute({
  method: "post",
  path: "/admin/versions/{versionId}/bundle",
  summary: "A saved version as a replication bundle: the study as it ran, in one zip file",
  request: { params: z.object({ versionId: z.uuid() }) },
  responses: {
    200: {
      description: "A zip file with the study, its pictures, checksums, and a README",
      content: {
        "application/zip": { schema: z.any().openapi({ type: "string", format: "binary" }) },
      },
    },
    401: errorResponse("Not signed in"),
    404: errorResponse("No such version on this researcher's teams"),
  },
});

const loadRoute = createRoute({
  method: "post",
  path: "/admin/bundles",
  summary: "Start a new study from a replication bundle",
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.instanceof(File).openapi({ type: "string", format: "binary" }),
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
        "application/json": {
          schema: z.object({
            studyId: z.string(),
            draftId: z.string(),
            /** What it was called where it ran, to say what was loaded. */
            from: z.string(),
          }),
        },
      },
    },
    400: errorResponse("That isn't a bundle this Truman can load"),
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can't start studies on that team"),
    409: errorResponse("That link name is taken"),
  },
});

/** A favicon. Browsers' other image types are checked by what `detectImageType` knows. */
const isIcon = (bytes: Uint8Array) =>
  bytes.length > 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;

/**
 * Puts a bundle's pictures into storage, each under the key the study names it by, and says which
 * made it. A picture has to be an image by its contents, whatever its name says, since it'll be
 * served to participants. Its key is the checksum of its contents, which `readBundle` has checked,
 * so it can't replace anything that's already there.
 */
async function storePictures(
  storage: Storage,
  files: ReadonlyMap<string, Uint8Array>,
  keys: readonly string[],
) {
  const stored = new Set<string>();
  for (const key of keys) {
    const bytes = files.get(key);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      continue;
    }
    const type =
      detectImageType(bytes)?.type ??
      (key.endsWith(".ico") && isIcon(bytes) ? "image/x-icon" : null);
    if (!type) {
      continue;
    }
    if (!(await storage.exists(key))) {
      await storage.put(key, bytes, type);
    }
    stored.add(key);
  }
  return stored;
}

const fileName = (slug: string, version: number) => `${slug}-v${version}-replication.zip`;

export function createBundleRoutes({
  db,
  storage,
  clock = realClock,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };

  const mayStartOn = async (database: Database, researcherId: string, teamId: string) => {
    const [membership] = await database
      .select({ id: schema.teamMemberships.teamId })
      .from(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.researcherId, researcherId),
          eq(schema.teamMemberships.teamId, teamId),
          ne(schema.teamMemberships.role, "viewer"),
        ),
      );
    return Boolean(membership);
  };

  // Who's asking comes first, before anything about the upload is looked at, so someone who
  // isn't signed in can't make the server read a large file, or learn anything from how it's
  // refused.
  app.use("/admin/bundles", async (c, next) => {
    if (!(await researcherFromRequest(c, db))) {
      return c.json(pleaseSignIn, 401);
    }
    await next();
  });

  app.openapi(downloadRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { versionId } = c.req.valid("param");
    const version = await loadVersion(db, versionId);
    const allowed = version ? await studiesForResearcher(db, researcher.id) : [];
    if (!version || !allowed.some(({ study }) => study.id === version.studyId)) {
      return c.json({ error: "This isn't available." }, 404);
    }
    const made = await bundleVersion(db, storage, versionId, clock());
    if (!made) {
      return c.json({ error: "This isn't available." }, 404);
    }
    // Pictures are already compressed, so they're stored as they are. The rest is small.
    const zipped = zipSync(
      Object.fromEntries(
        [...made.files].map(([name, bytes]) => [
          name,
          [bytes, { level: name.startsWith("media/") ? 0 : 6 }] as [Uint8Array, { level: 0 | 6 }],
        ]),
      ),
    );
    return new Response(zipped as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${fileName(made.bundle.slug, made.bundle.version)}"`,
      },
    }) as never;
  });

  app.openapi(loadRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { file, teamId, title, slug } = c.req.valid("form");
    if (!(await mayStartOn(db, researcher.id, teamId))) {
      return c.json({ error: "You can't start studies on that team." }, 403);
    }
    if (file.size > MAX_SHEETS_ZIP_BYTES) {
      return c.json({ error: `That's more than ${MAX_SHEETS_ZIP_BYTES / 1024 / 1024} MB.` }, 400);
    }
    const unzipped = zipFiles(new Uint8Array(await file.arrayBuffer()));
    if ("error" in unzipped) {
      return c.json({ error: unzipped.error }, 400);
    }
    const bundle = readBundle(unzipped.files);
    if ("problem" in bundle) {
      return c.json({ error: bundle.message }, 400);
    }
    const stored = await storePictures(
      storage,
      unzipped.files,
      bundle.media.map(({ key }) => key),
    );
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
    return c.json({ ...result, from: `${bundle.title}, version ${bundle.version}` }, 200);
  });

  return app;
}
