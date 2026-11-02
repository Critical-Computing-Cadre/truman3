import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { stringify as stringifyYaml } from "yaml";
import { MEDIA_FOLDERS } from "./load.ts";

type Row = Record<string, string>;

function readRows(file: string): Row[] {
  if (!existsSync(file)) {
    return [];
  }
  return parse(readFileSync(file, "utf8"), { bom: true, columns: true, skip_empty_lines: true });
}

function writeRows(file: string, columns: string[], rows: Row[]) {
  writeFileSync(file, stringify(rows, { header: true, columns }));
}

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) {
    return {};
  }
  const entries = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => [match[1] as string, (match[2] as string).replace(/^"|"$/g, "")]);
  return Object.fromEntries(entries);
}

/**
 * Converts an older Truman repo (with input/*.csv, post_pictures/, and profile_pictures/) into a
 * study folder, and starts a study.yaml from its .env.example. The study.yaml is a starting
 * point: the researcher still has to make the design decisions it marks.
 */
export function convertLegacyStudy(legacyRepo: string, outFolder: string, slug: string) {
  const input = path.join(legacyRepo, "input");
  mkdirSync(outFolder, { recursive: true });

  const copy = (name: string) => {
    if (existsSync(path.join(input, name))) {
      copyFileSync(path.join(input, name), path.join(outFolder, name));
    }
  };
  copy("actors.csv");
  copy("posts.csv");

  writeRows(
    path.join(outFolder, "comments.csv"),
    ["id", "body", "actor", "postID", "likes", "time", "condition", "class"],
    readRows(path.join(input, "replies.csv")),
  );

  const readsAndLikes = readRows(path.join(input, "notifications (read, like).csv")).map((row) => ({
    on: row.userPostID ? "post" : "comment",
    nth: (row.userPostID || row.userReplyID) ?? "",
    type: row.type ?? "",
    actor: row.actor ?? "",
    after: row.time ?? "",
    body: "",
    condition: row.condition ?? "",
    class: row.class ?? "",
  }));
  const replies = readRows(path.join(input, "notifications (reply).csv")).map((row) => ({
    on: "post",
    nth: row.userPostID ?? "",
    type: "reply",
    actor: row.actor ?? "",
    after: row.time ?? "",
    body: row.body ?? "",
    condition: row.condition ?? "",
    class: row.class ?? "",
  }));
  writeRows(
    path.join(outFolder, "reactions.csv"),
    ["on", "nth", "type", "actor", "after", "body", "condition", "class"],
    [...readsAndLikes, ...replies],
  );

  const copyPictures = (from: string, to: string) => {
    if (existsSync(path.join(legacyRepo, from))) {
      cpSync(path.join(legacyRepo, from), path.join(outFolder, to), { recursive: true });
    }
  };
  copyPictures("post_pictures", MEDIA_FOLDERS.posts);
  copyPictures("profile_pictures", MEDIA_FOLDERS.actors);

  const env = readEnvFile(path.join(legacyRepo, ".env.example"));
  const arms = (env.EXP_CONDITIONS_NAMES ?? "control")
    .split(",")
    .map((key) => ({ key: key.trim() }));

  const settings = {
    schemaVersion: 1,
    slug,
    title: env.SITE_NAME ?? slug,
    site: { name: env.SITE_NAME ?? slug },
    length: { days: Number(env.NUM_DAYS ?? 1) },
    entry: {
      idParam: "PROLIFIC_PID",
      idLabel: env.IDENTIFIER ?? "Prolific ID",
      source: "prolific",
    },
    conditions: { assignment: { method: "uniform" }, arms },
    // Older Truman required a photo on every post.
    platform: { style: "photo" },
    feed: {
      ranker: env.FEED_ORDER === "SHUFFLE" ? "shuffle" : "chronological",
      windowHours: 24,
      pinOwnPostsMinutes: 10,
      removeFlagged: env.REMOVE_FLAGGED_CONTENT === "TRUE",
      removeBlocked: true,
    },
    likes: {
      posts: [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6],
      comments: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 3, 4],
    },
    flow: [{ step: "account" }, { step: "feed" }, { step: "exit" }],
  };

  writeFileSync(
    path.join(outFolder, "study.yaml"),
    `# Converted from an older Truman study. These values reproduce how that version behaved, but\n# every one is a design decision. Review them, especially conditions.assignment.\n${stringifyYaml(settings)}`,
  );
}
