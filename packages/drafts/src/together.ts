import { type Database, schema } from "@truman3/db";
import { and, desc, eq, gt, isNull, max, ne } from "drizzle-orm";
import type { EditProblem } from "./drafts.ts";
import type { Provenance } from "./items.ts";
import { pageKeyOf } from "./sections.ts";

/** Someone counts as here if they've checked in this recently. */
const PRESENCE_WINDOW_MS = 10_000;
const CHANGES_SHOWN = 30;

export interface ActiveResearcher {
  name: string;
  itemId: string | null;
  section: string | null;
}

/**
 * Notes that a researcher is here, and what they're editing. It returns who else is, and the newest
 * change, so anyone can tell whether to redraw.
 */
export async function recordPresence(
  db: Database,
  draftId: string,
  researcherId: string,
  itemId: string | null,
  section: string | null = null,
  now = new Date(),
): Promise<{ latestChange: number; others: ActiveResearcher[] }> {
  await db
    .insert(schema.draftPresence)
    .values({ draftId, researcherId, itemId, section, lastSeen: now })
    .onConflictDoUpdate({
      target: [schema.draftPresence.draftId, schema.draftPresence.researcherId],
      set: { itemId, section, lastSeen: now },
    });

  const others = await db
    .select({
      name: schema.researchers.name,
      itemId: schema.draftPresence.itemId,
      section: schema.draftPresence.section,
    })
    .from(schema.draftPresence)
    .innerJoin(schema.researchers, eq(schema.researchers.id, schema.draftPresence.researcherId))
    .where(
      and(
        eq(schema.draftPresence.draftId, draftId),
        ne(schema.draftPresence.researcherId, researcherId),
        gt(schema.draftPresence.lastSeen, new Date(now.getTime() - PRESENCE_WINDOW_MS)),
      ),
    );

  const [latest] = await db
    .select({ id: max(schema.draftItemHistory.id) })
    .from(schema.draftItemHistory)
    .where(eq(schema.draftItemHistory.draftId, draftId));

  return { latestChange: latest?.id ?? 0, others };
}

export interface RecentChange {
  changeId: string;
  who: string;
  mine: boolean;
  action: string;
  summary: string;
  at: string;
  canUndo: boolean;
}

const quote = (data: unknown) => {
  const body = (data as { body?: string }).body;
  return body ? `"${body.length > 40 ? `${body.slice(0, 40)}...` : body}"` : "a post";
};

const SECTION_NAMES: Record<string, string> = {
  study: "the study and platform settings",
  conditions: "the conditions",
  feed: "the feed settings",
  flow: "the study's flow",
};

function describeSection(section: string) {
  const page = pageKeyOf(section);
  return page === null ? (SECTION_NAMES[section] ?? "the settings") : "a page's text";
}

function describeChange(action: string, rows: { data: unknown; previousData: unknown }[]) {
  const [first] = rows;
  const section = (first?.data as { section?: string } | undefined)?.section;
  if (section) {
    return `${action === "undo" ? "undid a change to" : "changed"} ${describeSection(section)}`;
  }
  const extra = rows.length > 1 ? ` and ${rows.length - 1} more` : "";
  switch (action) {
    case "create":
      return `added ${quote(first?.data)}`;
    case "delete":
      return `deleted ${quote(first?.data)}${extra}`;
    case "undo":
      return `undid a change to ${quote(first?.data)}`;
    default: {
      const before = first?.previousData as Record<string, unknown> | null;
      const after = first?.data as Record<string, unknown>;
      if (before && before.timeMs !== after.timeMs) {
        return `moved ${quote(after)}${extra}`;
      }
      if (before && before.picture !== after.picture) {
        return `changed the photo on ${quote(after)}`;
      }
      return `changed ${quote(after)}`;
    }
  }
}

/** Recent changes to a draft, newest first. Each action counts once, however many items it moved. */
export async function listChanges(
  db: Database,
  draftId: string,
  researcherId: string,
): Promise<RecentChange[]> {
  const rows = await db
    .select({ history: schema.draftItemHistory, who: schema.researchers.name })
    .from(schema.draftItemHistory)
    .innerJoin(schema.researchers, eq(schema.researchers.id, schema.draftItemHistory.researcherId))
    .where(eq(schema.draftItemHistory.draftId, draftId))
    .orderBy(desc(schema.draftItemHistory.id))
    .limit(CHANGES_SHOWN * 5);

  const groups = Map.groupBy(rows, ({ history }) => history.changeId);
  return [...groups.values()].slice(0, CHANGES_SHOWN).map((group) => {
    const [first] = group as [(typeof group)[number]];
    const { history, who } = first;
    return {
      changeId: history.changeId,
      who,
      mine: history.researcherId === researcherId,
      action: history.action,
      summary: describeChange(
        history.action,
        group.map((row) => row.history),
      ),
      at: history.at.toISOString(),
      canUndo:
        history.action !== "undo" &&
        group.every(({ history: row }) => row.undoneBy === null) &&
        (history.action !== "update" ||
          group.every(({ history: row }) => row.previousData !== null)),
    };
  });
}

/** Stops an undo partway and rolls it back, when an item has changed since. */
class ChangedSince extends Error {}

const STALE: EditProblem = {
  problem: "in-use",
  message: "That can't be undone, because someone has changed it since.",
};

/**
 * Reverses one change. It refuses if someone has changed the same item since, rather than quietly
 * throwing away their work. The undo goes in the history too, so nothing is lost.
 */
export async function undoChange(
  db: Database,
  draftId: string,
  changeId: string,
  researcherId: string,
): Promise<{ undone: number } | EditProblem> {
  return db
    .transaction(async (tx) => {
      const [draft] = await tx
        .select({ closedAt: schema.studyDrafts.closedAt })
        .from(schema.studyDrafts)
        .where(eq(schema.studyDrafts.id, draftId));
      if (!draft || draft.closedAt) {
        return {
          problem: "closed" as const,
          message: "This draft has already been saved as a version.",
        };
      }

      const rows = await tx
        .select()
        .from(schema.draftItemHistory)
        .where(
          and(
            eq(schema.draftItemHistory.draftId, draftId),
            eq(schema.draftItemHistory.changeId, changeId),
            isNull(schema.draftItemHistory.undoneBy),
          ),
        );
      if (rows.length === 0 || rows.some(({ action }) => action === "undo")) {
        return { problem: "not-found" as const, message: "That change can't be undone." };
      }

      const undoChangeId = crypto.randomUUID();
      const now = new Date();

      for (const row of rows) {
        const [item] = await tx
          .select()
          .from(schema.draftItems)
          .where(eq(schema.draftItems.id, row.itemId))
          .for("update");
        if (!item || item.revision !== row.revision) {
          throw new ChangedSince();
        }

        const revision = item.revision + 1;
        let data = item.data;
        let deletedAt: Date | null = item.deletedAt;

        if (row.action === "create") {
          deletedAt = now;
        } else if (row.action === "delete") {
          deletedAt = null;
        } else if (row.previousData) {
          data = row.previousData;
        } else {
          throw new ChangedSince();
        }

        await tx
          .update(schema.draftItems)
          .set({
            data,
            deletedAt,
            revision,
            provenance: item.provenance as Provenance,
            updatedBy: researcherId,
            updatedAt: now,
          })
          .where(eq(schema.draftItems.id, item.id));

        await tx.insert(schema.draftItemHistory).values({
          itemId: item.id,
          draftId,
          changeId: undoChangeId,
          revision,
          action: "undo",
          data,
          previousData: item.data,
          researcherId,
        });
      }

      await tx
        .update(schema.draftItemHistory)
        .set({ undoneBy: undoChangeId })
        .where(
          and(
            eq(schema.draftItemHistory.draftId, draftId),
            eq(schema.draftItemHistory.changeId, changeId),
          ),
        );
      await tx
        .update(schema.studyDrafts)
        .set({ updatedAt: now })
        .where(eq(schema.studyDrafts.id, draftId));

      return { undone: rows.length };
    })
    .catch((error: unknown) => {
      if (error instanceof ChangedSince) {
        return STALE;
      }
      throw error;
    });
}
