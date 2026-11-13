import { schema } from "@truman3/db";
import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { researcherFromRequest } from "./admin/session.ts";
import type { ParticipantRouteDependencies } from "./participants/routes.ts";
import { participantFromRequest, realClock } from "./participants/session.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UPLOAD_PATH = new RegExp(`^(uploads/(${UUID})/(?:${UUID}/)?${UUID}\\.(jpg|png|gif|webp))$`);
const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** A plain gray picture with a few words on it, shown in place of a photo nobody may see now. */
function standIn(c: Context, words: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="${words}"><rect width="400" height="300" fill="#e7e5e4"/><text x="200" y="155" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#57534e">${words}</text></svg>`;
  return c.body(svg, 200, {
    "content-type": "image/svg+xml",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    // Not kept, so a photo a researcher releases shows the next time it's asked for.
    "cache-control": "no-store",
  });
}

/**
 * What participants upload, for people allowed to see it: anyone signed in to the same world, and
 * researchers on the team that owns the study. Everyone else gets the same 404 whether or not the
 * file exists. CloudFront doesn't cache /api, so a deleted photo stops being served at once. See ADR 25.
 */
export function createMediaRoutes({
  db,
  storage,
  clock = realClock,
}: ParticipantRouteDependencies) {
  const app = new Hono();

  async function teamCanSee(researcherId: string, worldId: string) {
    const [row] = await db
      .select({ worldId: schema.worlds.id })
      .from(schema.worlds)
      .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
      .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
      .innerJoin(schema.teamMemberships, eq(schema.teamMemberships.teamId, schema.studies.teamId))
      .where(
        and(eq(schema.worlds.id, worldId), eq(schema.teamMemberships.researcherId, researcherId)),
      );
    return Boolean(row);
  }

  app.get("/media/*", async (c) => {
    const notFound = () => c.json({ error: "Not found." }, 404);
    const match = UPLOAD_PATH.exec(c.req.path.replace(/^.*?\/media\//, ""));
    if (!match) {
      return notFound();
    }
    const [, key, worldId, extension] = match as unknown as [string, string, string, string];

    const participant = await participantFromRequest(c, db, clock());
    let allowed = participant?.worldId === worldId;
    if (allowed) {
      // A photo a researcher removed, or one held for them to look at (ADR 79). Whoever uploaded a
      // held one still sees it, as they would if nothing had happened. Older uploads have no row.
      const [upload] = await db
        .select({
          held: schema.uploads.held,
          decision: schema.uploads.decision,
          participantId: schema.uploads.participantId,
        })
        .from(schema.uploads)
        .where(eq(schema.uploads.key, key));
      if (upload?.decision === "removed") {
        return standIn(c, "This photo was removed.");
      }
      if (upload?.held && upload.participantId !== participant?.participantId) {
        return standIn(c, "This photo is being reviewed.");
      }
    }
    if (!allowed) {
      const researcher = await researcherFromRequest(c, db);
      allowed = researcher ? await teamCanSee(researcher.id, worldId) : false;
    }
    if (!allowed) {
      return notFound();
    }

    const file = await storage.get(key);
    if (!file) {
      return notFound();
    }
    return c.body(file, 200, {
      // From the checked name, not from what was stored. Uploads are checked for this when they arrive.
      "content-type": IMAGE_TYPES[extension] as string,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
      // Only in the browser, and briefly, so a withdrawal reaches other people soon.
      "cache-control": "private, max-age=3600",
    });
  });

  return app;
}
