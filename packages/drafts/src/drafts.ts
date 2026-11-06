import {
  DEFAULT_TEMPLATE,
  hasErrors,
  type StudyIssue,
  type StudySettings,
  validateStudy,
} from "@truman3/core";
import { type Database, schema, type Transaction } from "@truman3/db";
import { freezeStudy } from "@truman3/study-import";
import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { draftToDefinition } from "./definition.ts";
import { type DraftItem, type ItemKind, itemDataSchemas, type Provenance } from "./items.ts";
import {
  applySections,
  isSectionName,
  pageKeyOf,
  pageKeySchema,
  pageTextSchema,
  SETTINGS_SECTIONS,
  type SectionItem,
  type SectionState,
  sectionValue,
} from "./sections.ts";

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

export async function writeHistory(
  tx: Transaction,
  rows: {
    itemId: string;
    draftId: string;
    revision: number;
    action: "create" | "update" | "delete" | "undo";
    data: unknown;
    previousData?: unknown;
    researcherId: string;
  }[],
) {
  // Everything written together is one change, so it can be undone together.
  const changeId = crypto.randomUUID();
  for (const batch of chunks(rows, INSERT_BATCH_SIZE)) {
    await tx.insert(schema.draftItemHistory).values(batch.map((row) => ({ ...row, changeId })));
  }
  return changeId;
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
    const spaces = await tx
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.studyVersionId, versionId));
    const content = await tx
      .select()
      .from(schema.content)
      .where(and(eq(schema.content.studyVersionId, versionId), isNull(schema.content.worldId)));
    const reactions = await tx
      .select()
      .from(schema.scriptedReactions)
      .where(eq(schema.scriptedReactions.studyVersionId, versionId));
    const removals = await tx
      .select()
      .from(schema.scriptedRemovals)
      .where(eq(schema.scriptedRemovals.studyVersionId, versionId));
    const labels = await tx
      .select()
      .from(schema.scriptedLabels)
      .where(eq(schema.scriptedLabels.studyVersionId, versionId));
    const flagAnswers = await tx
      .select()
      .from(schema.scriptedFlagAnswers)
      .where(eq(schema.scriptedFlagAnswers.studyVersionId, versionId));
    const bans = await tx
      .select()
      .from(schema.scriptedBans)
      .where(eq(schema.scriptedBans.studyVersionId, versionId));
    const reportAnswers = await tx
      .select()
      .from(schema.scriptedReportAnswers)
      .where(eq(schema.scriptedReportAnswers.studyVersionId, versionId));
    const autoRules = await tx
      .select()
      .from(schema.scriptedAutoRules)
      .where(eq(schema.scriptedAutoRules.studyVersionId, versionId))
      .orderBy(asc(schema.scriptedAutoRules.position));
    const appealAnswers = await tx
      .select()
      .from(schema.scriptedAppealAnswers)
      .where(eq(schema.scriptedAppealAnswers.studyVersionId, versionId))
      .orderBy(asc(schema.scriptedAppealAnswers.position));
    const contextNotes = await tx
      .select()
      .from(schema.scriptedContextNotes)
      .where(eq(schema.scriptedContextNotes.studyVersionId, versionId));
    const contentKinds = new Map(content.map(({ id, kind }) => [id, kind]));

    // New IDs up front, since items point at each other.
    const newId = new Map<string, string>();
    for (const row of [...actors, ...spaces, ...content]) {
      newId.set(row.id, crypto.randomUUID());
    }
    const asId = (oldId: string) => newId.get(oldId) as string;
    const spaceIdByKey = new Map(spaces.map(({ key, id }) => [key, asId(id)]));
    const actorFlair = (flair: Record<string, string> | undefined) => {
      const pairs = Object.entries(flair ?? {}).flatMap(([key, text]) => {
        const id = spaceIdByKey.get(key);
        return id ? [[id, text]] : [];
      });
      return pairs.length > 0 ? { spaceFlair: Object.fromEntries(pairs) } : {};
    };

    // In a frozen version a comment's parent can be another comment. A draft keeps both.
    const contentById = new Map(content.map((row) => [row.id, row]));
    const commentPlace = (comment: (typeof content)[number]) => {
      const parentId = comment.parentId as string;
      let top = contentById.get(parentId) as (typeof content)[number];
      while (top.parentId) {
        top = contentById.get(top.parentId) as (typeof content)[number];
      }
      return {
        postId: asId(top.id),
        ...(parentId === top.id ? {} : { replyToId: asId(parentId) }),
      };
    };

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
            ...optional("banner", profile.banner),
            ...optional("moderator", profile.moderator),
            ...optional("karma", profile.karma),
            ...optional("followers", profile.followers),
            ...optional("following", profile.following),
            ...optional("startsFollowed", profile.startsFollowed),
            ...optional("badge", profile.badge),
            ...optional("suggested", profile.suggested),
            ...actorFlair(profile.spaceFlair as Record<string, string> | undefined),
            conditions: actor.conditions,
            ...optional("class", actor.class),
          },
        };
      }),
      ...spaces.map((space) => ({
        id: asId(space.id),
        draftId: created.id,
        kind: "space",
        position: space.position,
        provenance: fromFile,
        data: {
          key: space.key,
          name: space.name,
          ...optional("description", space.description),
          ...optional("rules", space.rules),
          ...optional("picture", space.picture),
          ...optional("banner", space.banner),
          ...optional("accent", space.accent),
          startsJoined: space.startsJoined,
          ...optional("members", space.baseMembers),
          ...(space.postFlair.length > 0 ? { postFlair: space.postFlair } : {}),
          ...(space.userFlair.length > 0 ? { userFlair: space.userFlair } : {}),
          ...(space.requirePostFlair ? { requirePostFlair: true } : {}),
          conditions: space.conditions,
          ...optional("class", space.class),
        },
      })),
      ...content
        .filter(({ kind }) => kind !== "story")
        .map((item, index) => {
          const shared = {
            ref: item.sourceRef ?? item.id,
            body: item.body,
            actorId: asId(item.authorActorId),
            timeMs: item.offsetMs ?? 0,
            likes: item.baseLikes,
            ups: item.baseUps,
            downs: item.baseDowns,
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
                ? {
                    ...shared,
                    ...optional("title", item.title),
                    ...optional("link", item.linkUrl),
                    ...(item.pinnedOn.length > 0 ? { pinnedOn: item.pinnedOn } : {}),
                    ...(item.locked ? { locked: true } : {}),
                    ...(item.tags.length > 0 ? { tags: item.tags } : {}),
                    ...(item.poll ? { poll: item.poll } : {}),
                    ...optional("flair", item.flair),
                    ...(item.crosspostOf ? { crosspostOfId: asId(item.crosspostOf) } : {}),
                    ...(item.repostOf ? { repostOfId: asId(item.repostOf) } : {}),
                    ...(item.quoteOf ? { quoteOfId: asId(item.quoteOf) } : {}),
                    ...(item.baseReposts ? { reposts: item.baseReposts } : {}),
                    ...(item.baseQuotes ? { quotes: item.baseQuotes } : {}),
                    ...optional("ad", item.adLabel),
                    ...(item.likedByActorId ? { likedById: asId(item.likedByActorId) } : {}),
                    ...optional("place", item.place),
                    ...(item.taggedActorIds.length > 0
                      ? { taggedIds: item.taggedActorIds.map(asId) }
                      : {}),
                    ...(item.tagsParticipant ? { tagsParticipant: true } : {}),
                    ...(item.baseViews ? { views: item.baseViews } : {}),
                    pictures: item.attachments.map(({ key }) => key),
                    ...(item.spaceId ? { spaceId: asId(item.spaceId) } : {}),
                  }
                : { ...shared, ...commentPlace(item) },
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
      ...removals.map((removal, position) => ({
        draftId: created.id,
        kind: "removal",
        position,
        provenance: fromFile,
        data: {
          on: contentKinds.get(removal.contentId),
          targetId: asId(removal.contentId),
          actorId: asId(removal.actorId),
          timeMs: removal.offsetMs,
          ...optional("reason", removal.reason),
          conditions: removal.conditions,
          ...optional("class", removal.class),
        },
      })),
      ...labels.map((labeling, position) => ({
        draftId: created.id,
        kind: "label",
        position,
        provenance: fromFile,
        data: {
          on: contentKinds.get(labeling.contentId),
          targetId: asId(labeling.contentId),
          actorId: asId(labeling.actorId),
          timeMs: labeling.offsetMs,
          label: labeling.label,
          hides: labeling.hides,
          ...optional("reason", labeling.reason),
          conditions: labeling.conditions,
          ...optional("class", labeling.class),
        },
      })),
      ...content
        .filter(({ kind }) => kind === "story")
        .map((story, position) => ({
          id: asId(story.id),
          draftId: created.id,
          kind: "story",
          position,
          provenance: fromFile,
          data: {
            ref: story.sourceRef ?? newRef("story", story.id),
            actorId: asId(story.authorActorId),
            ...(story.attachments[0] ? { picture: story.attachments[0].key } : {}),
            ...optional("caption", story.body || undefined),
            timeMs: story.offsetMs ?? 0,
            ...(story.lastsMs ? { lastsHours: story.lastsMs / 3_600_000 } : {}),
            ...optional("highlight", story.highlight),
            ...(story.closeFriends ? { closeFriends: true } : {}),
            conditions: story.conditions,
            ...optional("class", story.class),
          },
        })),
      ...contextNotes.map((note, position) => ({
        draftId: created.id,
        kind: "contextNote",
        position,
        provenance: fromFile,
        data: {
          ref: note.ref,
          targetId: asId(note.contentId),
          body: note.body,
          timeMs: note.offsetMs,
          ...(note.baseHelpful ? { helpful: note.baseHelpful } : {}),
          ...(note.baseNotHelpful ? { notHelpful: note.baseNotHelpful } : {}),
          conditions: note.conditions,
          ...optional("class", note.class),
        },
      })),
      ...autoRules.map((rule, position) => ({
        draftId: created.id,
        kind: "autoRule",
        position,
        provenance: fromFile,
        data: {
          ref: rule.ref,
          on: rule.on,
          match: rule.match,
          action: rule.action,
          actorId: asId(rule.actorId),
          afterMs: rule.afterMs,
          ...optional("message", rule.message),
          ...optional("holdOutcome", rule.holdOutcome),
          conditions: rule.conditions,
          ...optional("class", rule.class),
        },
      })),
      ...appealAnswers.map((answer, position) => ({
        draftId: created.id,
        kind: "appealAnswer",
        position,
        provenance: fromFile,
        data: {
          action: answer.action,
          actorId: asId(answer.actorId),
          afterMs: answer.afterMs,
          ...optional("message", answer.message),
          conditions: answer.conditions,
          ...optional("class", answer.class),
        },
      })),
      ...bans.map((ban, position) => ({
        draftId: created.id,
        kind: "ban",
        position,
        provenance: fromFile,
        data: {
          bannedActorId: asId(ban.bannedActorId),
          actorId: asId(ban.actorId),
          timeMs: ban.offsetMs,
          ...optional("reason", ban.reason),
          ...(ban.spaceId ? { spaceId: asId(ban.spaceId) } : {}),
          conditions: ban.conditions,
          ...optional("class", ban.class),
        },
      })),
      ...reportAnswers.map((answer, position) => ({
        draftId: created.id,
        kind: "reportAnswer",
        position,
        provenance: fromFile,
        data: {
          ...(answer.reportedActorId ? { reportedActorId: asId(answer.reportedActorId) } : {}),
          action: answer.action,
          actorId: asId(answer.actorId),
          afterMs: answer.afterMs,
          ...optional("message", answer.message),
          conditions: answer.conditions,
          ...optional("class", answer.class),
        },
      })),
      ...flagAnswers.map((answer, position) => ({
        draftId: created.id,
        kind: "flagAnswer",
        position,
        provenance: fromFile,
        data: {
          ...(answer.contentId
            ? { on: contentKinds.get(answer.contentId), targetId: asId(answer.contentId) }
            : {}),
          action: answer.action,
          actorId: asId(answer.actorId),
          afterMs: answer.afterMs,
          ...optional("message", answer.message),
          conditions: answer.conditions,
          ...optional("class", answer.class),
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
  /** The sections of settings saved so far. Any others are still as the draft started. */
  sections: Map<string, SectionState>;
}

/** A draft and its items that haven't been deleted. */
export async function loadDraft(
  db: Database | Transaction,
  draftId: string,
): Promise<LoadedDraft | null> {
  const [draft] = await db
    .select()
    .from(schema.studyDrafts)
    .where(eq(schema.studyDrafts.id, draftId));
  if (!draft) {
    return null;
  }
  const rows = await db
    .select()
    .from(schema.draftItems)
    .where(and(eq(schema.draftItems.draftId, draftId), isNull(schema.draftItems.deletedAt)))
    .orderBy(asc(schema.draftItems.position));

  return {
    draft,
    ...applySections(
      draft.settings,
      draft.pages as Record<string, string>,
      rows.filter(({ kind }) => kind === "setting"),
    ),
    items: rows.filter(({ kind }) => kind !== "setting"),
  };
}

/** The same checks a study written in files goes through. */
export function checkDraft({ settings, pages, items }: LoadedDraft): StudyIssue[] {
  const { definition, beatIssues } = draftToDefinition(settings, pages, items as DraftItem[]);
  return [...beatIssues, ...validateStudy(definition)];
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
  problem: "invalid" | "not-found" | "in-use" | "closed" | "stale";
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

/** Only images uploaded through the app, so a post can't point at anything else. */
export const STORED_IMAGE = /^media\/[0-9a-f]{64}\.(jpg|png|gif|webp)$/;

const MAX_SPACE_KEY_LENGTH = 50;
/** The same as a study file allows, since a draft becomes one. */
const SPACE_KEY = /^[a-z0-9][a-z0-9_-]*$/;

/** A readable, address-safe name for a space, such as "home-cooking" for "Home Cooking!". */
export function spaceKeyFromName(name: string) {
  const key = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SPACE_KEY_LENGTH)
    .replace(/^-+|-+$/g, "");
  return key || "space";
}

/** Whether a key is still the one made from this name, so it can follow a new name. */
function keyCameFromName(key: string, name: string) {
  const base = spaceKeyFromName(name);
  return key === base || (key.startsWith(`${base}-`) && /^\d+$/.test(key.slice(base.length + 1)));
}

function firstFreeKey(base: string, taken: ReadonlySet<string>) {
  if (!taken.has(base)) {
    return base;
  }
  let number = 2;
  while (taken.has(`${base}-${number}`)) {
    number += 1;
  }
  return `${base}-${number}`;
}

/** The keys other spaces in this draft use. */
async function otherSpaceKeys(tx: Transaction, draftId: string, itemId?: string) {
  const rows = await tx
    .select({ id: schema.draftItems.id, data: schema.draftItems.data })
    .from(schema.draftItems)
    .where(
      and(
        eq(schema.draftItems.draftId, draftId),
        eq(schema.draftItems.kind, "space"),
        isNull(schema.draftItems.deletedAt),
      ),
    );
  return new Set(
    rows.filter(({ id }) => id !== itemId).map(({ data }) => (data as { key: string }).key),
  );
}

/**
 * The keys a study's saved versions have used. Events and exports refer to a space by its key, so
 * one that's in a saved version keeps it, and a study's data reads the same across versions.
 */
export async function frozenSpaceKeys(db: Database | Transaction, studyId: string) {
  const rows = await db
    .selectDistinct({ key: schema.spaces.key })
    .from(schema.spaces)
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.spaces.studyVersionId))
    .where(eq(schema.studyVersions.studyId, studyId));
  return new Set(rows.map(({ key }) => key));
}

/** What a change to a space does to its key, or why it can't. */
async function nextSpaceKey(
  tx: Transaction,
  draftId: string,
  itemId: string,
  current: { key: string; name: string },
  changes: Record<string, unknown>,
): Promise<{ key: string } | EditProblem> {
  const chosen = typeof changes.key === "string" ? changes.key : null;
  if (chosen === current.key || (chosen === null && typeof changes.name !== "string")) {
    return { key: current.key };
  }
  if (chosen !== null && (!SPACE_KEY.test(chosen) || chosen.length > MAX_SPACE_KEY_LENGTH)) {
    return {
      problem: "invalid",
      message: "An address can use lowercase letters, numbers, dashes, and underscores.",
    };
  }

  const [draft] = await tx
    .select({ studyId: schema.studyDrafts.studyId })
    .from(schema.studyDrafts)
    .where(eq(schema.studyDrafts.id, draftId));
  const frozen = await frozenSpaceKeys(tx, draft?.studyId as string);
  if (frozen.has(current.key)) {
    return chosen === null
      ? { key: current.key }
      : {
          problem: "in-use",
          message: "This space is in a saved version, so its address can't change.",
        };
  }

  const taken = await otherSpaceKeys(tx, draftId, itemId);
  if (chosen !== null) {
    return taken.has(chosen)
      ? { problem: "in-use", message: "Another space already has that address." }
      : { key: chosen };
  }
  // Renamed, so its key follows, unless someone chose one themselves.
  return keyCameFromName(current.key, current.name)
    ? { key: firstFreeKey(spaceKeyFromName(changes.name as string), taken) }
    : { key: current.key };
}

/** Whether what an item points at is really in this draft. */
async function checkReferences(tx: Transaction, draftId: string, data: Record<string, unknown>) {
  if (typeof data.actorId === "string" && !(await itemExists(tx, draftId, "actor", data.actorId))) {
    return "That author isn't in this study.";
  }
  if (typeof data.postId === "string" && !(await itemExists(tx, draftId, "post", data.postId))) {
    return "That post isn't in this study.";
  }
  if (typeof data.spaceId === "string" && !(await itemExists(tx, draftId, "space", data.spaceId))) {
    return "That space isn't in this study.";
  }
  for (const key of ["bannedActorId", "reportedActorId"]) {
    if (typeof data[key] === "string" && !(await itemExists(tx, draftId, "actor", data[key]))) {
      return "That person isn't in this study.";
    }
  }
  if (
    typeof data.targetId === "string" &&
    !(await itemExists(tx, draftId, data.on === "comment" ? "comment" : "post", data.targetId))
  ) {
    return "What this removes isn't in this study.";
  }
  for (const key of ["repostOfId", "quoteOfId"]) {
    if (typeof data[key] === "string" && !(await itemExists(tx, draftId, "post", data[key]))) {
      return "That post isn't in this study.";
    }
  }
  if (
    typeof data.crosspostOfId === "string" &&
    !(await itemExists(tx, draftId, "post", data.crosspostOfId))
  ) {
    return "That post isn't in this study.";
  }
  if (
    typeof data.replyToId === "string" &&
    !(await itemExists(tx, draftId, "comment", data.replyToId))
  ) {
    return "That comment isn't in this study.";
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

/** Whether someone else in this draft already has this username, which has to be unique. */
async function usernameTaken(tx: Transaction, draftId: string, username: unknown, itemId?: string) {
  const actors = await tx
    .select({ id: schema.draftItems.id, data: schema.draftItems.data })
    .from(schema.draftItems)
    .where(
      and(
        eq(schema.draftItems.draftId, draftId),
        eq(schema.draftItems.kind, "actor"),
        isNull(schema.draftItems.deletedAt),
      ),
    );
  return actors.some(
    ({ id, data }) => id !== itemId && (data as { username: string }).username === username,
  );
}

/**
 * What's wrong with a username someone's giving a person in the cast. Only a new one is checked,
 * since studies from files can have older ones, which shouldn't stop anyone editing a bio.
 */
async function usernameProblem(
  tx: Transaction,
  draftId: string,
  username: unknown,
  itemId?: string,
): Promise<EditProblem | null> {
  if (typeof username !== "string" || !/^[A-Za-z0-9_.-]{1,30}$/.test(username)) {
    return {
      problem: "invalid",
      message: "A username can use letters, numbers, dots, dashes, and underscores.",
    };
  }
  return (await usernameTaken(tx, draftId, username, itemId)) ? USERNAME_TAKEN : null;
}

const USERNAME_TAKEN: EditProblem = {
  problem: "invalid",
  message: "Someone in the cast already has that username.",
};

/** Adds a post, comment, person in the cast, space, or moderator's decision, written by a researcher. */
export async function createItem(
  db: Database,
  draftId: string,
  researcherId: string,
  kind:
    | "post"
    | "comment"
    | "actor"
    | "space"
    | "removal"
    | "label"
    | "reaction"
    | "flagAnswer"
    | "ban"
    | "reportAnswer"
    | "autoRule"
    | "appealAnswer"
    | "contextNote"
    | "story",
  fields: Record<string, unknown>,
): Promise<{ id: string } | EditProblem> {
  return db.transaction(async (tx) => {
    if (!(await isOpen(tx, draftId))) {
      return CLOSED;
    }

    if (
      Array.isArray(fields.pictures) &&
      fields.pictures.some((picture) => !STORED_IMAGE.test(picture))
    ) {
      return { problem: "invalid" as const, message: "That picture isn't stored here." };
    }

    const id = crypto.randomUUID();
    const newItem = async () => {
      if (
        kind === "actor" ||
        kind === "removal" ||
        kind === "label" ||
        kind === "reaction" ||
        kind === "flagAnswer" ||
        kind === "ban" ||
        kind === "reportAnswer" ||
        kind === "appealAnswer"
      ) {
        return fields;
      }
      if (kind === "autoRule") {
        return { ...fields, ref: newRef("rule", id) };
      }
      if (kind === "contextNote") {
        return { ...fields, ref: newRef("note", id) };
      }
      if (kind === "story") {
        return { ...fields, ref: newRef("story", id) };
      }
      // A space's key is part of its address, so it's made from the name, and can be changed later.
      return kind === "space"
        ? {
            ...fields,
            key: firstFreeKey(
              spaceKeyFromName(String(fields.name ?? "")),
              await otherSpaceKeys(tx, draftId),
            ),
          }
        : { likes: 0, ...fields, ref: newRef(kind, id) };
    };
    const parsed = itemDataSchemas[kind].safeParse(await newItem());
    if (!parsed.success) {
      return {
        problem: "invalid" as const,
        message: parsed.error.issues[0]?.message ?? "That isn't complete.",
      };
    }
    if (kind === "actor") {
      const problem = await usernameProblem(tx, draftId, fields.username);
      if (problem) {
        return problem;
      }
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
    if (!item || item.kind === "setting") {
      return NOT_FOUND;
    }

    if (Array.isArray(changes.pictures)) {
      const current = (item.data as { pictures?: string[] }).pictures ?? [];
      const unknown = changes.pictures.some(
        (picture) => !STORED_IMAGE.test(picture) && !current.includes(picture),
      );
      if (unknown) {
        return { problem: "invalid" as const, message: "That picture isn't stored here." };
      }
    }

    let spaceKey: { key: string } | undefined;
    if (item.kind === "space") {
      const next = await nextSpaceKey(
        tx,
        draftId,
        itemId,
        item.data as { key: string; name: string },
        changes,
      );
      if ("problem" in next) {
        return next;
      }
      spaceKey = next;
    } else if ("key" in changes) {
      return { problem: "invalid" as const, message: "That change isn't valid." };
    }

    const merged = Object.fromEntries(
      Object.entries({ ...(item.data as object), ...changes, ...spaceKey }).filter(
        ([, value]) => value !== null,
      ),
    );
    const parsed = itemDataSchemas[item.kind as ItemKind].safeParse(merged);
    if (!parsed.success) {
      return {
        problem: "invalid" as const,
        message:
          item.kind === "actor"
            ? (parsed.error.issues[0]?.message ?? "That change isn't valid.")
            : "That change isn't valid.",
      };
    }
    if (item.kind === "actor" && merged.username !== (item.data as { username: string }).username) {
      const problem = await usernameProblem(tx, draftId, merged.username, itemId);
      if (problem) {
        return problem;
      }
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
      {
        itemId,
        draftId,
        revision,
        action: "update",
        data: parsed.data,
        previousData: item.data,
        researcherId,
      },
    ]);
    await touchDraft(tx, draftId);
    return { revision };
  });
}

/** Replaces a condition's name wherever an item is limited to it. */
function renameInItem(data: Record<string, unknown>, renames: Record<string, string>) {
  const conditions = (data.conditions ?? []) as string[];
  return conditions.some((key) => key in renames)
    ? { ...data, conditions: conditions.map((key) => renames[key] ?? key) }
    : null;
}

export interface SaveSection {
  section: string;
  value: unknown;
  /** The revision this edit started from, so nobody overwrites a change they haven't seen. */
  baseRevision: number;
  /** For conditions: old name to new name, so what's limited to a condition stays with it. */
  renames?: Record<string, string>;
}

/**
 * Saves one section of settings, or one page. Unlike a post, a section has many fields, so saving
 * over someone else's change could silently undo a field they set. That's refused instead.
 */
export async function saveSection(
  db: Database,
  draftId: string,
  researcherId: string,
  { section, value, baseRevision, renames = {} }: SaveSection,
): Promise<{ revision: number } | EditProblem> {
  const pageKey = pageKeyOf(section);
  if (pageKey !== null ? !pageKeySchema.safeParse(pageKey).success : !isSectionName(section)) {
    return { problem: "not-found", message: "That part of the settings doesn't exist." };
  }
  const parsed = (
    pageKey !== null ? pageTextSchema : SETTINGS_SECTIONS[section as keyof typeof SETTINGS_SECTIONS]
  ).safeParse(value);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where = issue?.path.join(" > ");
    return {
      problem: "invalid",
      message: `${where ? `${where}: ` : ""}${issue?.message ?? "That isn't valid."}`,
    };
  }

  return db.transaction(async (tx) => {
    // One save at a time, so two first saves of a section can't make two items for it.
    const [draft] = await tx
      .select()
      .from(schema.studyDrafts)
      .where(eq(schema.studyDrafts.id, draftId))
      .for("update");
    if (!draft || draft.closedAt) {
      return CLOSED;
    }

    const rows = await tx
      .select()
      .from(schema.draftItems)
      .where(and(eq(schema.draftItems.draftId, draftId), isNull(schema.draftItems.deletedAt)));
    const settingRows = rows.filter(({ kind }) => kind === "setting");
    const current = applySections(
      draft.settings,
      draft.pages as Record<string, string>,
      settingRows,
    );

    const existing = settingRows.find(({ data }) => (data as SectionItem).section === section);
    if ((existing?.revision ?? 0) !== baseRevision) {
      return {
        problem: "stale" as const,
        message: "Someone else saved this while you were editing it.",
      };
    }

    const before =
      pageKey !== null
        ? (current.pages[pageKey] ?? null)
        : sectionValue(current.settings, section as keyof typeof SETTINGS_SECTIONS);
    if (JSON.stringify(before) === JSON.stringify(parsed.data)) {
      return { revision: baseRevision };
    }

    if (section === "study") {
      // What's been written depends on it, so a study keeps the kind of platform it started with.
      const { platform: was } = before as { platform: StudySettings["platform"] };
      const { platform: now } = parsed.data as { platform: StudySettings["platform"] };
      if (
        (now.template !== undefined && now.template !== (was.template ?? DEFAULT_TEMPLATE)) ||
        (now.layout !== undefined && was.layout !== undefined && now.layout !== was.layout)
      ) {
        return {
          problem: "invalid" as const,
          message: "A study keeps the template it started with.",
        };
      }
      // A save that leaves them out isn't asking to change them.
      if (was.template) {
        now.template = was.template;
      }
      if (was.layout) {
        now.layout = was.layout;
      }
    }

    const historyRows: Parameters<typeof writeHistory>[1] = [];

    if (section === "conditions") {
      const { arms } = (parsed.data as { conditions: StudySettings["conditions"] }).conditions;
      const newKeys = new Set(arms.map(({ key }) => key));
      const oldKeys = current.settings.conditions.arms.map(({ key }) => key);
      if (newKeys.size !== arms.length) {
        return { problem: "invalid" as const, message: "Each condition needs its own name." };
      }

      if (Object.values(renames).some((key) => !newKeys.has(key))) {
        return { problem: "invalid" as const, message: "A renamed condition is missing." };
      }

      const content = rows.filter(({ kind }) => kind !== "setting");
      for (const key of oldKeys.filter((key) => !newKeys.has(key) && !(key in renames))) {
        const using = content.filter(({ data }) =>
          ((data as { conditions?: string[] }).conditions ?? []).includes(key),
        ).length;
        if (using > 0) {
          return {
            problem: "in-use" as const,
            message: `${using} ${using === 1 ? "item is" : "items are"} only shown in "${key}". Change ${using === 1 ? "it" : "them"} before removing this condition.`,
          };
        }
      }

      for (const item of content) {
        const data = renameInItem(item.data as Record<string, unknown>, renames);
        if (data) {
          const revision = item.revision + 1;
          await tx
            .update(schema.draftItems)
            .set({ data, revision, updatedBy: researcherId, updatedAt: new Date() })
            .where(eq(schema.draftItems.id, item.id));
          historyRows.push({
            itemId: item.id,
            draftId,
            revision,
            action: "update",
            data,
            previousData: item.data,
            researcherId,
          });
        }
      }
    }

    const data: SectionItem = { section, value: parsed.data };
    const revision = baseRevision + 1;
    let itemId = existing?.id;
    if (itemId) {
      await tx
        .update(schema.draftItems)
        .set({ data, revision, updatedBy: researcherId, updatedAt: new Date() })
        .where(eq(schema.draftItems.id, itemId));
    } else {
      const [created] = await tx
        .insert(schema.draftItems)
        .values({
          draftId,
          kind: "setting",
          data,
          revision,
          provenance: { origin: "researcher" },
          updatedBy: researcherId,
        })
        .returning({ id: schema.draftItems.id });
      itemId = created?.id as string;
    }
    // Last, so this is what the list of recent changes describes.
    historyRows.push({
      itemId,
      draftId,
      revision,
      action: "update",
      data,
      previousData: existing?.data ?? { section, value: before },
      researcherId,
    });
    await writeHistory(tx, historyRows);
    await touchDraft(tx, draftId);
    return { revision };
  });
}

/**
 * Moves a post in time, and its comments by the same amount, so a conversation stays together. This
 * also means dragging a post can't leave a comment timed before its post.
 */
export async function moveItem(
  db: Database,
  draftId: string,
  itemId: string,
  researcherId: string,
  timeMs: number,
): Promise<{ moved: number } | EditProblem> {
  return db.transaction(async (tx) => {
    if (!(await isOpen(tx, draftId))) {
      return CLOSED;
    }

    const rows = await tx
      .select()
      .from(schema.draftItems)
      .where(and(eq(schema.draftItems.draftId, draftId), isNull(schema.draftItems.deletedAt)))
      .for("update");
    const post = rows.find(({ id, kind }) => id === itemId && kind === "post");
    if (!post) {
      return NOT_FOUND;
    }

    const delta = timeMs - (post.data as { timeMs: number }).timeMs;
    if (delta === 0) {
      return { moved: 0 };
    }

    const moving = [
      post,
      ...rows.filter((row) => (row.data as { postId?: string }).postId === itemId),
    ];
    // A removal stays the same time after what it removes, the way a comment does after its post.
    const movingIds = new Set(moving.map(({ id }) => id));
    moving.push(
      ...rows.filter(
        (row) =>
          (row.kind === "removal" || row.kind === "label" || row.kind === "contextNote") &&
          movingIds.has((row.data as { targetId: string }).targetId),
      ),
    );
    const history: Parameters<typeof writeHistory>[1] = [];
    for (const row of moving) {
      const data = row.data as { timeMs: number };
      const updated = { ...data, timeMs: data.timeMs + delta };
      await tx
        .update(schema.draftItems)
        .set({
          data: updated,
          revision: row.revision + 1,
          provenance: { ...(row.provenance as Provenance), edited: true },
          updatedBy: researcherId,
          updatedAt: new Date(),
        })
        .where(eq(schema.draftItems.id, row.id));
      history.push({
        itemId: row.id,
        draftId,
        revision: row.revision + 1,
        action: "update",
        data: updated,
        previousData: row.data,
        researcherId,
      });
    }
    await writeHistory(tx, history);
    await touchDraft(tx, draftId);
    return { moved: moving.length };
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
    if (!item || item.kind === "setting") {
      return NOT_FOUND;
    }

    const points = (
      row: ItemRow,
      key:
        | "actorId"
        | "postId"
        | "spaceId"
        | "crosspostOfId"
        | "bannedActorId"
        | "reportedActorId"
        | "repostOfId"
        | "quoteOfId",
    ) => (row.data as Record<string, unknown>)[key] === itemId;

    if (item.kind === "space" && rows.some((row) => points(row, "spaceId"))) {
      return { problem: "in-use" as const, message: "This space still has posts in it." };
    }
    if (
      item.kind === "post" &&
      rows.some((row) => points(row, "repostOfId") || points(row, "quoteOfId"))
    ) {
      return { problem: "in-use" as const, message: "Another post reposts or quotes this one." };
    }
    if (item.kind === "post" && rows.some((row) => points(row, "crosspostOfId"))) {
      return { problem: "in-use" as const, message: "Another post is a crosspost of this one." };
    }
    if (
      item.kind === "actor" &&
      rows.some(
        (row) =>
          points(row, "actorId") || points(row, "bannedActorId") || points(row, "reportedActorId"),
      )
    ) {
      return {
        problem: "in-use" as const,
        message: "This person still has posts, comments, or decisions as a moderator.",
      };
    }

    // Replies go with what they reply to, however far down.
    const removing = [item, ...rows.filter((row) => points(row, "postId"))];
    const removingIds = new Set(removing.map(({ id }) => id));
    for (let i = 0; i < removing.length; i++) {
      for (const row of rows) {
        const { replyToId } = row.data as { replyToId?: string };
        if (replyToId === removing[i]?.id && !removingIds.has(row.id)) {
          removingIds.add(row.id);
          removing.push(row);
        }
      }
    }
    // So does a moderator's removal of anything going.
    for (const row of rows) {
      const { targetId } = row.data as { targetId?: string };
      if (
        (row.kind === "removal" ||
          row.kind === "label" ||
          row.kind === "flagAnswer" ||
          row.kind === "contextNote") &&
        targetId &&
        removingIds.has(targetId)
      ) {
        removingIds.add(row.id);
        removing.push(row);
      }
    }
    await tx
      .update(schema.draftItems)
      .set({
        deletedAt: new Date(),
        updatedBy: researcherId,
        revision: sql`${schema.draftItems.revision} + 1`,
      })
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
        previousData: row.data,
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

  const { definition, mediaKeys, provenance, beatIssues } = draftToDefinition(
    loaded.settings,
    loaded.pages,
    loaded.items as DraftItem[],
  );
  const issues = [...beatIssues, ...validateStudy(definition)];
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
