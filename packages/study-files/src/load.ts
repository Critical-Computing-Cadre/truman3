import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type ActorDefinition,
  type AppealAnswerDefinition,
  type AutoRuleDefinition,
  type BanDefinition,
  type CommentDefinition,
  type ContextNoteDefinition,
  type FlagAnswerDefinition,
  type Flair,
  hasErrors,
  PIN_PLACES,
  POST_TAGS,
  type PostDefinition,
  parseStudyTime,
  type ReactionDefinition,
  type RemovalDefinition,
  type ReportAnswerDefinition,
  type SpaceDefinition,
  type StudyDefinition,
  type StudyIssue,
  studyDefinitionSchema,
  studySettingsSchema,
  validateStudy,
} from "@truman3/core";
import { parse as parseYaml } from "yaml";
import { type CsvRow, type CsvSpec, parseCsv } from "./csv.ts";

const ACTORS: CsvSpec = {
  required: ["username", "name"],
  optional: [
    "gender",
    "age",
    "location",
    "bio",
    "picture",
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
const POSTS: CsvSpec = {
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
    "likes",
    "ups",
    "downs",
    "condition",
    "class",
  ],
};
const SPACES: CsvSpec = {
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
const COMMENTS: CsvSpec = {
  required: ["id", "body", "actor", "postID", "time"],
  optional: ["replyToID", "likes", "ups", "downs", "condition", "class"],
};
const REACTIONS: CsvSpec = {
  required: ["on", "nth", "type", "actor", "after"],
  optional: ["body", "condition", "class"],
};
const FLAG_ANSWERS: CsvSpec = {
  required: ["action", "actor", "after"],
  optional: ["on", "target", "message", "condition", "class"],
};
const BANS: CsvSpec = {
  required: ["user", "actor", "time"],
  optional: ["reason", "space", "condition", "class"],
};
const REPORT_ANSWERS: CsvSpec = {
  required: ["action", "actor", "after"],
  optional: ["user", "message", "condition", "class"],
};
const AUTO_RULES: CsvSpec = {
  required: ["id", "on", "match", "action", "actor", "after"],
  optional: ["message", "holdOutcome", "condition", "class"],
};
const APPEAL_ANSWERS: CsvSpec = {
  required: ["action", "actor", "after"],
  optional: ["message", "condition", "class"],
};
const CONTEXT_NOTES: CsvSpec = {
  required: ["id", "postID", "body", "time"],
  optional: ["helpful", "notHelpful", "condition", "class"],
};
const REMOVALS: CsvSpec = {
  required: ["on", "target", "actor", "time"],
  optional: ["reason", "condition", "class"],
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
  const issues: StudyIssue[] = [];

  const settingsPath = path.join(folder, "study.yaml");
  if (!existsSync(settingsPath)) {
    return { issues: [{ severity: "error", message: `There's no study.yaml in ${folder}.` }] };
  }

  let rawSettings: unknown;
  try {
    rawSettings = parseYaml(readFileSync(settingsPath, "utf8"));
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

  const readTable = (file: string, spec: CsvSpec, required: boolean): CsvRow[] => {
    const fullPath = path.join(folder, file);
    if (!existsSync(fullPath)) {
      if (required) {
        issues.push({ severity: "error", file, message: "This file is missing." });
      }
      return [];
    }
    const result = parseCsv(readFileSync(fullPath, "utf8"), file, spec);
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
      ...(yesOrNo(cells.moderator, "moderator", "actors.csv", row) ? { moderator: true } : {}),
      ...optional("karma", signedNumber(cells.karma, "karma", "actors.csv", row)),
      ...optional("followers", wholeNumber(cells.followers, "followers", "actors.csv", row)),
      ...optional("following", wholeNumber(cells.following, "following", "actors.csv", row)),
      ...startsFollowedFrom(cells.startsFollowed),
      ...optional("badge", cells.badge || undefined),
      ...(/^(yes|true)$/i.test(cells.suggested ?? "") ? { suggested: true } : {}),
      ...actorFlair(cells.flair, row),
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
    if (on !== "post" && on !== "comment") {
      rowError(file, row, `"${on}" in on has to be post or comment.`);
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
      type !== "repost" &&
      type !== "follow"
    ) {
      rowError(
        file,
        row,
        `"${type}" in type has to be read, like, reply, up, down, remove, warn, repost, or follow.`,
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

  const pages: Record<string, string> = {};
  for (const step of settings.data.flow) {
    if (step.step === "consent" || step.step === "page") {
      const pagePath = path.join(folder, step.page);
      if (existsSync(pagePath)) {
        pages[step.page] = readFileSync(pagePath, "utf8");
      }
    }
  }

  if (!settings.data.media.baseUrl) {
    const checkMedia = (file: string, name: string | undefined, source?: CsvRowSource) => {
      if (name && !existsSync(path.join(folder, file, name))) {
        issues.push({
          severity: "error",
          message: `The image "${name}" isn't in ${file}.`,
          file: source?.file,
          row: source?.row,
        });
      }
    };
    for (const actor of actors) {
      checkMedia(MEDIA_FOLDERS.actors, actor.picture, actor.source);
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
    for (const image of [settings.data.site.logo, settings.data.site.favicon]) {
      if (image && !existsSync(path.join(folder, image))) {
        issues.push({
          severity: "error",
          file: "study.yaml",
          message: `"${image}" doesn't exist.`,
        });
      }
    }
  }

  const parsed = studyDefinitionSchema.safeParse({
    settings: settings.data,
    pages,
    actors,
    spaces,
    posts,
    comments,
    reactions,
    removals,
    flagAnswers,
    bans,
    reportAnswers,
    autoRules,
    appealAnswers,
    contextNotes,
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

type CsvRowSource = { file: string; row: number };
