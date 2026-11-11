import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type ActorDefinition,
  type AppealAnswerDefinition,
  type AutoRuleDefinition,
  type BanDefinition,
  BEATS_FILE,
  type BeatDefinition,
  type BeatsFile,
  type CommentDefinition,
  type ContextNoteDefinition,
  type FlagAnswerDefinition,
  type Flair,
  hasErrors,
  type LabelDefinition,
  MAX_LABEL_LENGTH,
  PERSONAS_FILE,
  type PersonasFile,
  PIN_PLACES,
  POST_TAGS,
  type PostDefinition,
  parseStudyTime,
  type ReactionDefinition,
  type RemovalDefinition,
  type ReportAnswerDefinition,
  SCENARIOS_FILE,
  type Scenario,
  type SpaceDefinition,
  type StoryDefinition,
  type StudyDefinition,
  type StudyIssue,
  type StudySettings,
  studyDefinitionSchema,
  studySettingsSchema,
  validateStudy,
} from "@truman3/core";
import { parse as parseYaml } from "yaml";
import { parseBeats } from "./beats.ts";
import { type CsvRow, type CsvSpec, parseCsv } from "./csv.ts";
import { parsePersonas } from "./personas.ts";
import { parseScenarios } from "./scenarios.ts";

export const ACTORS: CsvSpec = {
  required: ["username", "name"],
  optional: [
    "gender",
    "age",
    "location",
    "bio",
    "picture",
    "pictures",
    "banner",
    "moderator",
    "karma",
    "followers",
    "following",
    "startsFollowed",
    "badge",
    "suggested",
    "flair",
    "condition",
    "class",
  ],
};
export const POSTS: CsvSpec = {
  required: ["id", "actor", "time"],
  optional: [
    "title",
    "body",
    "picture",
    "space",
    "link",
    "pinned",
    "locked",
    "tags",
    "poll",
    "pollResultsFirst",
    "flair",
    "crosspostOf",
    "repostOf",
    "quoteOf",
    "reposts",
    "quotes",
    "ad",
    "views",
    "likedBy",
    "place",
    "tagged",
    "likes",
    "ups",
    "downs",
    "condition",
    "class",
  ],
};
export const SPACES: CsvSpec = {
  required: ["key", "name"],
  optional: [
    "description",
    "rules",
    "picture",
    "banner",
    "accent",
    "startsJoined",
    "members",
    "postFlair",
    "userFlair",
    "requirePostFlair",
    "condition",
    "class",
  ],
};
export const COMMENTS: CsvSpec = {
  required: ["id", "body", "actor", "postID", "time"],
  optional: ["replyToID", "likes", "ups", "downs", "condition", "class"],
};
export const REACTIONS: CsvSpec = {
  required: ["on", "nth", "type", "actor", "after"],
  optional: ["body", "condition", "class"],
};
export const FLAG_ANSWERS: CsvSpec = {
  required: ["action", "actor", "after"],
  optional: ["on", "target", "message", "condition", "class"],
};
export const BANS: CsvSpec = {
  required: ["user", "actor", "time"],
  optional: ["reason", "space", "condition", "class"],
};
export const REPORT_ANSWERS: CsvSpec = {
  required: ["action", "actor", "after"],
  optional: ["user", "message", "condition", "class"],
};
export const AUTO_RULES: CsvSpec = {
  required: ["id", "on", "match", "action", "actor", "after"],
  optional: ["message", "holdOutcome", "condition", "class"],
};
export const APPEAL_ANSWERS: CsvSpec = {
  required: ["action", "actor", "after"],
  optional: ["message", "condition", "class"],
};
/** A cell of names split on "|", left out when it's empty. */
function listOf<K extends string>(key: K, cell: string | undefined): { [P in K]?: string[] } {
  const names = (cell ?? "")
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean);
  return (names.length > 0 ? { [key]: names } : {}) as { [P in K]?: string[] };
}

export const STORIES: CsvSpec = {
  required: ["id", "actor", "picture", "time"],
  optional: ["caption", "lastsHours", "highlight", "closeFriends", "condition", "class"],
};
export const CONTEXT_NOTES: CsvSpec = {
  required: ["id", "postID", "body", "time"],
  optional: ["helpful", "notHelpful", "condition", "class"],
};
export const REMOVALS: CsvSpec = {
  required: ["on", "target", "actor", "time"],
  optional: ["reason", "condition", "class"],
};
export const LABELS: CsvSpec = {
  required: ["on", "target", "actor", "time", "label"],
  optional: ["hides", "reason", "by", "ask", "condition", "class"],
};

export const MEDIA_FOLDERS = {
  actors: "media/actors",
  posts: "media/posts",
  spaces: "media/spaces",
} as const;

export interface LoadedStudy {
  /** Present when the files could be read, even if the study has validation errors. */
  definition?: StudyDefinition;
  issues: StudyIssue[];
}

/** Reads and checks a study folder. Problems come back as issues; it doesn't throw for them. */
export function loadStudyFolder(folder: string): LoadedStudy {
  const source = folderFiles(folder);
  const settingsText = source.read("study.yaml");
  if (settingsText === null) {
    return { issues: [{ severity: "error", message: `There's no study.yaml in ${folder}.` }] };
  }

  let rawSettings: unknown;
  try {
    rawSettings = parseYaml(settingsText);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      issues: [
        {
          severity: "error",
          file: "study.yaml",
          message: `This file couldn't be read: ${detail}`,
        },
      ],
    };
  }

  const settings = studySettingsSchema.safeParse(rawSettings);
  if (!settings.success) {
    return {
      issues: settings.error.issues.map((issue) => ({
        severity: "error",
        file: "study.yaml",
        message: `${issue.path.join(".") || "(top level)"}: ${issue.message}`,
      })),
    };
  }

  const { tables, issues } = readStudyTables(source, settings.data);
  const parsed = studyDefinitionSchema.safeParse({
    settings: settings.data,
    ...tables,
  });
  if (!parsed.success) {
    return {
      issues: [
        ...issues,
        ...parsed.error.issues.map((issue) => ({
          severity: "error" as const,
          message: `${issue.path.join(".")}: ${issue.message}`,
        })),
      ],
    };
  }

  // Rows that couldn't be read have placeholder values, so cross-checks would only add noise.
  if (hasErrors(issues)) {
    return { definition: parsed.data, issues };
  }

  return { definition: parsed.data, issues: [...issues, ...validateStudy(parsed.data)] };
}

/**
 * Where a study's files come from: a folder on disk, or a zip someone uploaded. Paths are relative to
 * the study, like `posts.csv` or `media/posts/lake.jpg`.
 */
export interface StudyFiles {
  /** The file's text, or null if it isn't there. */
  read(file: string): string | null;
  has(file: string): boolean;
}

/** A study folder on disk. */
export function folderFiles(folder: string): StudyFiles {
  return {
    read: (file) => {
      const fullPath = path.join(folder, file);
      return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : null;
    },
    has: (file) => existsSync(path.join(folder, file)),
  };
}

/** Everything a study's files describe besides its settings, before it's checked as a whole. */
export type StudyTables = Omit<StudyDefinition, "settings">;

/**
 * Reads a study's sheets and pages, with these settings. With `only`, it reads just those sheets,
 * none of them is required, and pages and the site's images are left alone: that's for adding a
 * few sheets to a study that already has the rest.
 */
export function readStudyTables(
  source: StudyFiles,
  settings: StudySettings,
  only?: readonly string[],
): { tables: StudyTables; issues: StudyIssue[] } {
  const issues: StudyIssue[] = [];

  const readTable = (file: string, spec: CsvSpec, required: boolean): CsvRow[] => {
    const text = only && !only.includes(file) ? null : source.read(file);
    if (text === null) {
      if (required && !only) {
        issues.push({ severity: "error", file, message: "This file is missing." });
      }
      return [];
    }
    const result = parseCsv(text, file, spec);
    issues.push(...result.issues);
    return result.rows;
  };

  const rowError = (file: string, row: number, message: string) =>
    issues.push({ severity: "error", file, row, message });

  const time = (value: string | undefined, column: string, file: string, row: number) => {
    const parsed = parseStudyTime(value ?? "");
    if (parsed === null) {
      rowError(
        file,
        row,
        `"${value ?? ""}" in ${column} isn't a time. Use hours:minutes, like 2:05.`,
      );
      return 0;
    }
    return parsed;
  };

  const wholeNumber = (value: string | undefined, column: string, file: string, row: number) => {
    if (!value) {
      return undefined;
    }
    if (!/^\d+$/.test(value)) {
      rowError(file, row, `"${value}" in ${column} isn't a whole number.`);
      return undefined;
    }
    return Number(value);
  };

  // Someone's karma can go below zero, as it can on a real forum.
  /** "yes" means everyone starts out following them, and anything else names conditions. */
  const startsFollowedFrom = (value: string | undefined) => {
    const text = value?.trim();
    if (!text || /^(no|false)$/i.test(text)) {
      return {};
    }
    return {
      startsFollowed: /^(yes|true)$/i.test(text) ? true : text.split("|").map((key) => key.trim()),
    };
  };
  const signedNumber = (value: string | undefined, column: string, file: string, row: number) => {
    if (!value) {
      return undefined;
    }
    if (!/^-?\d+$/.test(value)) {
      rowError(file, row, `"${value}" in ${column} isn't a whole number.`);
      return undefined;
    }
    return Number(value);
  };

  const targeting = (cells: Record<string, string>, file: string, row: number) => ({
    conditions: (cells.condition ?? "")
      .split("|")
      .map((condition) => condition.trim())
      .filter(Boolean),
    ...(cells.class ? { class: cells.class } : {}),
    source: { file, row },
  });

  const yesOrNo = (value: string | undefined, column: string, file: string, row: number) => {
    if (!value) {
      return undefined;
    }
    if (value !== "yes" && value !== "no") {
      rowError(file, row, `"${value}" in ${column} has to be yes or no.`);
      return undefined;
    }
    return value === "yes";
  };

  const optional = <K extends string>(key: K, value: string | number | undefined) =>
    value === undefined || value === "" ? {} : ({ [key]: value } as Record<K, never>);

  /** `Label` or `Label=#rrggbb`, separated by |. */
  const flairList = (value: string | undefined): Flair[] =>
    (value ?? "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const [text = "", color] = item.split("=").map((part) => part.trim());
        return { text, ...(color ? { color } : {}) };
      });

  /** `space=Label`, separated by |. */
  const actorFlair = (value: string | undefined, row: number) => {
    const pairs = (value ?? "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean)
      .flatMap((item) => {
        const [key, text] = item.split("=").map((part) => part.trim());
        if (!key || !text) {
          rowError("actors.csv", row, `"${item}" in flair has to look like space=Label.`);
          return [];
        }
        return [[key, text]];
      });
    return pairs.length > 0 ? { spaceFlair: Object.fromEntries(pairs) } : {};
  };

  /** `condition=picture.jpg`, separated by |. */
  const actorPictures = (value: string | undefined, row: number) => {
    const pairs = (value ?? "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean)
      .flatMap((item) => {
        const [key, picture] = item.split("=").map((part) => part.trim());
        if (!key || !picture) {
          rowError(
            "actors.csv",
            row,
            `"${item}" in pictures has to look like condition=picture.jpg.`,
          );
          return [];
        }
        return [[key, picture]];
      });
    return pairs.length > 0 ? { conditionPictures: Object.fromEntries(pairs) } : {};
  };

  /** `Option` or `Option=12` for its starting votes, separated by |. */
  const pollFrom = (cells: Record<string, string>, row: number) => {
    const options = (cells.poll ?? "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const counted = /^(.*)=(\d+)$/.exec(item);
        return counted
          ? { text: (counted[1] as string).trim(), votes: Number(counted[2]) }
          : { text: item, votes: 0 };
      });
    const resultsFirst = yesOrNo(cells.pollResultsFirst, "pollResultsFirst", "posts.csv", row);
    return options.length > 0 ? { poll: { options, resultsFirst: resultsFirst ?? false } } : {};
  };

  const actors: ActorDefinition[] = readTable("actors.csv", ACTORS, true).map(({ row, cells }) => {
    if (!cells.username) {
      rowError("actors.csv", row, "This actor has no username.");
    }
    if (!cells.name) {
      rowError("actors.csv", row, "This actor has no name.");
    }
    return {
      username: cells.username || `(row ${row})`,
      name: cells.name || `(row ${row})`,
      ...optional("gender", cells.gender),
      ...optional("age", wholeNumber(cells.age, "age", "actors.csv", row)),
      ...optional("location", cells.location),
      ...optional("bio", cells.bio),
      ...optional("picture", cells.picture),
      ...optional("banner", cells.banner),
      ...(yesOrNo(cells.moderator, "moderator", "actors.csv", row) ? { moderator: true } : {}),
      ...optional("karma", signedNumber(cells.karma, "karma", "actors.csv", row)),
      ...optional("followers", wholeNumber(cells.followers, "followers", "actors.csv", row)),
      ...optional("following", wholeNumber(cells.following, "following", "actors.csv", row)),
      ...startsFollowedFrom(cells.startsFollowed),
      ...optional("badge", cells.badge || undefined),
      ...(/^(yes|true)$/i.test(cells.suggested ?? "") ? { suggested: true } : {}),
      ...actorFlair(cells.flair, row),
      ...actorPictures(cells.pictures, row),
      ...targeting(cells, "actors.csv", row),
    };
  });

  // Studies from before spaces don't have this file, or these columns, and need nothing new.
  const spaces: SpaceDefinition[] = readTable("spaces.csv", SPACES, false).map(({ row, cells }) => {
    const startsJoined = yesOrNo(cells.startsJoined, "startsJoined", "spaces.csv", row);
    return {
      key: cells.key || `(row ${row})`,
      name: cells.name || `(row ${row})`,
      startsJoined: startsJoined ?? true,
      ...optional("description", cells.description),
      ...optional("rules", cells.rules),
      ...optional("picture", cells.picture),
      ...optional("banner", cells.banner),
      ...optional("accent", cells.accent),
      ...optional("members", wholeNumber(cells.members, "members", "spaces.csv", row)),
      ...(cells.postFlair ? { postFlair: flairList(cells.postFlair) } : {}),
      ...(cells.userFlair ? { userFlair: flairList(cells.userFlair) } : {}),
      ...(yesOrNo(cells.requirePostFlair, "requirePostFlair", "spaces.csv", row)
        ? { requirePostFlair: true }
        : {}),
      ...targeting(cells, "spaces.csv", row),
    };
  });

  /** A column that lists choices, separated by |. Anything else is a mistake to point out. */
  const choices = <T extends string>(
    value: string | undefined,
    allowed: readonly T[],
    column: string,
    row: number,
  ): T[] => {
    const chosen = (value ?? "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const item of chosen) {
      if (!allowed.includes(item as T)) {
        rowError("posts.csv", row, `"${item}" in ${column} has to be ${allowed.join(" or ")}.`);
      }
    }
    return chosen.filter((item): item is T => allowed.includes(item as T));
  };

  const posts: PostDefinition[] = readTable("posts.csv", POSTS, true).map(({ row, cells }) => {
    const pinnedOn = choices(cells.pinned, PIN_PLACES, "pinned", row);
    const tags = choices(cells.tags, POST_TAGS, "tags", row);
    const locked = yesOrNo(cells.locked, "locked", "posts.csv", row);
    return {
      ref: cells.id || `(row ${row})`,
      ...optional("title", cells.title),
      body: cells.body ?? "",
      actor: cells.actor || `(row ${row})`,
      timeMs: time(cells.time, "time", "posts.csv", row),
      pictures: (cells.picture ?? "")
        .split("|")
        .map((name) => name.trim())
        .filter(Boolean),
      ...optional("space", cells.space),
      ...optional("link", cells.link),
      ...(pinnedOn.length > 0 ? { pinnedOn } : {}),
      ...(locked ? { locked } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...pollFrom(cells, row),
      ...optional("flair", cells.flair),
      ...optional("crosspostOf", cells.crosspostOf),
      ...optional("repostOf", cells.repostOf),
      ...optional("quoteOf", cells.quoteOf),
      ...optional("reposts", wholeNumber(cells.reposts, "reposts", "posts.csv", row)),
      ...optional("quotes", wholeNumber(cells.quotes, "quotes", "posts.csv", row)),
      // "yes" is the usual label, and anything else is the label a study wants.
      ...optional("ad", /^(yes|true)$/i.test(cells.ad ?? "") ? "Sponsored" : cells.ad || undefined),
      ...optional("views", wholeNumber(cells.views, "views", "posts.csv", row)),
      ...optional("likedBy", cells.likedBy || undefined),
      ...optional("place", cells.place || undefined),
      ...listOf("tagged", cells.tagged),
      ...optional("likes", wholeNumber(cells.likes, "likes", "posts.csv", row)),
      ...optional("ups", wholeNumber(cells.ups, "ups", "posts.csv", row)),
      ...optional("downs", wholeNumber(cells.downs, "downs", "posts.csv", row)),
      ...targeting(cells, "posts.csv", row),
    };
  });

  const comments: CommentDefinition[] = readTable("comments.csv", COMMENTS, false).map(
    ({ row, cells }) => {
      if (!cells.body) {
        rowError("comments.csv", row, "This comment has no text.");
      }
      return {
        ref: cells.id || `(row ${row})`,
        body: cells.body || "(missing)",
        actor: cells.actor || `(row ${row})`,
        post: cells.postID || `(row ${row})`,
        ...optional("replyTo", cells.replyToID || undefined),
        timeMs: time(cells.time, "time", "comments.csv", row),
        ...optional("likes", wholeNumber(cells.likes, "likes", "comments.csv", row)),
        ...optional("ups", wholeNumber(cells.ups, "ups", "comments.csv", row)),
        ...optional("downs", wholeNumber(cells.downs, "downs", "comments.csv", row)),
        ...targeting(cells, "comments.csv", row),
      };
    },
  );

  const reactions: ReactionDefinition[] = [];
  for (const { row, cells } of readTable("reactions.csv", REACTIONS, false)) {
    const file = "reactions.csv";
    const on = cells.on;
    const type = cells.type;
    if (on !== "post" && on !== "comment" && on !== "story") {
      rowError(file, row, `"${on}" in on has to be post, comment, or story.`);
      continue;
    }
    if (
      type !== "read" &&
      type !== "like" &&
      type !== "reply" &&
      type !== "up" &&
      type !== "down" &&
      type !== "remove" &&
      type !== "warn" &&
      type !== "label" &&
      type !== "repost" &&
      type !== "follow"
    ) {
      rowError(
        file,
        row,
        `"${type}" in type has to be read, like, reply, up, down, remove, warn, label, repost, or follow.`,
      );
      continue;
    }
    reactions.push({
      on,
      type,
      nth: wholeNumber(cells.nth, "nth", file, row) ?? 0,
      actor: cells.actor || `(row ${row})`,
      afterMs: Math.max(time(cells.after, "after", file, row), 0),
      ...optional("body", cells.body),
      ...targeting(cells, file, row),
    });
  }

  const removals: RemovalDefinition[] = [];
  for (const { row, cells } of readTable("removals.csv", REMOVALS, false)) {
    const file = "removals.csv";
    const on = cells.on;
    if (on !== "post" && on !== "comment") {
      rowError(file, row, `"${on}" in on has to be post or comment.`);
      continue;
    }
    removals.push({
      on,
      target: cells.target || `(row ${row})`,
      actor: cells.actor || `(row ${row})`,
      timeMs: time(cells.time, "time", file, row),
      ...optional("reason", cells.reason || undefined),
      ...targeting(cells, file, row),
    });
  }

  const labels: LabelDefinition[] = [];
  for (const { row, cells } of readTable("labels.csv", LABELS, false)) {
    const file = "labels.csv";
    const on = cells.on;
    if (on !== "post" && on !== "comment") {
      rowError(file, row, `"${on}" in on has to be post or comment.`);
      continue;
    }
    if ((cells.label ?? "").length > MAX_LABEL_LENGTH) {
      rowError(file, row, `A label can be at most ${MAX_LABEL_LENGTH} characters.`);
      continue;
    }
    labels.push({
      on,
      target: cells.target || `(row ${row})`,
      actor: cells.actor || `(row ${row})`,
      timeMs: time(cells.time, "time", file, row),
      label: cells.label || `(row ${row})`,
      hides: yesOrNo(cells.hides, "hides", file, row) ?? false,
      ...optional("reason", cells.reason || undefined),
      showsWho: cells.by !== "hidden",
      ...optional("ask", cells.ask || undefined),
      ...targeting(cells, file, row),
    });
    if (cells.by && cells.by !== "hidden" && cells.by !== "shown") {
      rowError(file, row, `"${cells.by}" in by has to be shown or hidden.`);
    }
  }

  const flagAnswers: FlagAnswerDefinition[] = [];
  for (const { row, cells } of readTable("flag-answers.csv", FLAG_ANSWERS, false)) {
    const file = "flag-answers.csv";
    const { action, on } = cells;
    if (action !== "remove" && action !== "answer") {
      rowError(file, row, `"${action}" in action has to be remove or answer.`);
      continue;
    }
    if (on && on !== "post" && on !== "comment") {
      rowError(file, row, `"${on}" in on has to be post or comment.`);
      continue;
    }
    flagAnswers.push({
      action,
      actor: cells.actor || `(row ${row})`,
      afterMs: Math.max(time(cells.after, "after", file, row), 0),
      ...(on === "post" || on === "comment" ? { on } : {}),
      ...optional("target", cells.target || undefined),
      ...optional("message", cells.message || undefined),
      ...targeting(cells, file, row),
    });
  }

  const bans: BanDefinition[] = [];
  for (const { row, cells } of readTable("bans.csv", BANS, false)) {
    const file = "bans.csv";
    bans.push({
      user: cells.user || `(row ${row})`,
      actor: cells.actor || `(row ${row})`,
      timeMs: time(cells.time, "time", file, row),
      ...optional("reason", cells.reason || undefined),
      ...optional("space", cells.space || undefined),
      ...targeting(cells, file, row),
    });
  }

  const reportAnswers: ReportAnswerDefinition[] = [];
  for (const { row, cells } of readTable("report-answers.csv", REPORT_ANSWERS, false)) {
    const file = "report-answers.csv";
    const { action } = cells;
    if (action !== "answer" && action !== "ban") {
      rowError(file, row, `"${action}" in action has to be answer or ban.`);
      continue;
    }
    reportAnswers.push({
      action,
      actor: cells.actor || `(row ${row})`,
      afterMs: Math.max(time(cells.after, "after", file, row), 0),
      ...optional("user", cells.user || undefined),
      ...optional("message", cells.message || undefined),
      ...targeting(cells, file, row),
    });
  }

  const autoRules: AutoRuleDefinition[] = [];
  for (const { row, cells } of readTable("auto-rules.csv", AUTO_RULES, false)) {
    const file = "auto-rules.csv";
    const { on, action, holdOutcome } = cells;
    if (on !== "post" && on !== "comment" && on !== "both") {
      rowError(file, row, `"${on}" in on has to be post, comment, or both.`);
      continue;
    }
    if (action !== "confirm" && action !== "remove" && action !== "warn" && action !== "hold") {
      rowError(file, row, `"${action}" in action has to be confirm, remove, warn, or hold.`);
      continue;
    }
    if (holdOutcome && holdOutcome !== "approve" && holdOutcome !== "remove") {
      rowError(file, row, `"${holdOutcome}" in holdOutcome has to be approve or remove.`);
      continue;
    }
    autoRules.push({
      ref: cells.id || `(row ${row})`,
      on,
      match: cells.match ?? "",
      action,
      actor: cells.actor || `(row ${row})`,
      afterMs: Math.max(time(cells.after, "after", file, row), 0),
      ...optional("message", cells.message || undefined),
      ...(holdOutcome === "approve" || holdOutcome === "remove" ? { holdOutcome } : {}),
      ...targeting(cells, file, row),
    });
  }

  const appealAnswers: AppealAnswerDefinition[] = [];
  for (const { row, cells } of readTable("appeal-answers.csv", APPEAL_ANSWERS, false)) {
    const file = "appeal-answers.csv";
    const { action } = cells;
    if (action !== "uphold" && action !== "restore") {
      rowError(file, row, `"${action}" in action has to be uphold or restore.`);
      continue;
    }
    appealAnswers.push({
      action,
      actor: cells.actor || `(row ${row})`,
      afterMs: Math.max(time(cells.after, "after", file, row), 0),
      ...optional("message", cells.message || undefined),
      ...targeting(cells, file, row),
    });
  }

  const contextNotes: ContextNoteDefinition[] = readTable(
    "context-notes.csv",
    CONTEXT_NOTES,
    false,
  ).map(({ row, cells }) => {
    const file = "context-notes.csv";
    return {
      ref: cells.id || `(row ${row})`,
      post: cells.postID || `(row ${row})`,
      body: cells.body ?? "",
      timeMs: time(cells.time, "time", file, row),
      ...optional("helpful", wholeNumber(cells.helpful, "helpful", file, row)),
      ...optional("notHelpful", wholeNumber(cells.notHelpful, "notHelpful", file, row)),
      ...targeting(cells, file, row),
    };
  });

  const stories: StoryDefinition[] = readTable("stories.csv", STORIES, false).map(
    ({ row, cells }) => {
      const file = "stories.csv";
      const lasts = cells.lastsHours ? Number(cells.lastsHours) : undefined;
      if (lasts !== undefined && !(lasts > 0)) {
        rowError(file, row, `"${cells.lastsHours}" in lastsHours has to be a number of hours.`);
      }
      return {
        ref: cells.id || `(row ${row})`,
        actor: cells.actor || `(row ${row})`,
        picture: cells.picture ?? "",
        timeMs: time(cells.time, "time", file, row),
        ...optional("caption", cells.caption || undefined),
        ...(lasts && lasts > 0 ? { lastsHours: lasts } : {}),
        ...optional("highlight", cells.highlight || undefined),
        ...(/^(yes|true)$/i.test(cells.closeFriends ?? "") ? { closeFriends: true } : {}),
        ...targeting(cells, file, row),
      };
    },
  );

  const pages: Record<string, string> = {};
  for (const step of settings.flow) {
    if (step.step === "consent" || step.step === "page") {
      const page = only ? null : source.read(step.page);
      if (page !== null) {
        pages[step.page] = page;
      }
    }
  }
  // The site's own pages: its community rules, terms of service, and privacy policy.
  for (const field of ["rules", "terms", "privacy"] as const) {
    const page = settings.site[field];
    if (page && !only) {
      const text = source.read(page);
      if (text === null) {
        issues.push({
          severity: "error",
          file: page,
          message: `This file is missing. site.${field} in study.yaml names it.`,
        });
      } else {
        pages[page] = text;
      }
    }
  }

  // Beats are written by hand in YAML, so the file is kept as written, among the pages, and read
  // into what Christof uses. Adding sheets to a draft leaves them alone.
  const beatsText = only ? null : source.read(BEATS_FILE);
  let beats: BeatDefinition[] = [];
  let christof: Pick<BeatsFile, "live" | "cast" | "decide"> | undefined;
  if (beatsText !== null) {
    pages[BEATS_FILE] = beatsText;
    const read = parseBeats(beatsText);
    beats = read.beats;
    christof = { live: read.live, cast: read.cast, decide: read.decide };
    issues.push(...read.issues);
  }
  // Scenario tests are kept the same way, so they're frozen with the version they test.
  const scenariosText = only ? null : source.read(SCENARIOS_FILE);
  let scenarios: Scenario[] = [];
  if (scenariosText !== null) {
    pages[SCENARIOS_FILE] = scenariosText;
    const read = parseScenarios(scenariosText);
    scenarios = read.scenarios;
    issues.push(...read.issues);
  }
  // And so are personas, for simulated participants.
  const personasText = only ? null : source.read(PERSONAS_FILE);
  let personas: PersonasFile | undefined;
  if (personasText !== null) {
    pages[PERSONAS_FILE] = personasText;
    const read = parsePersonas(personasText);
    personas = read.personas ?? undefined;
    issues.push(...read.issues);
  }

  if (!settings.media.baseUrl) {
    const checkMedia = (file: string, name: string | undefined, from?: CsvRowSource) => {
      if (name && !source.has(path.join(file, name))) {
        issues.push({
          severity: "error",
          message: `The image "${name}" isn't in ${file}.`,
          file: from?.file,
          row: from?.row,
        });
      }
    };
    for (const actor of actors) {
      checkMedia(MEDIA_FOLDERS.actors, actor.picture, actor.source);
      checkMedia(MEDIA_FOLDERS.actors, actor.banner, actor.source);
      for (const picture of Object.values(actor.conditionPictures ?? {})) {
        checkMedia(MEDIA_FOLDERS.actors, picture, actor.source);
      }
    }
    for (const space of spaces) {
      checkMedia(MEDIA_FOLDERS.spaces, space.picture, space.source);
      checkMedia(MEDIA_FOLDERS.spaces, space.banner, space.source);
    }
    for (const post of posts) {
      for (const picture of post.pictures) {
        checkMedia(MEDIA_FOLDERS.posts, picture, post.source);
      }
    }
    for (const story of stories) {
      checkMedia(MEDIA_FOLDERS.posts, story.picture, story.source);
    }
    for (const image of [settings.site.logo, settings.site.favicon]) {
      if (!only && image && !source.has(image)) {
        issues.push({
          severity: "error",
          file: "study.yaml",
          message: `"${image}" doesn't exist.`,
        });
      }
    }
  }

  return {
    tables: {
      pages,
      actors,
      spaces,
      posts,
      comments,
      reactions,
      removals,
      labels,
      flagAnswers,
      bans,
      reportAnswers,
      autoRules,
      appealAnswers,
      contextNotes,
      stories,
      beats,
      ...(christof ? { christof } : {}),
      scenarios,
      ...(personas ? { personas } : {}),
    },
    issues,
  };
}

type CsvRowSource = { file: string; row: number };
