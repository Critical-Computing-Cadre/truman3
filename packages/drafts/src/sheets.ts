import { createHash } from "node:crypto";
import path from "node:path";
import {
  createRandom,
  hasErrors,
  pickFrom,
  type StudyIssue,
  type StudySettings,
  validateStudy,
} from "@truman3/core";
import { type Database, schema, type Transaction } from "@truman3/db";
import { MEDIA_FOLDERS, UPLOAD_SHEETS } from "@truman3/study-files";
import { eq, max } from "drizzle-orm";
import { draftToDefinition } from "./definition.ts";
import { type EditProblem, loadDraft, writeHistory } from "./drafts.ts";
import { type FileTables, type ItemIds, itemsFromTables } from "./from-files.ts";
import {
  type ActorData,
  type CommentData,
  type DraftItem,
  type ItemKind,
  itemDataSchemas,
  type PostData,
  type Provenance,
  type SpaceData,
} from "./items.ts";

/** What an upload adds to a draft: anything a study folder can have, besides its settings. */
export type Sheets = FileTables;

const INSERT_BATCH_SIZE = 500;

/**
 * What would go wrong adding these sheets to what's in a draft. An upload adds to a draft, so a
 * username or ID that's already there is a mistake, never a change: changing things is what the
 * builder is for, and replacing would lose what was edited there. Everything else is checked the
 * way a study folder is, together with what the draft has, so a post can be by someone already in
 * the cast. Only problems in the sheets are reported, not ones the draft already had.
 */
export function checkSheets(
  settings: StudySettings,
  pages: Record<string, string>,
  items: readonly DraftItem[],
  sheets: Sheets,
): StudyIssue[] {
  const { definition } = draftToDefinition(settings, pages, items);
  const clashes: StudyIssue[] = [];
  /** Names the sheets give that the draft already has, for each kind that has a name. */
  const check = <T extends { source?: Source }>(
    had: readonly T[],
    adding: readonly T[],
    nameOf: (row: T) => string,
    what: string,
  ) => {
    const names = new Set(had.map(nameOf));
    for (const row of adding) {
      if (names.has(nameOf(row))) {
        clashes.push({
          severity: "error",
          message: `${what} "${nameOf(row)}" is already in this draft. An upload only adds, so give it another, or change it in the builder.`,
          file: row.source?.file,
          row: row.source?.row,
        });
      }
    }
  };
  check(definition.actors, sheets.actors, ({ username }) => username, "The username");
  check(definition.spaces, sheets.spaces, ({ key }) => key, "The space key");
  check(definition.posts, sheets.posts, ({ ref }) => ref, "The post ID");
  check(definition.comments, sheets.comments, ({ ref }) => ref, "The comment ID");
  check(definition.stories, sheets.stories, ({ ref }) => ref, "The story ID");
  check(definition.contextNotes, sheets.contextNotes, ({ ref }) => ref, "The note ID");
  check(definition.autoRules, sheets.autoRules, ({ ref }) => ref, "The rule ID");
  if (clashes.length > 0) {
    return clashes;
  }

  const together = { ...definition };
  for (const key of Object.keys(sheets) as (keyof Sheets)[]) {
    (together[key] as unknown[]) = [...definition[key], ...sheets[key]];
  }
  const sheetNames: readonly string[] = UPLOAD_SHEETS;
  return validateStudy(together).filter(({ file }) => file && sheetNames.includes(file));
}

type Source = { file: string; row: number } | undefined;

export type AddSheetsResult =
  | { added: Partial<Record<ItemKind, number>>; warnings: StudyIssue[] }
  | { issues: StudyIssue[] }
  | EditProblem;

/**
 * Adds what these sheets describe to a draft, as one change that can be undone together. Pictures
 * are named as they were in the zip, and `mediaKeys` says where each one is stored, by its path
 * there, like `media/posts/lake.jpg`.
 */
export async function addSheets(
  db: Database,
  draftId: string,
  researcherId: string,
  sheets: Sheets,
  mediaKeys: ReadonlyMap<string, string>,
): Promise<AddSheetsResult> {
  return db.transaction(async (tx) => {
    const loaded = await loadDraft(tx, draftId);
    if (!loaded || loaded.draft.closedAt !== null) {
      return { problem: "closed" as const, message: "This draft has been saved as a version." };
    }
    const items = loaded.items as DraftItem[];
    const issues = checkSheets(loaded.settings, loaded.pages, items, sheets);
    if (hasErrors(issues)) {
      return { issues };
    }

    const stored = (folder: string, name: string) => mediaKeys.get(path.join(folder, name)) ?? name;
    const tables: Sheets = {
      ...sheets,
      actors: sheets.actors.map((actor) => ({
        ...actor,
        ...(actor.picture ? { picture: stored(MEDIA_FOLDERS.actors, actor.picture) } : {}),
        ...(actor.banner ? { banner: stored(MEDIA_FOLDERS.actors, actor.banner) } : {}),
      })),
      spaces: sheets.spaces.map((space) => ({
        ...space,
        ...(space.picture ? { picture: stored(MEDIA_FOLDERS.spaces, space.picture) } : {}),
        ...(space.banner ? { banner: stored(MEDIA_FOLDERS.spaces, space.banner) } : {}),
      })),
      posts: sheets.posts.map((post) => ({
        ...post,
        pictures: post.pictures.map((picture) => stored(MEDIA_FOLDERS.posts, picture)),
      })),
      stories: sheets.stories.map((story) => ({
        ...story,
        picture: stored(MEDIA_FOLDERS.posts, story.picture),
      })),
    };

    const ofKind = <T>(kind: string) =>
      items
        .filter((item) => item.kind === kind)
        .map((item) => ({ id: item.id, data: item.data as T }));
    const fresh = <T>(rows: readonly T[], nameOf: (row: T) => string) =>
      rows.map((row) => [nameOf(row), crypto.randomUUID()] as const);
    const ids: ItemIds = {
      actors: new Map([
        ...ofKind<ActorData>("actor").map(({ id, data }) => [data.username, id] as const),
        ...fresh(tables.actors, ({ username }) => username),
      ]),
      posts: new Map([
        ...ofKind<PostData>("post").map(({ id, data }) => [data.ref, id] as const),
        ...fresh(tables.posts, ({ ref }) => ref),
      ]),
      comments: new Map([
        ...ofKind<CommentData>("comment").map(({ id, data }) => [data.ref, id] as const),
        ...fresh(tables.comments, ({ ref }) => ref),
      ]),
      spaces: new Map([
        ...ofKind<SpaceData>("space").map(({ id, data }) => [data.key, id] as const),
        ...fresh(tables.spaces, ({ key }) => key),
      ]),
    };

    // The same sheets draw the same like counts, as a pack does.
    const random = createRandom(
      Number.parseInt(
        createHash("sha256").update(JSON.stringify(sheets)).digest("hex").slice(0, 12),
        16,
      ),
    );
    const drawLikes = (explicit: number | undefined, distribution: number[] | undefined) =>
      explicit ?? (distribution ? pickFrom(distribution, random) : 0);

    // What's added goes after what each kind already has.
    const next = await nextPositions(tx, draftId);
    const provenance: Provenance = { origin: "file" };
    const added: Partial<Record<ItemKind, number>> = {};
    const rows = itemsFromTables(tables, ids, {
      post: (given) => drawLikes(given, loaded.settings.likes.posts),
      comment: (given) => drawLikes(given, loaded.settings.likes.comments),
    }).map(({ id, kind, data }) => {
      const position = next.get(kind) ?? 0;
      next.set(kind, position + 1);
      added[kind] = (added[kind] ?? 0) + 1;
      return {
        id: id ?? crypto.randomUUID(),
        kind,
        position,
        data: itemDataSchemas[kind].parse(data) as Record<string, unknown>,
      };
    });

    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      await tx
        .insert(schema.draftItems)
        .values(batch.map((row) => ({ ...row, draftId, provenance, updatedBy: researcherId })));
    }
    await writeHistory(
      tx,
      rows.map(({ id, data }) => ({
        itemId: id,
        draftId,
        revision: 1,
        action: "create" as const,
        data,
        researcherId,
      })),
    );
    await tx
      .update(schema.studyDrafts)
      .set({ updatedAt: new Date() })
      .where(eq(schema.studyDrafts.id, draftId));

    return { added, warnings: issues };
  });
}

/** Where each kind of item would go next, after what the draft has of it. */
async function nextPositions(tx: Transaction, draftId: string) {
  const rows = await tx
    .select({ kind: schema.draftItems.kind, position: max(schema.draftItems.position) })
    .from(schema.draftItems)
    .where(eq(schema.draftItems.draftId, draftId))
    .groupBy(schema.draftItems.kind);
  return new Map<string, number>(rows.map(({ kind, position }) => [kind, (position ?? -1) + 1]));
}
