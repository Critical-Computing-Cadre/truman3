import {
  hasErrors,
  studyDefinitionSchema,
  studySettingsSchema,
  TEMPLATES,
  type TemplateKey,
  validateStudy,
} from "@truman3/core";
import { describe, expect, it } from "vitest";
import type { CsvSpec } from "./csv.ts";
import {
  ACTORS,
  APPEAL_ANSWERS,
  AUTO_RULES,
  BANS,
  COMMENTS,
  CONTEXT_NOTES,
  FLAG_ANSWERS,
  LABELS,
  POSTS,
  REACTIONS,
  REMOVALS,
  REPORT_ANSWERS,
  readStudyTables,
  SPACES,
  STORIES,
  type StudyFiles,
} from "./load.ts";
import {
  blankSheets,
  sheetColumns,
  sheetPlatform,
  sheetsFor,
  UPLOAD_SHEETS,
  type UploadSheet,
} from "./sheets.ts";

const settingsFor = (template: TemplateKey, features: Record<string, boolean> = {}) =>
  studySettingsSchema.parse({
    schemaVersion: 1,
    slug: "s",
    title: "S",
    site: { name: "S" },
    length: { days: 1 },
    entry: { idParam: "PID", idLabel: "ID", source: "test" },
    conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }, { key: "b" }] },
    platform: { style: "mixed", template, features },
    flow: [{ step: "feed" }],
  });

const filesOf = (files: Record<string, string>): StudyFiles => ({
  read: (file) => files[file] ?? null,
  has: (file) => file in files,
});

describe("sheets to fill in", () => {
  it("only has columns a study folder can have", () => {
    const every = Object.fromEntries(Object.keys(TEMPLATES.classic.features).map((k) => [k, true]));
    const platform = { features: every as never, layout: "photo" as const };
    const specs: Record<UploadSheet, CsvSpec> = {
      "actors.csv": ACTORS,
      "spaces.csv": SPACES,
      "posts.csv": POSTS,
      "comments.csv": COMMENTS,
      "reactions.csv": REACTIONS,
      "stories.csv": STORIES,
      "context-notes.csv": CONTEXT_NOTES,
      "removals.csv": REMOVALS,
      "labels.csv": LABELS,
      "flag-answers.csv": FLAG_ANSWERS,
      "report-answers.csv": REPORT_ANSWERS,
      "bans.csv": BANS,
      "auto-rules.csv": AUTO_RULES,
      "appeal-answers.csv": APPEAL_ANSWERS,
    };
    for (const sheet of UPLOAD_SHEETS) {
      const allowed = [...specs[sheet].required, ...specs[sheet].optional];
      expect(sheetColumns(sheet, platform).filter((column) => !allowed.includes(column))).toEqual(
        [],
      );
      expect(sheetColumns(sheet, platform)).toEqual(
        expect.arrayContaining([...specs[sheet].required]),
      );
    }
  });

  it("asks about what each kind of platform shows, and not what it doesn't", () => {
    const columns = (template: TemplateKey) =>
      sheetColumns("posts.csv", sheetPlatform(settingsFor(template)));
    expect(columns("forum")).toEqual(expect.arrayContaining(["title", "space", "ups", "downs"]));
    expect(columns("forum")).not.toContain("reposts");
    expect(columns("photo")).toEqual(expect.arrayContaining(["place", "tagged", "likedBy"]));
    expect(columns("photo")).not.toContain("title");
    expect(columns("shortPosts")).toEqual(expect.arrayContaining(["reposts", "quotes", "views"]));
    expect(columns("classic")).not.toContain("place");
    expect(sheetColumns("actors.csv", sheetPlatform(settingsFor("shortPosts")))).toContain(
      "banner",
    );
    expect(sheetColumns("actors.csv", sheetPlatform(settingsFor("classic")))).not.toContain(
      "banner",
    );
  });

  it("counts what a study turns on, in any condition", () => {
    const settings = settingsFor("classic");
    const withPlaces = {
      ...settings,
      conditions: {
        ...settings.conditions,
        arms: settings.conditions.arms.map((arm) =>
          arm.key === "b" ? { ...arm, platform: { features: { places: true } } } : arm,
        ),
      },
    };
    expect(sheetColumns("posts.csv", sheetPlatform(withPlaces))).toContain("place");
  });

  it("has a sheet for each thing the study has on, and none for what's off", () => {
    expect(sheetsFor(sheetPlatform(settingsFor("classic")))).toEqual([
      "actors.csv",
      "posts.csv",
      "comments.csv",
      "reactions.csv",
    ]);
    expect(sheetsFor(sheetPlatform(settingsFor("forum")))).toEqual(
      expect.arrayContaining(["spaces.csv", "removals.csv", "bans.csv", "auto-rules.csv"]),
    );
    expect(sheetsFor(sheetPlatform(settingsFor("photo")))).toContain("stories.csv");
    expect(sheetsFor(sheetPlatform(settingsFor("shortPosts")))).toEqual(
      expect.arrayContaining(["labels.csv", "context-notes.csv"]),
    );
    const noComments = blankSheets(sheetPlatform(settingsFor("classic", { comments: false })));
    expect([...noComments.keys()]).not.toContain("comments.csv");
  });

  it("has example rows that make a small study with nothing to fix, for every kind", () => {
    for (const template of Object.keys(TEMPLATES) as TemplateKey[]) {
      // Everything on, so every sheet and every example is checked.
      const every = Object.fromEntries(
        Object.keys(TEMPLATES.classic.features).map((key) => [key, true]),
      );
      const settings = settingsFor(template, every);
      const files = Object.fromEntries(blankSheets(sheetPlatform(settings)));
      expect(Object.keys(files)).toEqual([...UPLOAD_SHEETS]);
      const pictures = ["media/actors/ann.jpg", "media/posts/lake.jpg", "media/posts/sunrise.jpg"];
      const { tables, issues } = readStudyTables(
        filesOf({ ...files, ...Object.fromEntries(pictures.map((name) => [name, ""])) }),
        settings,
        UPLOAD_SHEETS,
      );
      expect(issues, template).toEqual([]);
      const study = studyDefinitionSchema.parse({ settings, ...tables });
      const problems = validateStudy(study).filter(({ severity }) => severity === "error");
      expect(problems, template).toEqual([]);
      expect(hasErrors(problems)).toBe(false);
    }
  });
});

describe("reading only some sheets", () => {
  const settings = settingsFor("classic");

  it("needs none of them, and still reports a broken one", () => {
    const { tables, issues } = readStudyTables(
      filesOf({
        "posts.csv": "id,actor,time,body\np1,ann,-1:00,Hello\n",
        "reactions.csv": "not,a,real,sheet\n",
      }),
      settings,
      UPLOAD_SHEETS,
    );
    expect(tables.actors).toEqual([]);
    expect(tables.posts).toHaveLength(1);
    expect(tables.reactions).toEqual([]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(({ file }) => file === "reactions.csv")).toBe(true);
  });

  it("still says which row has a problem, and which picture is missing", () => {
    const { issues } = readStudyTables(
      filesOf({ "posts.csv": "id,actor,time,picture\np1,ann,soon,lake.jpg\n" }),
      settings,
      UPLOAD_SHEETS,
    );
    expect(issues).toEqual([
      expect.objectContaining({
        file: "posts.csv",
        row: 2,
        message: expect.stringContaining("soon"),
      }),
      expect.objectContaining({ message: 'The image "lake.jpg" isn\'t in media/posts.' }),
    ]);
  });
});
