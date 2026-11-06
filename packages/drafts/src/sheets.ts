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
import { MEDIA_FOLDERS, type StudyTables, UPLOAD_SHEETS } from "@truman3/study-files";
import { and, eq, max } from "drizzle-orm";
import { draftToDefinition } from "./definition.ts";
import { type EditProblem, loadDraft, writeHistory } from "./drafts.ts";
import { actorItemData, commentItemData, type ItemIds, postItemData } from "./from-files.ts";
import {
  type ActorData,
  type CommentData,
  type DraftItem,
  itemDataSchemas,
  type PostData,
  type Provenance,
  type SpaceData,
} from "./items.ts";

/** What an upload adds to a draft: most of a feed, for now. */
export type Sheets = Pick<StudyTables, "actors" | "posts" | "comments">;

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
  const taken = (names: Set<string>, name: string, what: string, source?: Source) => {
    if (names.has(name)) {
      clashes.push({
        severity: "error",
        message: `${what} is already in this draft. An upload only adds, so give it another, or change it in the builder.`,
        file: source?.file,
        row: source?.row,
      });
    }
  };
  const usernames = new Set(definition.actors.map(({ username }) => username));
  const postRefs = new Set(definition.posts.map(({ ref }) => ref));
  const commentRefs = new Set(definition.comments.map(({ ref }) => ref));
  for (const actor of sheets.actors) {
    taken(usernames, actor.username, `The username "${actor.username}"`, actor.source);
  }
  for (const post of sheets.posts) {
    taken(postRefs, post.ref, `The post ID "${post.ref}"`, post.source);
  }
  for (const comment of sheets.comments) {
    taken(commentRefs, comment.ref, `The comment ID "${comment.ref}"`, comment.source);
  }
  if (clashes.length > 0) {
    return clashes;
  }

  const together = {
    ...definition,
    actors: [...definition.actors, ...sheets.actors],
    posts: [...definition.posts, ...sheets.posts],
    comments: [...definition.comments, ...sheets.comments],
  };
  const sheetNames: readonly string[] = UPLOAD_SHEETS;
  return validateStudy(together).filter(({ file }) => file && sheetNames.includes(file));
}

type Source = { file: string; row: number } | undefined;

export type AddSheetsResult =
  | { added: { actors: number; posts: number; comments: number }; warnings: StudyIssue[] }
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
    const actors = sheets.actors.map((actor) => ({
      ...actor,
      ...(actor.picture ? { picture: stored(MEDIA_FOLDERS.actors, actor.picture) } : {}),
      ...(actor.banner ? { banner: stored(MEDIA_FOLDERS.actors, actor.banner) } : {}),
    }));
    const posts = sheets.posts.map((post) => ({
      ...post,
      pictures: post.pictures.map((picture) => stored(MEDIA_FOLDERS.posts, picture)),
    }));

    const ofKind = <T>(kind: string) =>
      items
        .filter((item) => item.kind === kind)
        .map((item) => ({ id: item.id, data: item.data as T }));
    const ids: ItemIds = {
      actors: new Map([
        ...ofKind<ActorData>("actor").map(({ id, data }) => [data.username, id] as const),
        ...actors.map(({ username }) => [username, crypto.randomUUID()] as const),
      ]),
      posts: new Map([
        ...ofKind<PostData>("post").map(({ id, data }) => [data.ref, id] as const),
        ...posts.map(({ ref }) => [ref, crypto.randomUUID()] as const),
      ]),
      comments: new Map([
        ...ofKind<CommentData>("comment").map(({ id, data }) => [data.ref, id] as const),
        ...sheets.comments.map(({ ref }) => [ref, crypto.randomUUID()] as const),
      ]),
      spaces: new Map(ofKind<SpaceData>("space").map(({ id, data }) => [data.key, id] as const)),
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

    const after = await lastPositions(tx, draftId);
    const provenance: Provenance = { origin: "file" };
    const rows = [
      ...actors.map((actor, index) => ({
        id: ids.actors.get(actor.username) as string,
        kind: "actor" as const,
        position: after.actor + 1 + index,
        data: itemDataSchemas.actor.parse(actorItemData(actor, ids)),
      })),
      ...posts.map((post, index) => ({
        id: ids.posts.get(post.ref) as string,
        kind: "post" as const,
        position: after.post + 1 + index,
        data: itemDataSchemas.post.parse(
          postItemData(post, ids, drawLikes(post.likes, loaded.settings.likes.posts)),
        ),
      })),
      ...sheets.comments.map((comment, index) => ({
        id: ids.comments.get(comment.ref) as string,
        kind: "comment" as const,
        position: after.comment + 1 + index,
        data: itemDataSchemas.comment.parse(
          commentItemData(comment, ids, drawLikes(comment.likes, loaded.settings.likes.comments)),
        ),
      })),
    ];

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

    return {
      added: { actors: actors.length, posts: posts.length, comments: sheets.comments.length },
      warnings: issues,
    };
  });
}

/** Where each kind of item ends, so what's added goes after it. */
async function lastPositions(tx: Transaction, draftId: string) {
  const last = async (kind: string) => {
    const [row] = await tx
      .select({ position: max(schema.draftItems.position) })
      .from(schema.draftItems)
      .where(and(eq(schema.draftItems.draftId, draftId), eq(schema.draftItems.kind, kind)));
    return row?.position ?? -1;
  };
  return { actor: await last("actor"), post: await last("post"), comment: await last("comment") };
}
