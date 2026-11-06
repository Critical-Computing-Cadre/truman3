import {
  type FeatureKey,
  type FeatureSet,
  featuresFor,
  type LayoutKey,
  layoutFor,
  type StudySettings,
} from "@truman3/core";
import { stringify } from "csv-stringify/sync";

/** The sheets a draft can take from an upload, so far: most of a feed. */
export const UPLOAD_SHEETS = ["actors.csv", "posts.csv", "comments.csv"] as const;
export type UploadSheet = (typeof UPLOAD_SHEETS)[number];

/**
 * A column, the features it's for (any one is enough), the layouts that show it, and an example.
 * Without `for` or `layouts`, every study has it.
 */
interface Column {
  name: string;
  for?: readonly FeatureKey[];
  layouts?: readonly LayoutKey[];
  example: string;
}

/** What decides a study's columns: what it has turned on, and how it looks. */
export interface SheetPlatform {
  features: FeatureSet;
  layout: LayoutKey;
}

/**
 * What each sheet a researcher downloads has, in order. A column for something the study has
 * turned off is left out, so the sheet only asks about what participants will see. Leaving one out
 * doesn't stop it from being used: an upload takes every column a study folder can have.
 */
const COLUMNS: Record<UploadSheet, readonly Column[]> = {
  "actors.csv": [
    { name: "username", example: "ann" },
    { name: "name", example: "Ann Lee" },
    { name: "bio", example: "Hiking, coffee, and my dog" },
    { name: "picture", example: "ann.jpg" },
    { name: "banner", layouts: ["short-posts"], example: "" },
    { name: "location", example: "Ithaca, New York" },
    { name: "followers", for: ["followCounts"], example: "1200" },
    { name: "following", for: ["followCounts"], example: "300" },
    { name: "startsFollowed", for: ["followingFeed"], example: "yes" },
    { name: "badge", for: ["badges"], example: "" },
    { name: "suggested", for: ["whoToFollow"], example: "" },
    { name: "karma", for: ["karma"], example: "1500" },
    { name: "moderator", for: ["removal", "bans", "modLog"], example: "no" },
    { name: "flair", for: ["flair"], example: "" },
    { name: "condition", example: "" },
  ],
  "posts.csv": [
    { name: "id", example: "p1" },
    { name: "actor", example: "ann" },
    { name: "time", example: "-2:00" },
    { name: "title", for: ["titles"], example: "Our first trip up the lake trail" },
    { name: "body", example: "Made it to the top before sunrise." },
    { name: "picture", example: "lake.jpg" },
    { name: "space", for: ["spaces"], example: "" },
    { name: "link", for: ["links"], example: "" },
    { name: "place", for: ["places"], example: "Ithaca, New York" },
    { name: "tagged", for: ["photoTags"], example: "" },
    { name: "likes", for: ["likes"], example: "108" },
    { name: "likedBy", for: ["likes"], layouts: ["photo"], example: "" },
    { name: "ups", for: ["votes"], example: "42" },
    { name: "downs", for: ["votes"], example: "3" },
    { name: "reposts", for: ["reposts"], example: "12" },
    { name: "quotes", for: ["quotes"], example: "2" },
    { name: "repostOf", for: ["reposts"], example: "" },
    { name: "quoteOf", for: ["quotes"], example: "" },
    { name: "views", for: ["viewCounts"], example: "5400" },
    { name: "flair", for: ["flair"], example: "" },
    { name: "tags", for: ["spoilers", "adultTags"], example: "" },
    { name: "poll", for: ["polls"], example: "" },
    { name: "pinned", for: ["pinning"], example: "" },
    { name: "locked", for: ["locking"], example: "" },
    { name: "crosspostOf", for: ["crossposting"], example: "" },
    { name: "ad", for: ["ads"], example: "" },
    { name: "condition", example: "" },
  ],
  "comments.csv": [
    { name: "id", example: "c1" },
    { name: "postID", example: "p1" },
    { name: "actor", example: "ann" },
    { name: "time", example: "-1:30" },
    { name: "body", example: "It was worth the early start!" },
    { name: "replyToID", for: ["threads"], example: "" },
    { name: "likes", for: ["likes"], example: "2" },
    { name: "ups", for: ["votes"], example: "2" },
    { name: "downs", for: ["votes"], example: "0" },
    { name: "condition", example: "" },
  ],
};

/** What's on anywhere in the study, in any condition, and its layout. */
export function sheetPlatform(settings: StudySettings): SheetPlatform {
  const sets = settings.conditions.arms.map(({ key }) => featuresFor(settings, key));
  const [first, ...rest] = sets;
  if (!first) {
    throw new Error("A study always has a condition.");
  }
  const features = Object.fromEntries(
    Object.keys(first).map((key) => [key, [first, ...rest].some((set) => set[key as FeatureKey])]),
  ) as FeatureSet;
  return { features, layout: layoutFor(settings) };
}

const columnsFor = (sheet: UploadSheet, { features, layout }: SheetPlatform) =>
  COLUMNS[sheet].filter(
    (column) =>
      (!column.for || column.for.some((key) => features[key])) &&
      (!column.layouts || column.layouts.includes(layout)),
  );

/** The columns a sheet has for a study with these features. */
export function sheetColumns(sheet: UploadSheet, platform: SheetPlatform): string[] {
  return columnsFor(sheet, platform).map(({ name }) => name);
}

/**
 * The sheets to fill in, for a study like this: the columns, and one example row so it's clear what
 * goes where. Comments are left out where people can't comment.
 */
export function blankSheets(platform: SheetPlatform): Map<UploadSheet, string> {
  const sheets = new Map<UploadSheet, string>();
  for (const sheet of UPLOAD_SHEETS) {
    if (sheet === "comments.csv" && !platform.features.comments) {
      continue;
    }
    const columns = columnsFor(sheet, platform);
    sheets.set(
      sheet,
      stringify([columns.map(({ name }) => name), columns.map(({ example }) => example)]),
    );
  }
  return sheets;
}
