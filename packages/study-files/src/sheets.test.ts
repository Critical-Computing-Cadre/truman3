import { studySettingsSchema, TEMPLATES, type TemplateKey } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { ACTORS, COMMENTS, POSTS, readStudyTables, type StudyFiles } from "./load.ts";
import { blankSheets, sheetColumns, sheetPlatform, UPLOAD_SHEETS } from "./sheets.ts";

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
    const specs = { "actors.csv": ACTORS, "posts.csv": POSTS, "comments.csv": COMMENTS };
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

  it("leaves out comments where people can't comment", () => {
    const sheets = blankSheets(sheetPlatform(settingsFor("classic", { comments: false })));
    expect([...sheets.keys()]).toEqual(["actors.csv", "posts.csv"]);
  });

  it("has an example row that reads back without a problem", () => {
    for (const template of Object.keys(TEMPLATES) as TemplateKey[]) {
      const settings = settingsFor(template);
      const files = Object.fromEntries(blankSheets(sheetPlatform(settings)));
      const { tables, issues } = readStudyTables(
        filesOf({ ...files, "media/actors/ann.jpg": "", "media/posts/lake.jpg": "" }),
        settings,
        UPLOAD_SHEETS,
      );
      expect(issues, template).toEqual([]);
      expect(tables.actors.map(({ username }) => username)).toEqual(["ann"]);
      expect(tables.posts.map(({ ref }) => ref)).toEqual(["p1"]);
    }
  });
});

describe("reading only some sheets", () => {
  const settings = settingsFor("classic");

  it("needs none of them, and leaves the others alone", () => {
    const { tables, issues } = readStudyTables(
      filesOf({
        "posts.csv": "id,actor,time,body\np1,ann,-1:00,Hello\n",
        "reactions.csv": "not,a,real,sheet\n",
      }),
      settings,
      UPLOAD_SHEETS,
    );
    expect(issues).toEqual([]);
    expect(tables.actors).toEqual([]);
    expect(tables.posts).toHaveLength(1);
    expect(tables.reactions).toEqual([]);
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
