import {
  hasErrors,
  type StudyIssue,
  type StudySettings,
  studySettingsSchema,
  validateStudy,
} from "@truman3/core";
import { type Database, schema, type Transaction } from "@truman3/db";
import { freezeStudy } from "@truman3/study-import";
import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { draftToDefinition } from "./definition.ts";
import { type DraftItem, type ItemKind, itemDataSchemas, type Provenance } from "./items.ts";

const INSERT_BATCH_SIZE = 500;

type DraftRow = typeof schema.studyDrafts.$inferSelect;
type ItemRow = typeof schema.draftItems.$inferSelect;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function writeHistory(
  tx: Transaction,
  rows: {
    itemId: string;
    draftId: string;
    revision: number;
    action: "create" | "update" | "delete";
    data: unknown;
    researcherId: string;
  }[],
) {
  for (const batch of chunks(rows, INSERT_BATCH_SIZE)) {
    await tx.insert(schema.draftItemHistory).values(batch);
  }
}

/**
 * The study's open draft. If there isn't one, this starts one by copying a frozen version, which
 * stays exactly as it was. A study has one open draft, so a team works on the same thing.
 */
export async function openDraft(
  db: Database,
  versionId: string,
  researcherId: string,
): Promise<{ draftId: string; created: boolean } | null> {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    if (!version) {
      return null;
    }

    const [created] = await tx
      .insert(schema.studyDrafts)
      .values({
        studyId: version.studyId,
        basedOnVersionId: version.id,
        settings: version.settings,
        pages: version.pages,
        createdBy: researcherId,
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      const [existing] = await tx
        .select({ id: schema.studyDrafts.id })
        .from(schema.studyDrafts)
        .where(
          and(eq(schema.studyDrafts.studyId, version.studyId), isNull(schema.studyDrafts.closedAt)),
        );
      return existing ? { draftId: existing.id, created: false } : null;
    }

    const actors = await tx
      .select()
      .from(schema.actors)
      .where(and(eq(schema.actors.studyVersionId, versionId), isNull(schema.actors.worldId)));
    const content = await tx
      .select()
      .from(schema.content)
      .where(and(eq(schema.content.studyVersionId, versionId), isNull(schema.content.worldId)));
    const reactions = await tx
      .select()
      .from(schema.scriptedReactions)
      .where(eq(schema.scriptedReactions.studyVersionId, versionId));

    // New IDs up front, since items point at each other.
    const newId = new Map<string, string>();
    for (const row of [...actors, ...content]) {
      newId.set(row.id, crypto.randomUUID());
    }
    const asId = (oldId: string) => newId.get(oldId) as string;

    const fromFile: Provenance = { origin: "file" };
    const optional = (key: string, value: unknown) =>
      value === null || value === undefined || value === "" ? {} : { [key]: value };

    const rows: (typeof schema.draftItems.$inferInsert)[] = [
      ...actors.map((actor, position) => {
        const profile = actor.profile as Record<string, unknown>;
        return {
          id: asId(actor.id),
          draftId: created.id,
          kind: "actor",
          position,
          provenance: fromFile,
          data: {
            username: actor.username,
            name: profile.name ?? actor.username,
            ...optional("gender", profile.gender),
            ...optional("age", profile.age),
            ...optional("location", profile.location),
            ...optional("bio", profile.bio),
            ...optional("picture", profile.picture),
            conditions: actor.conditions,
            ...optional("class", actor.class),
          },
        };
      }),
      ...content.map((item, index) => {
        const shared = {
          ref: item.sourceRef ?? item.id,
          body: item.body,
          actorId: asId(item.authorActorId),
          timeMs: item.offsetMs ?? 0,
          likes: item.baseLikes,
          conditions: item.conditions,
          ...optional("class", item.class),
        };
        return {
          id: asId(item.id),
          draftId: created.id,
          kind: item.kind,
          position: item.position ?? index,
          provenance: (Object.keys(item.provenance as object).length
            ? item.provenance
            : fromFile) as Provenance,
          data:
            item.kind === "post"
              ? { ...shared, ...optional("picture", item.mediaKey) }
              : { ...shared, postId: asId(item.parentId as string) },
        };
      }),
      ...reactions.map((reaction, position) => ({
        draftId: created.id,
        kind: "reaction",
        position,
        provenance: fromFile,
        data: {
          on: reaction.on,
          nth: reaction.nth,
          type: reaction.type,
          actorId: asId(reaction.actorId),
          afterMs: reaction.afterMs,
          ...optional("body", reaction.body),
          conditions: reaction.conditions,
          ...optional("class", reaction.class),
        },
      })),
    ];

    for (const batch of chunks(rows, INSERT_BATCH_SIZE)) {
      await tx.insert(schema.draftItems).values(batch);
    }

    return { draftId: created.id, created: true };
  });
}

export interface LoadedDraft {
  draft: DraftRow;
  settings: StudySettings;
  pages: Record<string, string>;
  items: ItemRow[];
}

/** A draft and its items that haven't been deleted. */
export async function loadDraft(db: Database, draftId: string): Promise<LoadedDraft | null> {
  const [draft] = await db
    .select()
    .from(schema.studyDrafts)
    .where(eq(schema.studyDrafts.id, draftId));
  if (!draft) {
    return null;
  }
  const items = await db
    .select()
    .from(schema.draftItems)
    .where(and(eq(schema.draftItems.draftId, draftId), isNull(schema.draftItems.deletedAt)))
    .orderBy(asc(schema.draftItems.position));

  return {
    draft,
    settings: studySettingsSchema.parse(draft.settings),
    pages: draft.pages as Record<string, string>,
    items,
  };
}

/** The same checks a study written in files goes through. */
export function checkDraft({ settings, pages, items }: LoadedDraft): StudyIssue[] {
  return validateStudy(draftToDefinition(settings, pages, items as DraftItem[]).definition);
}

async function itemExists(tx: Transaction, draftId: string, kind: ItemKind, id: string) {
  const [row] = await tx
    .select({ id: schema.draftItems.id })
    .from(schema.draftItems)
    .where(
      and(
        eq(schema.draftItems.id, id),
        eq(schema.draftItems.draftId, draftId),
        eq(schema.draftItems.kind, kind),
        isNull(schema.draftItems.deletedAt),
      ),
    );
  return row !== undefined;
}

export type EditProblem = {
  problem: "invalid" | "not-found" | "in-use" | "closed";
  message: string;
};

const NOT_FOUND: EditProblem = {
  problem: "not-found",
  message: "That item doesn't exist anymore.",
};
const CLOSED: EditProblem = {
  problem: "closed",
  message: "This draft has already been saved as a version.",
};

/** Whether what an item points at is really in this draft. */
async function checkReferences(tx: Transaction, draftId: string, data: Record<string, unknown>) {
  if (typeof data.actorId === "string" && !(await itemExists(tx, draftId, "actor", data.actorId))) {
    return "That author isn't in this study.";
  }
  if (typeof data.postId === "string" && !(await itemExists(tx, draftId, "post", data.postId))) {
    return "That post isn't in this study.";
  }
  return null;
}

async function isOpen(tx: Transaction, draftId: string) {
  const [draft] = await tx
    .select({ closedAt: schema.studyDrafts.closedAt })
    .from(schema.studyDrafts)
    .where(eq(schema.studyDrafts.id, draftId));
  return draft !== undefined && draft.closedAt === null;
}

const touchDraft = (tx: Transaction, draftId: string) =>
  tx
    .update(schema.studyDrafts)
    .set({ updatedAt: new Date() })
    .where(eq(schema.studyDrafts.id, draftId));

/** A short reference for a new item, shown in messages. */
const newRef = (kind: string, id: string) => `${kind}-${id.slice(-8)}`;

/** Adds a post or comment, written by a researcher. */
export async function createItem(
  db: Database,
  draftId: string,
  researcherId: string,
  kind: "post" | "comment",
  fields: Record<string, unknown>,
): Promise<{ id: string } | EditProblem> {
  return db.transaction(async (tx) => {
    if (!(await isOpen(tx, draftId))) {
      return CLOSED;
    }

    const id = crypto.randomUUID();
    const parsed = itemDataSchemas[kind].safeParse({ likes: 0, ...fields, ref: newRef(kind, id) });
    if (!parsed.success) {
      return { problem: "invalid" as const, message: "That isn't complete." };
    }
    const problem = await checkReferences(tx, draftId, parsed.data);
    if (problem) {
      return { problem: "invalid" as const, message: problem };
    }

    const [last] = await tx
      .select({ position: max(schema.draftItems.position) })
      .from(schema.draftItems)
      .where(and(eq(schema.draftItems.draftId, draftId), eq(schema.draftItems.kind, kind)));

    const provenance: Provenance = { origin: "researcher" };
    await tx.insert(schema.draftItems).values({
      id,
      draftId,
      kind,
      data: parsed.data,
      provenance,
      position: (last?.position ?? -1) + 1,
      updatedBy: researcherId,
    });
    await writeHistory(tx, [
      { itemId: id, draftId, revision: 1, action: "create", data: parsed.data, researcherId },
    ]);
    await touchDraft(tx, draftId);
    return { id };
  });
}

/**
 * Changes an item. Each save stands alone, so two people on different posts never conflict. If two
 * people change the same post, the last save wins, and the other version stays in the history.
 * A field set to null is removed.
 */
export async function updateItem(
  db: Database,
  draftId: string,
  itemId: string,
  researcherId: string,
  changes: Record<string, unknown>,
): Promise<{ revision: number } | EditProblem> {
  return db.transaction(async (tx) => {
    if (!(await isOpen(tx, draftId))) {
      return CLOSED;
    }

    const [item] = await tx
      .select()
      .from(schema.draftItems)
      .where(
        and(
          eq(schema.draftItems.id, itemId),
          eq(schema.draftItems.draftId, draftId),
          isNull(schema.draftItems.deletedAt),
        ),
      )
      .for("update");
    if (!item) {
      return NOT_FOUND;
    }

    const merged = Object.fromEntries(
      Object.entries({ ...(item.data as object), ...changes }).filter(
        ([, value]) => value !== null,
      ),
    );
    const parsed = itemDataSchemas[item.kind as ItemKind].safeParse(merged);
    if (!parsed.success) {
      return { problem: "invalid" as const, message: "That change isn't valid." };
    }
    const problem = await checkReferences(tx, draftId, parsed.data);
    if (problem) {
      return { problem: "invalid" as const, message: problem };
    }

    const revision = item.revision + 1;
    await tx
      .update(schema.draftItems)
      .set({
        data: parsed.data,
        revision,
        provenance: { ...(item.provenance as Provenance), edited: true },
        updatedBy: researcherId,
        updatedAt: new Date(),
      })
      .where(eq(schema.draftItems.id, itemId));
    await writeHistory(tx, [
      { itemId, draftId, revision, action: "update", data: parsed.data, researcherId },
    ]);
    await touchDraft(tx, draftId);
    return { revision };
  });
}

/**
 * Removes an item, along with any comments on it. It stays in the history, so it can be restored.
 * An author who still has content can't be removed.
 */
export async function deleteItem(
  db: Database,
  draftId: string,
  itemId: string,
  researcherId: string,
): Promise<{ deleted: number } | EditProblem> {
  return db.transaction(async (tx) => {
    if (!(await isOpen(tx, draftId))) {
      return CLOSED;
    }

    const rows = await tx
      .select()
      .from(schema.draftItems)
      .where(and(eq(schema.draftItems.draftId, draftId), isNull(schema.draftItems.deletedAt)));
    const item = rows.find(({ id }) => id === itemId);
    if (!item) {
      return NOT_FOUND;
    }

    const points = (row: ItemRow, key: "actorId" | "postId") =>
      (row.data as Record<string, unknown>)[key] === itemId;

    if (item.kind === "actor" && rows.some((row) => points(row, "actorId"))) {
      return { problem: "in-use" as const, message: "This person still has posts or comments." };
    }

    const removing = [item, ...rows.filter((row) => points(row, "postId"))];
    await tx
      .update(schema.draftItems)
      .set({ deletedAt: new Date(), updatedBy: researcherId })
      .where(
        inArray(
          schema.draftItems.id,
          removing.map(({ id }) => id),
        ),
      );
    await writeHistory(
      tx,
      removing.map((row) => ({
        itemId: row.id,
        draftId,
        revision: row.revision + 1,
        action: "delete" as const,
        data: row.data,
        researcherId,
      })),
    );
    await touchDraft(tx, draftId);
    return { deleted: removing.length };
  });
}

export type FreezeResult =
  | { status: "invalid"; issues: StudyIssue[] }
  | { status: "unchanged"; version: number }
  | { status: "frozen"; version: number; studyVersionId: string };

/**
 * Saves a draft as a new frozen version, through the same code an import uses. New participants get
 * that version. People already enrolled stay on theirs. The draft closes.
 */
export async function freezeDraft(db: Database, loaded: LoadedDraft): Promise<FreezeResult> {
  // An untouched draft would otherwise become an identical version, and split new participants
  // from earlier ones for no reason.
  const [change] = await db
    .select({ id: schema.draftItemHistory.id })
    .from(schema.draftItemHistory)
    .where(eq(schema.draftItemHistory.draftId, loaded.draft.id))
    .limit(1);
  if (!change && loaded.draft.basedOnVersionId) {
    const [base] = await db
      .select({ version: schema.studyVersions.version })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, loaded.draft.basedOnVersionId));
    return { status: "unchanged", version: base?.version ?? 0 };
  }

  const { definition, mediaKeys, provenance } = draftToDefinition(
    loaded.settings,
    loaded.pages,
    loaded.items as DraftItem[],
  );
  const issues = validateStudy(definition);
  if (hasErrors(issues)) {
    return { status: "invalid", issues };
  }

  const result = await freezeStudy(db, definition, mediaKeys, issues, 0, {
    provenanceFor: (kind, ref) => provenance.get(`${kind}:${ref}`) ?? { origin: "researcher" },
  });
  if (result.status === "failed") {
    return { status: "invalid", issues: result.issues };
  }
  if (result.status === "unchanged") {
    return { status: "unchanged", version: result.version };
  }

  await db
    .update(schema.studyDrafts)
    .set({
      closedAt: sql`now()`,
      frozenVersionId: result.studyVersionId,
    })
    .where(eq(schema.studyDrafts.id, loaded.draft.id));

  return { status: "frozen", version: result.version, studyVersionId: result.studyVersionId };
}
