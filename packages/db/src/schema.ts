import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;

/** A research team. One lab for now, and a hosted version could hold many (see ADR 11). */
export const teams = pgTable("teams", {
  id: id(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const researchers = pgTable("researchers", {
  id: id(),
  /** Stored in lowercase. */
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const teamMemberships = pgTable(
  "team_memberships",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    researcherId: uuid("researcher_id")
      .notNull()
      .references(() => researchers.id),
    role: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.researcherId] }),
    check("team_memberships_role", inList(table.role, ["owner", "editor", "viewer"])),
  ],
);

/** Researchers' signed-in sessions, kept apart from participants'. Only a hash is stored. */
export const researcherSessions = pgTable(
  "researcher_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    researcherId: uuid("researcher_id")
      .notNull()
      .references(() => researchers.id, { onDelete: "cascade" }),
    createdAt: time("created_at").notNull().defaultNow(),
    expiresAt: time("expires_at").notNull(),
  },
  (table) => [index("researcher_sessions_researcher").on(table.researcherId)],
);

export const studies = pgTable("studies", {
  id: id(),
  /** Empty only for studies imported before any team exists. */
  teamId: uuid("team_id").references(() => teams.id),
  slug: text().notNull().unique(),
  /** The version new participants get. Empty means it isn't open to new participants. */
  liveVersionId: uuid("live_version_id").references((): AnyPgColumn => studyVersions.id),
  createdAt: time("created_at").notNull().defaultNow(),
});

export const studyVersions = pgTable(
  "study_versions",
  {
    id: id(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    version: integer().notNull(),
    /** The study's resolved settings, frozen. Includes the values of anything that was defaulted. */
    settings: jsonb().notNull(),
    /** Page text, keyed by the name the flow uses. */
    pages: jsonb().notNull().default({}),
    /** Identifies this exact content, so importing it twice doesn't create a new version. */
    contentHash: text("content_hash").notNull(),
    /** Seeds everything random about the version, like like counts and assignment blocks. */
    seed: bigint({ mode: "number" }).notNull(),
    frozenAt: time("frozen_at"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.studyId, table.version)],
);

export const conditions = pgTable(
  "conditions",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    key: text().notNull(),
    factors: jsonb().notNull().default({}),
    weight: integer().notNull().default(1),
  },
  (table) => [
    unique().on(table.studyVersionId, table.key),
    unique().on(table.id, table.studyVersionId),
    check("conditions_weight_positive", sql`${table.weight} > 0`),
  ],
);

export const worlds = pgTable(
  "worlds",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    mode: text().notNull().default("solo"),
    seed: bigint({ mode: "number" }).notNull(),
    startedAt: time("started_at").notNull().defaultNow(),
    closedAt: time("closed_at"),
  },
  (table) => [check("worlds_mode", inList(table.mode, ["solo", "shared"]))],
);

export const participants = pgTable(
  "participants",
  {
    id: id(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    /** The recruitment ID, such as a Prolific ID. Exports use `id` instead. */
    externalId: text("external_id").notNull(),
    source: text().notNull(),
    status: text().notNull().default("active"),
    /** Which step of the study's flow they're on, counting from 0. */
    flowPosition: integer("flow_position").notNull().default(0),
    /** A researcher trying a study. Kept out of exports and counts. */
    isPilot: boolean("is_pilot").notNull().default(false),
    enrolledAt: time("enrolled_at").notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.studyId, table.externalId),
    check("participants_status", inList(table.status, ["active", "completed", "withdrawn"])),
  ],
);

/** Everyone who appears in a feed. The cast belongs to a version; participants to a world. */
export const actors = pgTable(
  "actors",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    worldId: uuid("world_id").references(() => worlds.id),
    participantId: uuid("participant_id").references(() => participants.id),
    username: text().notNull(),
    profile: jsonb().notNull().default({}),
    driver: text().notNull(),
    driverConfig: jsonb("driver_config").notNull().default({}),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [
    uniqueIndex("actors_cast_username")
      .on(table.studyVersionId, table.username)
      .where(sql`${table.worldId} is null`),
    uniqueIndex("actors_world_username")
      .on(table.worldId, table.username)
      .where(sql`${table.worldId} is not null`),
    check("actors_driver", inList(table.driver, ["scripted", "llm", "human"])),
    check(
      "actors_human_is_participant",
      sql`(${table.driver} = 'human') = (${table.participantId} is not null)`,
    ),
    check(
      "actors_participant_has_world",
      sql`${table.participantId} is null or ${table.worldId} is not null`,
    ),
  ],
);

export const worldMemberships = pgTable(
  "world_memberships",
  {
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    joinedAt: time("joined_at").notNull().defaultNow(),
    notificationsViewedAt: time("notifications_viewed_at"),
    leftAt: time("left_at"),
  },
  (table) => [primaryKey({ columns: [table.worldId, table.participantId] })],
);

/** Append-only. Every (re-)randomization, with what's needed to analyze it. */
export const assignments = pgTable(
  "assignments",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    studyVersionId: uuid("study_version_id").notNull(),
    conditionId: uuid("condition_id").notNull(),
    /** Empty for the first assignment. Used for re-randomization in adaptive designs. */
    decisionPoint: text("decision_point"),
    method: text().notNull(),
    probability: numeric({ mode: "number" }).notNull(),
    /** Method-specific details, such as the block and position for blocked assignment. */
    details: jsonb().notNull().default({}),
    assignedAt: time("assigned_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.conditionId, table.studyVersionId],
      foreignColumns: [conditions.id, conditions.studyVersionId],
    }),
    check("assignments_probability", sql`${table.probability} > 0 and ${table.probability} <= 1`),
  ],
);

/** Where each version is in its assignment sequence. Survives withdrawals, unlike a count. */
export const assignmentCounters = pgTable("assignment_counters", {
  studyVersionId: uuid("study_version_id")
    .primaryKey()
    .references(() => studyVersions.id),
  nextPosition: integer("next_position").notNull().default(0),
});

/**
 * Posts and comments. Scripted content has an `offset_ms` from the start of a world. Content
 * created in a world, such as a participant's comment, has a `world_id` and a `visible_at`.
 */
export const content = pgTable(
  "content",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    worldId: uuid("world_id").references(() => worlds.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => content.id),
    authorActorId: uuid("author_actor_id")
      .notNull()
      .references(() => actors.id),
    kind: text().notNull(),
    body: text().notNull().default(""),
    mediaKey: text("media_key"),
    offsetMs: bigint("offset_ms", { mode: "number" }),
    visibleAt: time("visible_at"),
    /** Its order in the study definition, for the scripted ranker. */
    position: integer(),
    baseLikes: integer("base_likes").notNull().default(0),
    /** Where it came from: a file, a researcher, a pack, or a model. See packages/drafts. */
    provenance: jsonb().notNull().default({}),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
    /** The ID this had in the study definition, such as a row in posts.csv. */
    sourceRef: text("source_ref"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("content_scripted_feed")
      .on(table.studyVersionId, table.offsetMs)
      .where(sql`${table.worldId} is null and ${table.kind} = 'post'`),
    index("content_world_feed")
      .on(table.worldId, table.visibleAt)
      .where(sql`${table.worldId} is not null`),
    index("content_parent").on(table.parentId),
    check("content_kind", inList(table.kind, ["post", "comment"])),
    check(
      "content_comment_has_parent",
      sql`(${table.kind} = 'comment') = (${table.parentId} is not null)`,
    ),
    check(
      "content_timing",
      sql`(${table.worldId} is null and ${table.offsetMs} is not null and ${table.visibleAt} is null)
        or (${table.worldId} is not null and ${table.visibleAt} is not null and ${table.offsetMs} is null)`,
    ),
  ],
);

/** What scripted actors do in response to a participant's nth post or comment. */
export const scriptedReactions = pgTable(
  "scripted_reactions",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    on: text().notNull(),
    nth: integer().notNull(),
    type: text().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    afterMs: bigint("after_ms", { mode: "number" }).notNull(),
    body: text(),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [
    index("scripted_reactions_trigger").on(table.studyVersionId, table.on, table.nth),
    check("scripted_reactions_on", inList(table.on, ["post", "comment"])),
    check("scripted_reactions_type", inList(table.type, ["read", "like", "reply"])),
  ],
);

/** Append-only. See docs/adr/0006-append-only-event-log.md. */
export const events = pgTable(
  "events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    type: text().notNull(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    participantId: uuid("participant_id").references(() => participants.id),
    /** The participant's condition at that moment, which can change in adaptive designs. */
    conditionId: uuid("condition_id").references(() => conditions.id),
    actorId: uuid("actor_id").references(() => actors.id),
    source: text().notNull(),
    targetContentId: uuid("target_content_id").references(() => content.id),
    targetActorId: uuid("target_actor_id").references(() => actors.id),
    payload: jsonb().notNull().default({}),
    /** Generated by the browser per action, so a retried request isn't counted twice. */
    clientEventId: uuid("client_event_id"),
    occurredAt: time("occurred_at").notNull(),
    recordedAt: time("recorded_at").notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.worldId, table.clientEventId),
    index("events_world").on(table.worldId, table.id),
    index("events_participant").on(table.participantId, table.id),
    index("events_version_type").on(table.studyVersionId, table.type, table.id),
    check(
      "events_source",
      inList(table.source, ["participant", "script", "llm", "researcher", "system"]),
    ),
  ],
);

/**
 * What each person currently has done to content, so feeds can be drawn quickly. The history is in
 * `events`. A row is written in the same transaction as its event, and exports never read this.
 */
export const contentInteractions = pgTable(
  "content_interactions",
  {
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    kind: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.worldId, table.actorId, table.contentId, table.kind] }),
    check("content_interactions_kind", inList(table.kind, ["like", "flag", "view"])),
  ],
);

/** The same idea as content_interactions, for what someone has done to another actor. */
export const actorRelations = pgTable(
  "actor_relations",
  {
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    targetActorId: uuid("target_actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    kind: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.worldId, table.actorId, table.targetActorId, table.kind] }),
    check("actor_relations_kind", inList(table.kind, ["follow", "block", "report"])),
  ],
);

/**
 * Scripted reactions to a participant, with when they come due. Notifications and like counts only
 * count ones that are due, so this needs no background worker.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    recipientActorId: uuid("recipient_actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    type: text().notNull(),
    /** The participant's post or comment this reacts to. */
    targetContentId: uuid("target_content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    /** For a reply, the comment that holds its text. */
    replyContentId: uuid("reply_content_id").references(() => content.id, { onDelete: "cascade" }),
    dueAt: time("due_at").notNull(),
  },
  (table) => [
    index("notifications_recipient").on(table.worldId, table.recipientActorId, table.dueAt),
    check("notifications_type", inList(table.type, ["read", "like", "reply"])),
  ],
);

/** What each viewer was actually shown, in order. */
export const feedImpressions = pgTable(
  "feed_impressions",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id),
    viewerActorId: uuid("viewer_actor_id")
      .notNull()
      .references(() => actors.id),
    conditionId: uuid("condition_id").references(() => conditions.id),
    /** Where this was shown, such as the feed or someone's profile. */
    surface: text().notNull().default("feed"),
    ranker: text().notNull(),
    rankerVersion: text("ranker_version").notNull(),
    /** The seed used for this order, so it can be reproduced. */
    seed: bigint({ mode: "number" }),
    items: jsonb().notNull(),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    shownAt: time("shown_at").notNull().defaultNow(),
  },
  (table) => [index("feed_impressions_world").on(table.worldId, table.id)],
);

/**
 * A participant's signed-in sessions. Only a hash of the token is stored, so reading this table
 * doesn't let anyone sign in as a participant.
 */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    createdAt: time("created_at").notNull().defaultNow(),
    expiresAt: time("expires_at").notNull(),
  },
  (table) => [index("sessions_participant").on(table.participantId)],
);

/**
 * Recruitment IDs that can't enter a study again, because that person withdrew. Stores a hash, per
 * study, so it can't be read back, doesn't link to the deleted data, and doesn't connect a person
 * across studies. They can still join a different study.
 */
export const excludedEntries = pgTable(
  "excluded_entries",
  {
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    idHash: text("id_hash").notNull(),
  },
  (table) => [primaryKey({ columns: [table.studyId, table.idHash] })],
);

/** Each time a study was launched or closed to new participants, and by whom. */
export const studyLaunches = pgTable(
  "study_launches",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    /** Empty when this closed the study. */
    versionId: uuid("version_id").references(() => studyVersions.id),
    action: text().notNull(),
    by: text().notNull(),
    at: time("at").notNull().defaultNow(),
  },
  (table) => [
    index("study_launches_study").on(table.studyId, table.id),
    check("study_launches_action", inList(table.action, ["launch", "stop"])),
  ],
);

/** A version of a study being worked on. A study has at most one open at a time. */
export const studyDrafts = pgTable(
  "study_drafts",
  {
    id: id(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    basedOnVersionId: uuid("based_on_version_id").references(() => studyVersions.id),
    settings: jsonb().notNull(),
    pages: jsonb().notNull().default({}),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => researchers.id),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    /** When it was saved as a version. After that it can't be edited. */
    closedAt: time("closed_at"),
    frozenVersionId: uuid("frozen_version_id").references(() => studyVersions.id),
  },
  (table) => [
    uniqueIndex("study_drafts_one_open").on(table.studyId).where(sql`${table.closedAt} is null`),
  ],
);

/**
 * One actor, post, comment, reaction, or section of settings in a draft, saved on its own so several people can work at
 * once without conflicting.
 */
export const draftItems = pgTable(
  "draft_items",
  {
    id: id(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => studyDrafts.id),
    kind: text().notNull(),
    data: jsonb().notNull(),
    /** Where it came from. Written from the start, since it can't be reconstructed later. */
    provenance: jsonb().notNull(),
    position: integer().notNull().default(0),
    revision: integer().notNull().default(1),
    updatedBy: uuid("updated_by").references(() => researchers.id),
    updatedAt: time("updated_at").notNull().defaultNow(),
    /** Removed items stay, so they can be restored. */
    deletedAt: time("deleted_at"),
  },
  (table) => [
    index("draft_items_draft").on(table.draftId, table.kind),
    check(
      "draft_items_kind",
      inList(table.kind, ["actor", "post", "comment", "reaction", "setting"]),
    ),
  ],
);

/** Every change to a draft item: who, when, and what it became. */
export const draftItemHistory = pgTable(
  "draft_item_history",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    itemId: uuid("item_id").notNull(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => studyDrafts.id),
    /** What one action changed together, like a post and the comments moved with it. */
    changeId: uuid("change_id").notNull().default(sql`uuidv7()`),
    revision: integer().notNull(),
    action: text().notNull(),
    data: jsonb().notNull(),
    /** What it was before, so this can be undone. */
    previousData: jsonb("previous_data"),
    /** The change that undid this one. */
    undoneBy: uuid("undone_by"),
    researcherId: uuid("researcher_id")
      .notNull()
      .references(() => researchers.id),
    at: time("at").notNull().defaultNow(),
  },
  (table) => [index("draft_item_history_item").on(table.itemId, table.id)],
);

/** Who has a draft open right now, and what they're editing. */
export const draftPresence = pgTable(
  "draft_presence",
  {
    draftId: uuid("draft_id")
      .notNull()
      .references(() => studyDrafts.id, { onDelete: "cascade" }),
    researcherId: uuid("researcher_id")
      .notNull()
      .references(() => researchers.id, { onDelete: "cascade" }),
    itemId: uuid("item_id"),
    /** The section of settings they're editing, if any. */
    section: text(),
    lastSeen: time("last_seen").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.draftId, table.researcherId] })],
);

/** A record that a participant's data was deleted. Holds no data about what was deleted. */
export const dataDeletions = pgTable("data_deletions", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  participantId: uuid("participant_id").notNull(),
  /** Which study, so reports can say how many people declined or withdrew. */
  studyId: uuid("study_id").references(() => studies.id),
  reason: text().notNull(),
  requestedBy: text("requested_by").notNull(),
  eventsDeleted: integer("events_deleted").notNull(),
  deletedAt: time("deleted_at").notNull().defaultNow(),
});
