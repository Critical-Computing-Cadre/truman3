import path from "node:path";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import type { StudyIssue } from "@truman3/core";
import { addSheets, checkSheets, type DraftItem, loadDraft, type Sheets } from "@truman3/drafts";
import {
  blankSheets,
  MEDIA_FOLDERS,
  readStudyTables,
  type StudyFiles,
  sheetPlatform,
  UPLOAD_SHEETS,
} from "@truman3/study-files";
import { strToU8, unzipSync, zipSync } from "fflate";
import { MAX_IMAGE_BYTES, storeStudyImageBytes } from "../actions/images.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

/** The most an upload can be, zipped and unzipped, so one can't fill the server's memory. */
export const MAX_SHEETS_ZIP_BYTES = 200 * 1024 * 1024;

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const issueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  file: z.string().optional(),
  row: z.number().optional(),
});
const draftParams = z.object({ draftId: z.uuid() });
const commonErrors = {
  401: errorResponse("Not signed in"),
  403: errorResponse("This researcher can only view"),
  404: errorResponse("No such draft on this researcher's teams"),
};

const downloadRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}/sheets",
  summary: "Download sheets to fill in for this draft's kind of platform, as a zip file",
  request: { params: draftParams },
  responses: {
    200: {
      description:
        "A zip file with a sheet for people, posts, and comments, and how to fill them in",
      content: {
        "application/zip": { schema: z.any().openapi({ type: "string", format: "binary" }) },
      },
    },
    ...commonErrors,
  },
});

const uploadRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/sheets",
  summary: "Add the people, posts, and comments in a zip of sheets and pictures to this draft",
  request: {
    params: draftParams,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.instanceof(File).openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Added, as one change that can be undone",
      content: {
        "application/json": {
          schema: z.object({
            added: z.object({ actors: z.number(), posts: z.number(), comments: z.number() }),
            warnings: z.array(issueSchema),
          }),
        },
      },
    },
    400: {
      description: "Nothing was added, because of these problems",
      content: {
        "application/json": {
          schema: z.object({ error: z.string(), issues: z.array(issueSchema) }),
        },
      },
    },
    409: errorResponse("The draft is already saved as a version"),
    ...commonErrors,
  },
});

const HOW_TO = `How to fill these in

Each sheet is a CSV file. Open it in a spreadsheet, such as Excel or Google Sheets, and replace the
example row with your own. Save each one as CSV with the same name.

- actors.csv: the people in the cast. A username is how posts and comments say who wrote them.
- posts.csv: the posts. Each needs an id, used by comments and reposts to point at it.
- comments.csv: the comments. postID says which post one is on.

Times are hours:minutes from when a participant joins. -2:00 is two hours before, so it's already
there when they arrive. 0:30 appears half an hour after they join.

Pictures go in this zip too: people's pictures in ${MEDIA_FOLDERS.actors}/, and posts' in
${MEDIA_FOLDERS.posts}/. A sheet names them by file name, like lake.jpg. A post can have several,
separated by |.

To add them, zip the sheets and pictures together, and upload the zip with "Add from sheets"
on the draft's page.
An upload adds to what's there, so use usernames and ids the draft doesn't have yet. A column
left out, or left empty, uses the study's default.
`;

/**
 * The files in an uploaded zip, by their path in it. If everything is inside one folder, as when
 * someone zips the folder itself, that folder is left off. Files a Mac adds are ignored.
 */
function zipFiles(bytes: Uint8Array): { files: Map<string, Uint8Array> } | { error: string } {
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_SHEETS_ZIP_BYTES) {
          throw new Error("too big");
        }
        return (
          !file.name.endsWith("/") &&
          !file.name.split("/").some((part) => part === "__MACOSX" || part.startsWith("._"))
        );
      },
    });
  } catch {
    return {
      error:
        total > MAX_SHEETS_ZIP_BYTES
          ? `That's more than ${MAX_SHEETS_ZIP_BYTES / 1024 / 1024} MB unzipped.`
          : "That isn't a zip file that can be opened.",
    };
  }
  const names = Object.keys(entries).filter((name) => path.posix.basename(name) !== ".DS_Store");
  const [first] = names;
  const top = first?.includes("/") ? `${first.split("/")[0]}/` : null;
  const prefix = top && names.every((name) => name.startsWith(top)) ? top : "";
  return {
    files: new Map(
      names.map((name) => [name.slice(prefix.length), entries[name] as Uint8Array] as const),
    ),
  };
}

const asStudyFiles = (files: ReadonlyMap<string, Uint8Array>): StudyFiles => {
  const decoder = new TextDecoder();
  return {
    read: (file) => {
      const bytes = files.get(file);
      return bytes ? decoder.decode(bytes) : null;
    },
    has: (file) => files.has(file),
  };
};

/** The pictures these sheets name, by their path in the zip. */
function picturesIn({ actors, posts }: Sheets) {
  const pictures = new Set<string>();
  for (const actor of actors) {
    for (const name of [actor.picture, actor.banner]) {
      if (name) {
        pictures.add(path.posix.join(MEDIA_FOLDERS.actors, name));
      }
    }
  }
  for (const post of posts) {
    for (const name of post.pictures) {
      pictures.add(path.posix.join(MEDIA_FOLDERS.posts, name));
    }
  }
  return pictures;
}

export function createSheetRoutes({ db, storage }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "That isn't available." };

  const access = async (c: Parameters<typeof researcherFromRequest>[0], draftId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return { failure: [pleaseSignIn, 401] as const };
    }
    const loaded = await loadDraft(db, draftId);
    const role = loaded ? await roleOnStudy(db, researcher.id, loaded.draft.studyId) : null;
    if (!loaded || !role) {
      return { failure: [notAvailable, 404] as const };
    }
    return { researcher, loaded, canEdit: role !== "viewer" };
  };

  app.openapi(downloadRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const found = await access(c, draftId);
    if ("failure" in found) {
      const [body, status] = found.failure;
      return c.json(body, status);
    }
    const { settings } = found.loaded;
    const files: Record<string, Uint8Array> = { "how to fill these in.txt": strToU8(HOW_TO) };
    for (const [sheet, text] of blankSheets(sheetPlatform(settings))) {
      files[sheet] = strToU8(text);
    }
    files[`${MEDIA_FOLDERS.actors}/`] = new Uint8Array(0);
    files[`${MEDIA_FOLDERS.posts}/`] = new Uint8Array(0);
    const zipped = zipSync(files);
    return c.body(zipped.slice().buffer, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${settings.slug}-sheets.zip"`,
    });
  });

  app.openapi(uploadRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const found = await access(c, draftId);
    if ("failure" in found) {
      const [body, status] = found.failure;
      return c.json(body, status);
    }
    if (!found.canEdit) {
      return c.json({ error: "You can only view this study." }, 403);
    }
    const { loaded, researcher } = found;
    if (loaded.draft.closedAt !== null) {
      return c.json({ error: "This draft has already been saved as a version." }, 409);
    }

    const problems = (error: string, issues: StudyIssue[] = []) =>
      c.json({ error, issues: issues.map(issueFields) }, 400);

    const upload = c.req.valid("form").file;
    if (upload.size > MAX_SHEETS_ZIP_BYTES) {
      return problems(`That's more than ${MAX_SHEETS_ZIP_BYTES / 1024 / 1024} MB.`);
    }
    const unzipped = zipFiles(new Uint8Array(await upload.arrayBuffer()));
    if ("error" in unzipped) {
      return problems(unzipped.error);
    }
    const { files } = unzipped;
    if (!UPLOAD_SHEETS.some((sheet) => files.has(sheet))) {
      return problems(`There's no ${UPLOAD_SHEETS.join(", ")} in that zip.`);
    }

    // Pictures come in the zip, even if the study's other media is hosted somewhere else.
    const settings = { ...loaded.settings, media: {} };
    const read = readStudyTables(asStudyFiles(files), settings, UPLOAD_SHEETS);
    const sheets: Sheets = {
      actors: read.tables.actors,
      posts: read.tables.posts,
      comments: read.tables.comments,
    };
    const issues = read.issues.some(({ severity }) => severity === "error")
      ? read.issues
      : [
          ...read.issues,
          ...checkSheets(loaded.settings, loaded.pages, loaded.items as DraftItem[], sheets),
        ];
    if (issues.some(({ severity }) => severity === "error")) {
      return problems("Nothing was added. Fix these and upload it again.", issues);
    }

    const mediaKeys = new Map<string, string>();
    const unusable: StudyIssue[] = [];
    for (const picture of picturesIn(sheets)) {
      const key = await storeStudyImageBytes(storage, files.get(picture) as Uint8Array);
      if (key) {
        mediaKeys.set(picture, key);
      } else {
        unusable.push({
          severity: "error",
          message: `"${picture}" can't be used. Use a JPEG, PNG, GIF, or WebP under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
        });
      }
    }
    if (unusable.length > 0) {
      return problems("Nothing was added. Fix these and upload it again.", unusable);
    }

    const result = await addSheets(db, draftId, researcher.id, sheets, mediaKeys);
    if ("problem" in result) {
      return c.json({ error: result.message }, 409);
    }
    if ("issues" in result) {
      return problems("Nothing was added. Fix these and upload it again.", result.issues);
    }
    return c.json(
      { added: result.added, warnings: [...read.issues, ...result.warnings].map(issueFields) },
      200,
    );
  });

  return app;
}

const issueFields = ({ severity, message, file, row }: StudyIssue) => ({
  severity,
  message,
  ...(file ? { file } : {}),
  ...(row ? { row } : {}),
});
