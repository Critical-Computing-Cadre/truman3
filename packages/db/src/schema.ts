import type { Attachment, Flair, Poll } from "@truman3/core";
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
  /**
   * Christof's kill switches: stops live writing for the whole study, or for these people in the
   * cast, by username, at once. Beats still happen, with their fallback lines. See ADR 52.
   */
  livePaused: boolean("live_paused").notNull().default(false),
  pausedActors: text("paused_actors").array().notNull().default(sql`'{}'`),
  /** Whether launching a version whose scenario tests haven't passed shows a warning. ADR 57. */
  warnUntested: boolean("warn_untested").notNull().default(true),
  /** When it was archived: hidden from the Studies page until it's restored. ADR 58. */
  archivedAt: time("archived_at"),
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
    check("conditions_weight_nonnegative", sql`${table.weight} >= 0`),
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

/** A community posts can belong to. These are part of a version, so they freeze with it. */
export const spaces = pgTable(
  "spaces",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    rules: text(),
    picture: text(),
    /** A wide image across the top of its page. */
    banner: text(),
    /** Its color, as #rrggbb. */
    accent: text(),
    startsJoined: boolean("starts_joined").notNull().default(true),
    /** How many members it says it has, before this participant. Null shows no number. */
    baseMembers: integer("base_members"),
    /** What posts in it can be labeled with. */
    postFlair: jsonb("post_flair").$type<Flair[]>().notNull().default([]),
    /** What people in it can show beside their name. */
    userFlair: jsonb("user_flair").$type<Flair[]>().notNull().default([]),
    /** Whether a post a participant writes here has to have flair. */
    requirePostFlair: boolean("require_post_flair").notNull().default(false),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
    position: integer().notNull().default(0),
  },
  (table) => [uniqueIndex("spaces_version_key").on(table.studyVersionId, table.key)],
);

/**
 * Who has joined or left a space. There's only a row once someone has done either, and until then
 * the space's starts_joined decides. Every change is also an event.
 */
export const spaceMemberships = pgTable(
  "space_memberships",
  {
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    joined: boolean().notNull(),
    /** The flair this person chose to show here. */
    flair: text(),
  },
  (table) => [primaryKey({ columns: [table.worldId, table.actorId, table.spaceId] })],
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
    /** The one space a post belongs to. Comments go where their post goes. */
    spaceId: uuid("space_id").references(() => spaces.id),
    authorActorId: uuid("author_actor_id")
      .notNull()
      .references(() => actors.id),
    kind: text().notNull(),
    /** A post's title, on a platform with titles. */
    title: text(),
    body: text().notNull().default(""),
    /** Where a post links to. The server never fetches it. */
    linkUrl: text("link_url"),
    /** The lists a study keeps this post on top of. */
    pinnedOn: text("pinned_on").array().notNull().default(sql`'{}'`),
    /** Whether a study has stopped comments on this post. */
    locked: boolean().notNull().default(false),
    /** Why it's covered until someone clicks it. */
    tags: text().array().notNull().default(sql`'{}'`),
    /** A post's poll, with the counts it starts from. */
    poll: jsonb().$type<Poll>(),
    /** A post's label, from its space's list. */
    flair: text(),
    /** The post this was crossposted from. */
    crosspostOf: uuid("crosspost_of").references((): AnyPgColumn => content.id),
    /** The post this passes along, which can be another repost. */
    repostOf: uuid("repost_of").references((): AnyPgColumn => content.id),
    /** The post this quotes. */
    quoteOf: uuid("quote_of").references((): AnyPgColumn => content.id),
    /** How long a story lasts. Null is a day. */
    lastsMs: bigint("lasts_ms", { mode: "number" }),
    /** Someone in the cast who liked it, for "Liked by ... and others." */
    likedByActorId: uuid("liked_by_actor_id").references(() => actors.id),
    /** Where it says it was. */
    place: text(),
    /** People in the cast tagged in it. Each is checked against the cast when a study is saved. */
    taggedActorIds: uuid("tagged_actor_ids").array().notNull().default(sql`'{}'`),
    /** Whether a study tagged whoever is taking part. Each participant gets a notification. */
    tagsParticipant: boolean("tags_participant").notNull().default(false),
    /** For a story, the highlight on its poster's profile that keeps it. */
    highlight: text(),
    /** For a story, whether it's only for its poster's close friends. */
    closeFriends: boolean("close_friends").notNull().default(false),
    /** Marks it as an ad, with this label. */
    adLabel: text("ad_label"),
    baseViews: integer("base_views").notNull().default(0),
    baseReposts: integer("base_reposts").notNull().default(0),
    baseQuotes: integer("base_quotes").notNull().default(0),
    /** Its files, in order. Each has a type and a stored key or hosted URL. */
    attachments: jsonb().$type<Attachment[]>().notNull().default([]),
    offsetMs: bigint("offset_ms", { mode: "number" }),
    visibleAt: time("visible_at"),
    /** Its order in the study definition, for the scripted ranker. */
    position: integer(),
    baseLikes: integer("base_likes").notNull().default(0),
    baseUps: integer("base_ups").notNull().default(0),
    baseDowns: integer("base_downs").notNull().default(0),
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
    check("content_kind", inList(table.kind, ["post", "comment", "story"])),
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
    check("scripted_reactions_on", inList(table.on, ["post", "comment", "story"])),
    check(
      "scripted_reactions_type",
      inList(table.type, [
        "read",
        "like",
        "reply",
        "up",
        "down",
        "remove",
        "warn",
        "label",
        "repost",
        "follow",
      ]),
    ),
  ],
);

/** A moderator taking down something the study wrote, at a set time after someone starts. */
export const scriptedRemovals = pgTable(
  "scripted_removals",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    offsetMs: bigint("offset_ms", { mode: "number" }).notNull(),
    reason: text(),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [index("scripted_removals_version").on(table.studyVersionId)],
);

/** A moderator labeling something the study wrote, such as "Spam", at a set time after someone starts. */
export const scriptedLabels = pgTable(
  "scripted_labels",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    offsetMs: bigint("offset_ms", { mode: "number" }).notNull(),
    label: text().notNull(),
    /** Whether it covers what it's on until someone presses Show. */
    hides: boolean().notNull().default(false),
    reason: text(),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [index("scripted_labels_version").on(table.studyVersionId)],
);

/** What a moderator does when someone flags something. Without a content ID, it's for any flag. */
export const scriptedFlagAnswers = pgTable(
  "scripted_flag_answers",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    contentId: uuid("content_id").references(() => content.id),
    action: text().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    afterMs: bigint("after_ms", { mode: "number" }).notNull(),
    message: text(),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [
    index("scripted_flag_answers_version").on(table.studyVersionId),
    check("scripted_flag_answers_action", inList(table.action, ["remove", "answer"])),
  ],
);

/** A moderator banning someone in the cast, at a set time after someone starts. */
export const scriptedBans = pgTable(
  "scripted_bans",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    bannedActorId: uuid("banned_actor_id")
      .notNull()
      .references(() => actors.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    offsetMs: bigint("offset_ms", { mode: "number" }).notNull(),
    reason: text(),
    /** The one space they're banned from. Without it, everywhere. */
    spaceId: uuid("space_id").references(() => spaces.id),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [index("scripted_bans_version").on(table.studyVersionId)],
);

/** What a moderator does when someone reports a person. Without someone named, it's for any report. */
export const scriptedReportAnswers = pgTable(
  "scripted_report_answers",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    reportedActorId: uuid("reported_actor_id").references(() => actors.id),
    action: text().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    afterMs: bigint("after_ms", { mode: "number" }).notNull(),
    message: text(),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [
    index("scripted_report_answers_version").on(table.studyVersionId),
    check("scripted_report_answers_action", inList(table.action, ["answer", "ban"])),
  ],
);

/** Words in what a participant writes bringing a moderator's response. */
export const scriptedAutoRules = pgTable(
  "scripted_auto_rules",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    /** Its ID in the study, which records use. */
    ref: text().notNull(),
    on: text().notNull(),
    match: text().notNull(),
    action: text().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    afterMs: bigint("after_ms", { mode: "number" }).notNull(),
    message: text(),
    holdOutcome: text("hold_outcome"),
    /** Its order in the study. The first that matches applies. */
    position: integer().notNull(),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [
    index("scripted_auto_rules_version").on(table.studyVersionId),
    check("scripted_auto_rules_on", inList(table.on, ["post", "comment", "both"])),
    check(
      "scripted_auto_rules_action",
      inList(table.action, ["confirm", "remove", "warn", "hold"]),
    ),
  ],
);

/** What a moderator says to an appeal. */
export const scriptedAppealAnswers = pgTable(
  "scripted_appeal_answers",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    action: text().notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    afterMs: bigint("after_ms", { mode: "number" }).notNull(),
    message: text(),
    position: integer().notNull(),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [
    index("scripted_appeal_answers_version").on(table.studyVersionId),
    check("scripted_appeal_answers_action", inList(table.action, ["uphold", "restore"])),
  ],
);

/** A note on a post, as if readers had added context, from a set time. */
export const scriptedContextNotes = pgTable(
  "scripted_context_notes",
  {
    id: id(),
    studyVersionId: uuid("study_version_id")
      .notNull()
      .references(() => studyVersions.id),
    /** Its ID in the study, which records use. */
    ref: text().notNull(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id),
    body: text().notNull(),
    offsetMs: bigint("offset_ms", { mode: "number" }).notNull(),
    baseHelpful: integer("base_helpful").notNull().default(0),
    baseNotHelpful: integer("base_not_helpful").notNull().default(0),
    conditions: text().array().notNull().default(sql`'{}'`),
    class: text(),
  },
  (table) => [index("scripted_context_notes_version").on(table.studyVersionId)],
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
    /** With the kind `poll`, which option they chose. The key allows one row, so one choice. */
    pollOption: integer("poll_option"),
  },
  (table) => [
    primaryKey({ columns: [table.worldId, table.actorId, table.contentId, table.kind] }),
    check(
      "content_interactions_kind",
      inList(table.kind, [
        "like",
        "up",
        "down",
        "flag",
        "view",
        "save",
        "hide",
        "poll",
        "note_helpful",
        "note_not_helpful",
        "mute_thread",
      ]),
    ),
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
    check(
      "actor_relations_kind",
      inList(table.kind, ["follow", "block", "report", "mute", "closeFriend"]),
    ),
  ],
);

/**
 * A record of each study deleted for good, kept after the study is gone. Only a study that never had
 * real participants can be deleted. See ADR 58.
 */
export const studyDeletions = pgTable("study_deletions", {
  id: id(),
  /** Not a reference, since the study no longer exists. */
  studyId: uuid("study_id").notNull(),
  slug: text().notNull(),
  title: text().notNull(),
  requestedBy: text("requested_by").notNull(),
  deletedAt: time("deleted_at").notNull().defaultNow(),
});

/**
 * Each time a version's scenario tests ran on the server, and what came of them. The test
 * participants are deleted after each run, so this is all that's left of one. See ADR 57.
 */
export const scenarioRuns = pgTable("scenario_runs", {
  id: id(),
  studyVersionId: uuid("study_version_id")
    .notNull()
    .references(() => studyVersions.id),
  status: text({ enum: ["running", "passed", "failed", "error"] }).notNull(),
  /** Each scenario's name, whether it passed, and what wasn't as expected. */
  results: jsonb().notNull().default([]),
  /** Who started it, by name, or "saving a version" when it ran by itself. */
  startedBy: text("started_by").notNull(),
  startedAt: time("started_at").notNull().defaultNow(),
  finishedAt: time("finished_at"),
});

/**
 * Each time Christof, the director, considers a beat in a participant's world: what set it off,
 * when it's due, and then whether it happened and why not. It's the decision trace for beats, and
 * goes with the world on withdrawal. A beat waits as `pending` until it's due, and is decided then,
 * when someone next loads anything, so nothing has to run in the background. See ADR 51.
 */
export const beatRuns = pgTable(
  "beat_runs",
  {
    id: id(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    /** The beat, by its id in beats.yaml. */
    beat: text().notNull(),
    /** Which time this beat has run in this world, from 0, since a beat can have a limit. */
    run: integer().notNull(),
    /**
     * pending until it's due, then fired or skipped. A beat that needs a researcher's approval waits
     * as awaiting in between, with its draft in `writing`.
     */
    status: text().notNull(),
    /** What set it off: a time, something the participant did, or another beat. */
    trigger: jsonb().notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Why it didn't happen, in plain language. */
    reason: text(),
    /** Who did it, and what it made or acted on. */
    actorId: uuid("actor_id").references(() => actors.id, { onDelete: "cascade" }),
    contentId: uuid("content_id").references(() => content.id, { onDelete: "cascade" }),
    targetContentId: uuid("target_content_id").references(() => content.id, {
      onDelete: "cascade",
    }),
    /**
     * How the words were chosen, for a beat that improvises: the prompt, the model, what it wrote,
     * the check, and what it cost, or why the fallback line was used instead.
     */
    writing: jsonb(),
  },
  (table) => [
    uniqueIndex("beat_runs_once").on(table.worldId, table.beat, table.run),
    index("beat_runs_due").on(table.worldId, table.status, table.dueAt),
    check("beat_runs_status", inList(table.status, ["pending", "awaiting", "fired", "skipped"])),
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
    /** The post or comment this is about. Without it, it's about a person someone reported. */
    targetContentId: uuid("target_content_id").references(() => content.id, {
      onDelete: "cascade",
    }),
    /** The person someone reported, who this answers about. */
    targetActorId: uuid("target_actor_id").references(() => actors.id, { onDelete: "cascade" }),
    /** For a reply, the comment that holds its text. */
    replyContentId: uuid("reply_content_id").references(() => content.id, { onDelete: "cascade" }),
    /** For a removal, the reason the moderator gave, if any. For a warning, what it says. */
    reason: text(),
    /** For a warning, when they pressed its button. */
    acknowledgedAt: time("acknowledged_at"),
    dueAt: time("due_at").notNull(),
  },
  (table) => [
    index("notifications_recipient").on(table.worldId, table.recipientActorId, table.dueAt),
    check(
      "notifications_type",
      inList(table.type, [
        "read",
        "like",
        "reply",
        "up",
        "down",
        "remove",
        "warn",
        "label",
        "answer",
        "ban",
        "hold",
        "approve",
        "uphold",
        "restore",
        "repost",
        "follow",
        "tag",
      ]),
    ),
    check(
      "notifications_about_something",
      sql`${table.targetContentId} is not null or ${table.targetActorId} is not null`,
    ),
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
    /** On a space's page, which space. */
    spaceId: uuid("space_id").references(() => spaces.id),
    /** The order this person chose, where a study allows that. Null is the study's own. */
    sort: text(),
    ranker: text().notNull(),
    rankerVersion: text("ranker_version").notNull(),
    /** What ordered the comments, and which version. */
    commentOrder: text("comment_order"),
    commentOrderVersion: text("comment_order_version"),
    /** The comment order this person chose, where a study allows that. Null is the study's own. */
    commentSort: text("comment_sort"),
    /** The seed used for this order, so it can be reproduced. */
    seed: bigint({ mode: "number" }),
    items: jsonb().notNull(),
    /** On a platform with karma, the number shown for each author. The participant is "viewer". */
    karmaShown: jsonb("karma_shown").$type<Record<string, number>>(),
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

/** Each time someone downloaded a study's data, and whether it could identify people. */
export const studyExports = pgTable(
  "study_exports",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    by: text().notNull(),
    includedRecruitmentIds: boolean("included_recruitment_ids").notNull().default(false),
    /** What was taken: the data, or the photos participants uploaded. */
    contents: text().notNull().default("data"),
    at: time("at").notNull().defaultNow(),
  },
  (table) => [index("study_exports_study").on(table.studyId, table.id)],
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

/**
 * A cast and a feed's worth of content to start a study from. It's copied into a study, and never
 * changes after it's saved, so a study can't be affected by anything that happens to a pack later.
 */
export const contentPacks = pgTable(
  "content_packs",
  {
    id: id(),
    /** Empty means it's available to every team on this server. */
    teamId: uuid("team_id").references(() => teams.id),
    name: text().notNull(),
    description: text().notNull().default(""),
    contents: jsonb().notNull(),
    /** Counts and a few images, to list packs without reading all their contents. */
    summary: jsonb().notNull(),
    contentHash: text("content_hash").notNull(),
    createdBy: uuid("created_by").references(() => researchers.id),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [index("content_packs_team").on(table.teamId)],
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
      inList(table.kind, [
        "actor",
        "post",
        "comment",
        "reaction",
        "removal",
        "label",
        "flagAnswer",
        "ban",
        "reportAnswer",
        "autoRule",
        "appealAnswer",
        "contextNote",
        "story",
        "setting",
        "space",
      ]),
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

/**
 * One researcher's Prolific token, encrypted. It's theirs rather than the team's, so Prolific
 * decides what each person can do (ADR 17).
 */
export const prolificConnections = pgTable("prolific_connections", {
  researcherId: uuid("researcher_id")
    .primaryKey()
    .references(() => researchers.id, { onDelete: "cascade" }),
  tokenEncrypted: text("token_encrypted").notNull(),
  connectedAt: time("connected_at").notNull().defaultNow(),
});

/** The Prolific study a study recruits through. Participants' submissions stay on Prolific. */
export const prolificLinks = pgTable(
  "prolific_links",
  {
    studyId: uuid("study_id")
      .primaryKey()
      .references(() => studies.id),
    prolificStudyId: text("prolific_study_id").notNull(),
    reviewMode: text("review_mode").notNull(),
    /** finished, declined, and for automatic review, needsReview. */
    codes: jsonb().notNull(),
    /** What's expected of someone before they're approved. */
    rules: jsonb().notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("prolific_links_review_mode", inList(table.reviewMode, ["manual", "automatic"])),
  ],
);

/**
 * A bonus set up on Prolific. Paying twice pays people twice, so `paying_at` is claimed before the
 * call to pay, and a payment that may have gone through can never be repeated from here.
 */
export const prolificBonuses = pgTable(
  "prolific_bonuses",
  {
    id: text().primaryKey(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    people: integer().notNull(),
    totalAmount: integer("total_amount").notNull(),
    createdBy: text("created_by").notNull(),
    payingAt: time("paying_at"),
    paidBy: text("paid_by"),
  },
  (table) => [index("prolific_bonuses_study").on(table.studyId)],
);

/** Each thing someone did on Prolific from here that touches people or money. */
export const prolificActions = pgTable(
  "prolific_actions",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    by: text().notNull(),
    action: text().notNull(),
    people: integer(),
    /** In the smallest unit of the currency, as Prolific reported it. */
    amount: integer(),
    at: time("at").notNull().defaultNow(),
  },
  (table) => [
    index("prolific_actions_study").on(table.studyId, table.id),
    check(
      "prolific_actions_action",
      inList(table.action, ["created draft", "approved", "paid bonus", "unlinked"]),
    ),
  ],
);
