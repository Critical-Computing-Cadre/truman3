import {
  type FeatureKey,
  type FeatureSet,
  featuresFor,
  type LayoutKey,
  layoutFor,
  type StudySettings,
} from "@truman3/core";
import { stringify } from "csv-stringify/sync";

/** Every sheet a draft can take from an upload: all that a study folder can have. */
export const UPLOAD_SHEETS = [
  "actors.csv",
  "spaces.csv",
  "posts.csv",
  "comments.csv",
  "reactions.csv",
  "stories.csv",
  "context-notes.csv",
  "removals.csv",
  "labels.csv",
  "flag-answers.csv",
  "report-answers.csv",
  "bans.csv",
  "auto-rules.csv",
  "appeal-answers.csv",
] as const;
export type UploadSheet = (typeof UPLOAD_SHEETS)[number];

/** A column, the features it's for (any one is enough), and the layouts that show it. */
interface Column {
  name: string;
  for?: readonly FeatureKey[];
  layouts?: readonly LayoutKey[];
}

interface Sheet {
  /** What it's for, in a sentence, for the note that comes with the sheets. */
  about: string;
  /** The features that make this sheet worth having. Without these, every study has it. */
  for?: readonly FeatureKey[];
  columns: readonly Column[];
  /** Rows that show what goes where. Together, they make a small study that checks out. */
  examples: readonly Record<string, string>[];
}

const condition = { name: "condition" };

/**
 * What each sheet a researcher downloads has, in order. A sheet or column for something the study
 * has turned off is left out, so the sheets only ask about what participants will see. Leaving one
 * out doesn't stop it from being used: an upload takes every column a study folder can have.
 */
const SHEETS: Record<UploadSheet, Sheet> = {
  "actors.csv": {
    about: "The people in the cast. A username is how the other sheets say who someone is.",
    columns: [
      { name: "username" },
      { name: "name" },
      { name: "bio" },
      { name: "picture" },
      { name: "pictures" },
      { name: "banner", layouts: ["short-posts"] },
      { name: "location" },
      { name: "followers", for: ["followCounts"] },
      { name: "following", for: ["followCounts"] },
      { name: "startsFollowed", for: ["followingFeed"] },
      { name: "badge", for: ["badges"] },
      { name: "suggested", for: ["whoToFollow"] },
      { name: "karma", for: ["karma"] },
      { name: "moderator", for: ["removal", "bans", "modLog", "labels"] },
      { name: "flair", for: ["flair"] },
      condition,
    ],
    examples: [
      {
        username: "ann",
        name: "Ann Lee",
        bio: "Hiking, coffee, and my dog",
        picture: "ann.jpg",
        location: "Ithaca, New York",
        followers: "1200",
        following: "300",
        startsFollowed: "yes",
        karma: "1500",
        moderator: "no",
      },
      { username: "mods", name: "Moderators", moderator: "yes", followers: "10", following: "0" },
    ],
  },
  "spaces.csv": {
    about: "The communities. A post says which one it's in by its key.",
    for: ["spaces"],
    columns: [
      { name: "key" },
      { name: "name" },
      { name: "description" },
      { name: "rules" },
      { name: "picture" },
      { name: "banner" },
      { name: "accent" },
      { name: "startsJoined" },
      { name: "members" },
      { name: "postFlair", for: ["flair"] },
      { name: "userFlair", for: ["flair"] },
      condition,
    ],
    examples: [
      {
        key: "hiking",
        name: "Hiking",
        description: "Trails, gear, and trip reports",
        rules: "Be kind. No selling.",
        startsJoined: "yes",
        members: "5400",
      },
    ],
  },
  "posts.csv": {
    about: "The posts. Each needs an id, which comments and the other sheets use to point at it.",
    columns: [
      { name: "id" },
      { name: "actor" },
      { name: "time" },
      { name: "title", for: ["titles"] },
      { name: "body" },
      { name: "picture" },
      { name: "space", for: ["spaces"] },
      { name: "link", for: ["links"] },
      { name: "place", for: ["places"] },
      { name: "tagged", for: ["photoTags"] },
      { name: "likes", for: ["likes"] },
      { name: "likedBy", for: ["likes"], layouts: ["photo"] },
      { name: "ups", for: ["votes"] },
      { name: "downs", for: ["votes"] },
      { name: "reposts", for: ["reposts"] },
      { name: "quotes", for: ["quotes"] },
      { name: "repostOf", for: ["reposts"] },
      { name: "quoteOf", for: ["quotes"] },
      { name: "views", for: ["viewCounts"] },
      { name: "flair", for: ["flair"] },
      { name: "tags", for: ["spoilers", "adultTags"] },
      { name: "poll", for: ["polls"] },
      { name: "pinned", for: ["pinning"] },
      { name: "locked", for: ["locking"] },
      { name: "crosspostOf", for: ["crossposting"] },
      { name: "ad", for: ["ads"] },
      condition,
    ],
    examples: [
      {
        id: "p1",
        actor: "ann",
        time: "-2:00",
        title: "Our first trip up the lake trail",
        body: "Made it to the top before sunrise.",
        picture: "lake.jpg",
        place: "Ithaca, New York",
        likes: "108",
        ups: "42",
        downs: "3",
        reposts: "12",
        quotes: "2",
        views: "5400",
      },
    ],
  },
  "comments.csv": {
    about: "The comments. postID says which post one is on.",
    for: ["comments"],
    columns: [
      { name: "id" },
      { name: "postID" },
      { name: "actor" },
      { name: "time" },
      { name: "body" },
      { name: "replyToID", for: ["threads"] },
      { name: "likes", for: ["likes"] },
      { name: "ups", for: ["votes"] },
      { name: "downs", for: ["votes"] },
      condition,
    ],
    examples: [
      {
        id: "c1",
        postID: "p1",
        actor: "ann",
        time: "-1:30",
        body: "It was worth the early start!",
        likes: "2",
        ups: "2",
        downs: "0",
      },
    ],
  },
  "reactions.csv": {
    about:
      "What the cast does after a participant writes something: their nth post or comment, counting from 0.",
    columns: [
      { name: "on" },
      { name: "nth" },
      { name: "type" },
      { name: "actor" },
      { name: "after" },
      { name: "body" },
      condition,
    ],
    examples: [
      { on: "post", nth: "0", type: "like", actor: "ann", after: "0:05" },
      { on: "post", nth: "0", type: "reply", actor: "ann", after: "0:10", body: "Love this!" },
    ],
  },
  "stories.csv": {
    about: "Stories, each a picture that's up for a while, like posts, in media/posts.",
    for: ["stories"],
    columns: [
      { name: "id" },
      { name: "actor" },
      { name: "picture" },
      { name: "time" },
      { name: "caption" },
      { name: "lastsHours" },
      { name: "highlight", for: ["highlights"] },
      { name: "closeFriends", for: ["closeFriends"] },
      condition,
    ],
    examples: [
      {
        id: "s1",
        actor: "ann",
        picture: "sunrise.jpg",
        time: "-1:00",
        caption: "Sunrise from the top",
        lastsHours: "24",
      },
    ],
  },
  "context-notes.csv": {
    about: "Notes on posts, as if readers had added context.",
    for: ["contextNotes"],
    columns: [
      { name: "id" },
      { name: "postID" },
      { name: "body" },
      { name: "time" },
      { name: "helpful" },
      { name: "notHelpful" },
      condition,
    ],
    examples: [
      {
        id: "n1",
        postID: "p1",
        body: "The trail was closed that morning.",
        time: "0:00",
        helpful: "12",
        notHelpful: "2",
      },
    ],
  },
  "removals.csv": {
    about: "A moderator removing a post or comment the study wrote, at a set time.",
    for: ["removal"],
    columns: [
      { name: "on" },
      { name: "target" },
      { name: "actor" },
      { name: "time" },
      { name: "reason" },
      condition,
    ],
    examples: [{ on: "comment", target: "c1", actor: "mods", time: "1:00", reason: "Off topic" }],
  },
  "labels.csv": {
    about: "A moderator labeling a post or comment, such as Spam. hides covers it until Show.",
    for: ["labels"],
    columns: [
      { name: "on" },
      { name: "target" },
      { name: "actor" },
      { name: "time" },
      { name: "label" },
      { name: "hides" },
      { name: "reason" },
      { name: "by" },
      { name: "ask" },
      condition,
    ],
    examples: [
      {
        on: "post",
        target: "p1",
        actor: "mods",
        time: "1:00",
        label: "Misleading",
        hides: "no",
        reason: "The trail was closed",
        by: "shown",
        ask: "Do you agree with this label?",
      },
    ],
  },
  "flag-answers.csv": {
    about: "What a moderator does when a participant flags something.",
    for: ["flagAnswers"],
    columns: [
      { name: "action" },
      { name: "actor" },
      { name: "after" },
      { name: "on" },
      { name: "target" },
      { name: "message" },
      condition,
    ],
    examples: [
      { action: "answer", actor: "mods", after: "0:10", message: "Thanks, we'll take a look." },
    ],
  },
  "report-answers.csv": {
    about: "What a moderator does when a participant reports someone.",
    for: ["reportAnswers"],
    columns: [
      { name: "action" },
      { name: "actor" },
      { name: "after" },
      { name: "user" },
      { name: "message" },
      condition,
    ],
    examples: [
      { action: "answer", actor: "mods", after: "0:10", message: "Thanks for the report." },
    ],
  },
  "bans.csv": {
    about: "A moderator banning someone in the cast, at a set time.",
    for: ["bans"],
    columns: [
      { name: "user" },
      { name: "actor" },
      { name: "time" },
      { name: "reason" },
      { name: "space", for: ["spaces"] },
      condition,
    ],
    examples: [{ user: "ann", actor: "mods", time: "20:00", reason: "Repeated spam" }],
  },
  "auto-rules.csv": {
    about: "Rules that catch words in what a participant writes, before or after it posts.",
    for: ["autoRules"],
    columns: [
      { name: "id" },
      { name: "on" },
      { name: "match" },
      { name: "action" },
      { name: "actor" },
      { name: "after" },
      { name: "message" },
      { name: "holdOutcome" },
      condition,
    ],
    examples: [
      {
        id: "r1",
        on: "both",
        match: "buy now",
        action: "confirm",
        actor: "mods",
        after: "0:00",
        message: "This looks like selling. Post it anyway?",
      },
    ],
  },
  "appeal-answers.csv": {
    about: "What a moderator says when a participant appeals a removal or label.",
    for: ["appeals"],
    columns: [
      { name: "action" },
      { name: "actor" },
      { name: "after" },
      { name: "message" },
      condition,
    ],
    examples: [
      { action: "uphold", actor: "mods", after: "1:00", message: "We looked again. It stays." },
    ],
  },
};

/** What decides a study's sheets and columns: what it has turned on, and how it looks. */
export interface SheetPlatform {
  features: FeatureSet;
  layout: LayoutKey;
}

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

const on = (keys: readonly FeatureKey[] | undefined, { features }: SheetPlatform) =>
  !keys || keys.some((key) => features[key]);

const columnsFor = (sheet: UploadSheet, platform: SheetPlatform) =>
  SHEETS[sheet].columns.filter(
    (column) =>
      on(column.for, platform) && (!column.layouts || column.layouts.includes(platform.layout)),
  );

/** The sheets a study like this has. */
export function sheetsFor(platform: SheetPlatform): UploadSheet[] {
  return UPLOAD_SHEETS.filter((sheet) => on(SHEETS[sheet].for, platform));
}

/** The columns a sheet has for a study like this. */
export function sheetColumns(sheet: UploadSheet, platform: SheetPlatform): string[] {
  return columnsFor(sheet, platform).map(({ name }) => name);
}

/** What a sheet is for, in a sentence. */
export function sheetAbout(sheet: UploadSheet): string {
  return SHEETS[sheet].about;
}

/**
 * The sheets to fill in, for a study like this: the columns, and example rows so it's clear what
 * goes where. They name pictures the zip doesn't have yet, which are ann.jpg, lake.jpg, and
 * sunrise.jpg, so they're replaced before uploading.
 */
export function blankSheets(platform: SheetPlatform): Map<UploadSheet, string> {
  const sheets = new Map<UploadSheet, string>();
  for (const sheet of sheetsFor(platform)) {
    const names = sheetColumns(sheet, platform);
    sheets.set(
      sheet,
      stringify([
        names,
        ...SHEETS[sheet].examples.map((row) => names.map((name) => row[name] ?? "")),
      ]),
    );
  }
  return sheets;
}
