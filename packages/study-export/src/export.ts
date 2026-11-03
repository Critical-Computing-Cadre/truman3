import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_TEMPLATE,
  FEATURE_KEYS,
  FEATURES,
  featuresFor,
  layoutFor,
  type StudySettings,
  studySettingsSchema,
  TEMPLATES,
} from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { stringify } from "csv-stringify/sync";
import { asc, eq, inArray } from "drizzle-orm";
import { iso, safeText } from "./cells.ts";
import { type DwellLimits, summarizeEvents } from "./summary.ts";

export interface ExportOptions extends DwellLimits {
  /**
   * Also writes recruitment_ids.csv, which links study IDs to recruitment IDs. Needed for things like
   * paying bonuses, and shouldn't be shared.
   */
  includeRecruitmentIds?: boolean;
}

export type ExportResult =
  | { status: "not-found" }
  | {
      status: "exported";
      participants: number;
      events: number;
      impressions: number;
      files: string[];
    };

/** Who or what wrote it, for methods reporting. Doesn't name the researcher. */
function provenanceLabel(provenance: unknown): string {
  const { origin, edited, pack } = provenance as {
    origin?: string;
    edited?: boolean;
    pack?: { name: string };
  };
  if (!origin) {
    return "";
  }
  const source = pack ? `pack: ${pack.name}` : origin;
  return edited ? `${source}, then edited` : source;
}

function writeCsv(
  folder: string,
  name: string,
  columns: string[],
  rows: Record<string, unknown>[],
) {
  writeFileSync(path.join(folder, name), stringify(rows, { header: true, columns }));
  return name;
}

/**
 * Writes a study's data as tidy CSV files, plus a codebook. Everything comes from the event log,
 * what was shown, and the frozen versions. It never reads the tables that hold current state.
 */
/** What the platform was in each condition, so a report can say what people could do. */
function platformLines(settings: StudySettings) {
  const template = TEMPLATES[settings.platform?.template ?? DEFAULT_TEMPLATE];
  const arms = settings.conditions?.arms ?? [];
  if (arms.length === 0) {
    return [];
  }
  return [
    `Platform: the ${template.name} template, with the \`${layoutFor(settings)}\` layout.`,
    "",
    `| Feature | Version | ${arms.map(({ key }) => key).join(" | ")} |`,
    `|---|---|${arms.map(() => "---").join("|")}|`,
    ...FEATURE_KEYS.map(
      (key) =>
        `| ${FEATURES[key].name} | ${FEATURES[key].version} | ${arms
          .map((arm) => (featuresFor(settings, arm.key)[key] ? "on" : "off"))
          .join(" | ")} |`,
    ),
    "",
  ];
}

export async function exportStudy(
  db: Database,
  slug: string,
  folder: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const [study] = await db.select().from(schema.studies).where(eq(schema.studies.slug, slug));
  if (!study) {
    return { status: "not-found" };
  }

  const versions = await db
    .select()
    .from(schema.studyVersions)
    .where(eq(schema.studyVersions.studyId, study.id))
    .orderBy(asc(schema.studyVersions.version));
  const versionIds = versions.map(({ id }) => id);
  const versionNumber = new Map(versions.map((version) => [version.id, version.version]));

  // A researcher trying the study isn't data.
  const everyone = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.studyId, study.id))
    .orderBy(asc(schema.participants.enrolledAt));
  const participants = everyone.filter(({ isPilot }) => !isPilot);
  const pilotIds = new Set(everyone.filter(({ isPilot }) => isPilot).map(({ id }) => id));

  const conditions = versionIds.length
    ? await db
        .select()
        .from(schema.conditions)
        .where(inArray(schema.conditions.studyVersionId, versionIds))
    : [];
  const conditionById = new Map(conditions.map((condition) => [condition.id, condition]));

  const participantIds = participants.map(({ id }) => id);
  const assignments = participantIds.length
    ? await db
        .select()
        .from(schema.assignments)
        .where(inArray(schema.assignments.participantId, participantIds))
        .orderBy(asc(schema.assignments.id))
    : [];
  const memberships = participantIds.length
    ? await db
        .select()
        .from(schema.worldMemberships)
        .where(inArray(schema.worldMemberships.participantId, participantIds))
    : [];
  const worlds = versionIds.length
    ? await db.select().from(schema.worlds).where(inArray(schema.worlds.studyVersionId, versionIds))
    : [];
  const worldById = new Map(worlds.map((world) => [world.id, world]));
  const membershipByParticipant = new Map(memberships.map((m) => [m.participantId, m]));
  const participantByWorld = new Map(memberships.map((m) => [m.worldId, m.participantId]));
  const pilotWorldIds = new Set(
    pilotIds.size
      ? (
          await db
            .select({ worldId: schema.worldMemberships.worldId })
            .from(schema.worldMemberships)
            .where(inArray(schema.worldMemberships.participantId, [...pilotIds]))
        ).map(({ worldId }) => worldId)
      : [],
  );

  const events = (
    versionIds.length
      ? await db
          .select()
          .from(schema.events)
          .where(inArray(schema.events.studyVersionId, versionIds))
          .orderBy(asc(schema.events.id))
      : []
  ).filter(({ worldId }) => !pilotWorldIds.has(worldId));
  const eventsByParticipant = Map.groupBy(events, (event) => event.participantId ?? "");

  const worldIds = worlds.map(({ id }) => id).filter((id) => !pilotWorldIds.has(id));
  const impressions = worldIds.length
    ? await db
        .select()
        .from(schema.feedImpressions)
        .where(inArray(schema.feedImpressions.worldId, worldIds))
        .orderBy(asc(schema.feedImpressions.id))
    : [];

  const content = (
    versionIds.length
      ? await db
          .select()
          .from(schema.content)
          .where(inArray(schema.content.studyVersionId, versionIds))
      : []
  ).filter(({ worldId }) => !worldId || !pilotWorldIds.has(worldId));

  const launches = await db
    .select()
    .from(schema.studyLaunches)
    .where(eq(schema.studyLaunches.studyId, study.id))
    .orderBy(asc(schema.studyLaunches.id));
  const contentById = new Map(content.map((item) => [item.id, item]));

  const actors = versionIds.length
    ? await db.select().from(schema.actors).where(inArray(schema.actors.studyVersionId, versionIds))
    : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  /** Participants' usernames can identify them, so exports refer to them by study ID. */
  const actorLabel = (actorId: string | null) => {
    if (!actorId) {
      return "";
    }
    const actor = actorById.get(actorId);
    if (!actor) {
      return "";
    }
    return actor.participantId ? `participant:${actor.participantId}` : safeText(actor.username);
  };

  const deletions = await db
    .select({ reason: schema.dataDeletions.reason })
    .from(schema.dataDeletions)
    .where(eq(schema.dataDeletions.studyId, study.id));

  mkdirSync(folder, { recursive: true });
  const files: string[] = [];

  const conditionColumns = [...new Set(conditions.flatMap((c) => Object.keys(c.factors as object)))]
    .sort()
    .map((factor) => `factor_${factor}`);

  files.push(
    writeCsv(
      folder,
      "participants.csv",
      [
        "participant_id",
        "study_version",
        "condition",
        ...conditionColumns,
        "assignment_method",
        "assignment_probability",
        "assignment_details",
        "status",
        "enrolled_at",
        "world_started_at",
        "reached_flow_step",
      ],
      participants.map((participant) => {
        const assignment = assignments.findLast((a) => a.participantId === participant.id);
        const condition = assignment ? conditionById.get(assignment.conditionId) : undefined;
        const membership = membershipByParticipant.get(participant.id);
        const world = membership ? worldById.get(membership.worldId) : undefined;
        const factors = (condition?.factors ?? {}) as Record<string, string>;

        return {
          participant_id: participant.id,
          study_version: assignment ? versionNumber.get(assignment.studyVersionId) : "",
          condition: condition?.key ?? "",
          ...Object.fromEntries(
            Object.entries(factors).map(([factor, level]) => [`factor_${factor}`, level]),
          ),
          assignment_method: assignment?.method ?? "",
          assignment_probability: assignment?.probability ?? "",
          assignment_details: JSON.stringify(assignment?.details ?? {}),
          status: participant.status,
          enrolled_at: iso(participant.enrolledAt),
          world_started_at: iso(world?.startedAt),
          reached_flow_step: participant.flowPosition,
        };
      }),
    ),
  );

  files.push(
    writeCsv(
      folder,
      "summary.csv",
      [
        "participant_id",
        "condition",
        "status",
        "sessions",
        "pages_viewed",
        "active_ms",
        "posts_created",
        "comments_created",
        "content_liked",
        "like_actions",
        "content_flagged",
        "flag_actions",
        "actors_followed",
        "actors_blocked",
        "actors_reported",
        "content_views",
        "dwell_ms",
        "views_excluded",
      ],
      participants.map((participant) => {
        const assignment = assignments.findLast((a) => a.participantId === participant.id);
        const summary = summarizeEvents(eventsByParticipant.get(participant.id) ?? [], options);
        return {
          participant_id: participant.id,
          condition: assignment ? conditionById.get(assignment.conditionId)?.key : "",
          status: participant.status,
          sessions: summary.sessions,
          pages_viewed: summary.pagesViewed,
          active_ms: summary.activeMs,
          posts_created: summary.postsCreated,
          comments_created: summary.commentsCreated,
          content_liked: summary.contentLiked,
          like_actions: summary.likeActions,
          content_flagged: summary.contentFlagged,
          flag_actions: summary.flagActions,
          actors_followed: summary.actorsFollowed,
          actors_blocked: summary.actorsBlocked,
          actors_reported: summary.actorsReported,
          content_views: summary.contentViews,
          dwell_ms: summary.dwellMs,
          views_excluded: summary.viewsExcluded,
        };
      }),
    ),
  );

  files.push(
    writeCsv(
      folder,
      "events.csv",
      [
        "event_id",
        "type",
        "participant_id",
        "study_version",
        "condition",
        "source",
        "actor",
        "target_content_id",
        "target_content_ref",
        "target_actor",
        "dwell_ms",
        "payload",
        "occurred_at",
        "recorded_at",
        "ms_since_world_start",
      ],
      events.map((event) => {
        const payload = event.payload as Record<string, unknown>;
        const world = worldById.get(event.worldId);
        return {
          event_id: event.id,
          type: event.type,
          participant_id: event.participantId ?? "",
          study_version: versionNumber.get(event.studyVersionId),
          condition: event.conditionId ? conditionById.get(event.conditionId)?.key : "",
          source: event.source,
          actor: actorLabel(event.actorId),
          target_content_id: event.targetContentId ?? "",
          target_content_ref: event.targetContentId
            ? (contentById.get(event.targetContentId)?.sourceRef ?? "")
            : "",
          target_actor: actorLabel(event.targetActorId),
          dwell_ms: payload.dwellMs ?? "",
          payload: JSON.stringify(payload),
          occurred_at: iso(event.occurredAt),
          recorded_at: iso(event.recordedAt),
          ms_since_world_start: world ? event.occurredAt.getTime() - world.startedAt.getTime() : "",
        };
      }),
    ),
  );

  files.push(
    writeCsv(
      folder,
      "impressions.csv",
      [
        "impression_id",
        "participant_id",
        "condition",
        "surface",
        "ranker",
        "ranker_version",
        "seed",
        "fallback_used",
        "shown_at",
        "position",
        "content_id",
        "content_ref",
        "pinned",
        "comment_ids",
      ],
      impressions.flatMap((impression) =>
        (
          impression.items as {
            contentId: string;
            position: number;
            pinned?: boolean;
            commentIds?: string[];
          }[]
        ).map((item) => ({
          impression_id: impression.id,
          participant_id: participantByWorld.get(impression.worldId) ?? "",
          condition: impression.conditionId ? conditionById.get(impression.conditionId)?.key : "",
          surface: impression.surface,
          ranker: impression.ranker,
          ranker_version: impression.rankerVersion,
          seed: impression.seed ?? "",
          fallback_used: impression.fallbackUsed,
          shown_at: iso(impression.shownAt),
          position: item.position,
          content_id: item.contentId,
          content_ref: contentById.get(item.contentId)?.sourceRef ?? "",
          pinned: item.pinned ?? false,
          comment_ids: (item.commentIds ?? []).join("|"),
        })),
      ),
    ),
  );

  files.push(
    writeCsv(
      folder,
      "content.csv",
      [
        "content_id",
        "study_version",
        "origin",
        "participant_id",
        "kind",
        "source_ref",
        "parent_id",
        "author",
        "body",
        "media",
        "provenance",
        "offset_ms",
        "visible_at",
        "base_likes",
        "conditions",
        "class",
      ],
      content.map((item) => ({
        content_id: item.id,
        study_version: versionNumber.get(item.studyVersionId),
        origin: item.worldId ? "world" : "scripted",
        participant_id: item.worldId ? (participantByWorld.get(item.worldId) ?? "") : "",
        kind: item.kind,
        source_ref: item.sourceRef ?? "",
        parent_id: item.parentId ?? "",
        author: actorLabel(item.authorActorId),
        body: safeText(item.body),
        media: item.mediaKey ?? "",
        provenance: provenanceLabel(item.provenance),
        offset_ms: item.offsetMs ?? "",
        visible_at: iso(item.visibleAt),
        base_likes: item.baseLikes,
        conditions: item.conditions.join("|"),
        class: safeText(item.class),
      })),
    ),
  );

  if (options.includeRecruitmentIds) {
    files.push(
      writeCsv(
        folder,
        "recruitment_ids.csv",
        ["participant_id", "source", "external_id"],
        participants.map((participant) => ({
          participant_id: participant.id,
          source: participant.source,
          external_id: participant.externalId,
        })),
      ),
    );
  }

  writeFileSync(
    path.join(folder, "codebook.md"),
    buildCodebook({
      slug,
      versions: versions.map((version) => ({
        version: version.version,
        contentHash: version.contentHash,
        frozenAt: version.frozenAt,
        settings: studySettingsSchema.parse(version.settings),
      })),
      eventTypes: [...new Set(events.map((event) => event.type))].sort(),
      deletions,
      launches: launches.map((launch) => ({
        action: launch.action,
        version: launch.versionId ? versionNumber.get(launch.versionId) : undefined,
        at: launch.at,
      })),
      pilots: pilotIds.size,
      counts: {
        participants: participants.length,
        completed: participants.filter(({ status }) => status === "completed").length,
        events: events.length,
        impressions: impressions.length,
      },
      options,
      exportedAt: new Date(),
    }),
  );
  files.push("codebook.md");

  return {
    status: "exported",
    participants: participants.length,
    events: events.length,
    impressions: impressions.length,
    files,
  };
}

const FILE_DOCS: Record<string, [string, string][]> = {
  "participants.csv": [
    ["participant_id", "This participant's ID, specific to this study"],
    ["study_version", "Which frozen version they were enrolled in"],
    ["condition", "Their current condition"],
    ["factor_*", "That condition's level on each design factor, if the study labels factors"],
    ["assignment_method", "uniform or blocked"],
    ["assignment_probability", "The overall chance of this condition, from its weight"],
    ["assignment_details", "For blocked assignment: position, block, and position in block"],
    ["status", "active, or completed if they reached the end. Active can mean they never returned"],
    ["enrolled_at, world_started_at", "When they enrolled, and when their timeline started"],
    ["reached_flow_step", "Which flow step they completed up to, counting from 0"],
  ],
  "summary.csv": [
    ["content_liked, content_flagged", "What was still liked or flagged at the end, after undoing"],
    ["like_actions, flag_actions", "Every like or flag click, including ones later undone"],
    ["actors_*", "Actors followed, blocked, or reported at the end"],
    ["active_ms", "Time the tab was in front, added up from heartbeats. Approximate"],
    ["content_views, dwell_ms", "Views of content and total time, within any limits below"],
    ["views_excluded", "Views left out by those limits"],
  ],
  "events.csv": [
    ["type", "What happened. See the event types below"],
    ["source", "participant, script, llm, researcher, or system"],
    ["actor", "Who did it: a username, or participant:<id> for a participant"],
    ["target_content_ref", "The ID in the study definition, if the target is scripted"],
    ["dwell_ms", "For content.viewed, the raw time on screen in milliseconds, with no filtering"],
    ["payload", "All details for this event type, as JSON"],
    ["occurred_at", "When it happened, by the participant's browser clock, which can be wrong"],
    ["recorded_at", "When the server received it"],
    ["ms_since_world_start", "occurred_at relative to when their timeline started"],
  ],
  "impressions.csv": [
    ["impression_id", "One showing of a feed or profile. It has one row per post"],
    ["surface", "Where it was shown: feed or profile"],
    ["ranker, ranker_version", "What ordered it"],
    ["seed", "The random seed used, so a shuffled order can be reproduced"],
    ["position", "Its place in the list, from 0. Being listed doesn't mean it was looked at"],
    ["comment_ids", "Comments shown with it, separated by |"],
  ],
  "content.csv": [
    ["origin", "scripted, from the study definition, or world, created during the study"],
    [
      "provenance",
      "For scripted content, who wrote it: file, researcher, pack, or generated, and whether it was later edited",
    ],
    ["participant_id", "For world content, whose world it was in"],
    ["author", "A username, or participant:<id> for a participant"],
    ["offset_ms", "For scripted content, when it appears relative to the start"],
    ["visible_at", "For world content, when it appears"],
    ["base_likes", "The like count it starts with, before any likes during the study"],
    ["conditions", "Conditions it applies to, separated by |. Empty means all"],
  ],
};

function buildCodebook(input: {
  slug: string;
  versions: {
    version: number;
    contentHash: string;
    frozenAt: Date | null;
    settings: StudySettings;
  }[];
  eventTypes: string[];
  deletions: { reason: string }[];
  launches: { action: string; version: number | undefined; at: Date }[];
  pilots: number;
  counts: { participants: number; completed: number; events: number; impressions: number };
  options: ExportOptions;
  exportedAt: Date;
}): string {
  const { versions, counts, options } = input;
  const lines = [
    `# Codebook: ${input.slug}`,
    "",
    `Exported ${input.exportedAt.toISOString()}.`,
    "",
    `${counts.participants} participants, ${counts.completed} completed. ${counts.events} events. ${counts.impressions} feed showings.`,
    "",
    `${input.deletions.length} people's data has been deleted and isn't in these files: ${input.deletions.filter(({ reason }) => reason === "declined consent").length} declined consent, and ${input.deletions.filter(({ reason }) => reason !== "declined consent").length} withdrew.`,
    "",
    `${input.pilots} test participants aren't included. Researchers use them to try a study.`,
    "",
    "## Reading this data",
    "",
    "- **What's in `events.csv`:** everything participants did, including on scripted content, and scripted reactions to them. Scripted content simply appearing on schedule isn't an event. To see what someone was shown, use `impressions.csv`. See ADR 6.",
    "- **Being in `impressions.csv` doesn't mean it was seen.** It means it was in the list sent to their browser. `content.viewed` in `events.csv` records actual time on screen.",
    "- **Times from the browser** can be wrong if a participant's clock is. `recorded_at` comes from the server.",
    "- **Text from participants** that starts with =, +, -, or @ has an apostrophe added, so spreadsheet programs don't run it as a formula.",
    "- **Recruitment IDs** aren't in these files unless `recruitment_ids.csv` was requested. Don't share that file.",
    "- **Deleted participants** don't appear here.",
    "",
    "## Time on content",
    "",
    `\`summary.csv\` counts views from ${options.minDwellMs ?? 0} ms up to ${options.maxDwellMs === undefined ? "any length" : `${options.maxDwellMs} ms`}. \`events.csv\` has every view, unfiltered, so other limits can be applied later.`,
    "",
    "## Study versions",
    "",
  ];

  for (const version of versions) {
    lines.push(
      `### Version ${version.version}`,
      "",
      `Frozen ${version.frozenAt?.toISOString() ?? "(not frozen)"}. Content hash \`${version.contentHash}\`.`,
      "",
      ...platformLines(version.settings as StudySettings),
      "```json",
      JSON.stringify(version.settings, null, 2),
      "```",
      "",
    );
  }

  if (input.launches.length > 0) {
    lines.push(
      "## When each version was open to new participants",
      "",
      ...input.launches.map(({ action, version, at }) =>
        action === "launch"
          ? `- ${at.toISOString()}: version ${version} launched`
          : `- ${at.toISOString()}: closed to new participants`,
      ),
      "",
    );
  }

  lines.push("## Files", "");
  for (const [file, columns] of Object.entries(FILE_DOCS)) {
    lines.push(`### ${file}`, "", "| Column | Meaning |", "|---|---|");
    for (const [column, meaning] of columns) {
      lines.push(`| ${column} | ${meaning} |`);
    }
    lines.push("");
  }

  lines.push(
    "## Event types in this export",
    "",
    ...input.eventTypes.map((type) => `- \`${type}\``),
    "",
  );
  return lines.join("\n");
}
