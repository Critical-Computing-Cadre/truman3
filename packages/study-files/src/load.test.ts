import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasErrors } from "@truman3/core";
import { afterEach, describe, expect, it } from "vitest";
import { loadStudyFolder } from "./load.ts";

const YAML = `
schemaVersion: 1
slug: demo
title: Demo
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: Prolific ID, source: prolific }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }, { key: b, feed: { ranker: shuffle } }]
feed: { ranker: chronological, windowHours: 24 }
media: { baseUrl: "https://cdn.example.com/study/" }
flow: [{ step: feed }]
`;

const folders: string[] = [];

function folder(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-study-"));
  folders.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const base = {
  "study.yaml": YAML,
  "actors.csv": "username,name\nann,Ann\n",
  "posts.csv": "id,body,actor,time,condition\n1,hello,ann,0:00,a|b\n",
};

const messagesFor = (files: Record<string, string>) =>
  loadStudyFolder(folder(files)).issues.map((issue) => {
    const place = [issue.file, issue.row].filter(Boolean).join(":");
    return `${place} ${issue.message}`;
  });

afterEach(() => {
  for (const dir of folders.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadStudyFolder", () => {
  it("reads a valid study", () => {
    const { definition, issues } = loadStudyFolder(folder(base));

    expect(issues).toEqual([]);
    expect(definition?.posts[0]).toMatchObject({
      ref: "1",
      body: "hello",
      actor: "ann",
      timeMs: 0,
      conditions: ["a", "b"],
      source: { file: "posts.csv", row: 2 },
    });
  });

  it("handles a byte-order mark and quoted cells with commas and line breaks, as Excel writes", () => {
    const { definition, issues } = loadStudyFolder(
      folder({
        ...base,
        "posts.csv": `﻿id,body,actor,time\n1,"hi, there\nfriend",ann,0:00\n2,two,ann,0:01\n`,
      }),
    );

    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(definition?.posts[0]?.body).toBe("hi, there\nfriend");
    // A spreadsheet shows this as row 3, even though the quoted line break makes it line 4.
    expect(definition?.posts[1]?.source?.row).toBe(3);
  });

  it("tells you when study.yaml is missing", () => {
    expect(hasErrors(loadStudyFolder(folder({})).issues)).toBe(true);
  });

  it("points at a misspelled setting", () => {
    const messages = messagesFor({
      ...base,
      "study.yaml": YAML.replace("windowHours: 24", "windowHour: 24"),
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("study.yaml");
    expect(messages[0]).toContain("windowHour");
  });

  it("reports a required file that's missing", () => {
    expect(messagesFor({ "study.yaml": YAML, "actors.csv": base["actors.csv"] })).toContain(
      "posts.csv This file is missing.",
    );
  });

  it("reports unknown and missing columns", () => {
    const messages = messagesFor({ ...base, "posts.csv": "id,bodyy,time\n1,hello,0:00\n" });

    expect(messages).toContain(
      `posts.csv There's a column called "bodyy", which isn't one this file can have.`,
    );
    expect(messages).toContain(`posts.csv The "actor" column is missing.`);
  });

  it("reports bad values with their spreadsheet row", () => {
    const messages = messagesFor({
      ...base,
      "actors.csv": "username,name,age\nann,Ann,old\n",
      "posts.csv": "id,body,actor,time\n1,hello,ann,noon\n",
    });

    expect(messages).toContain(`actors.csv:2 "old" in age isn't a whole number.`);
    expect(messages).toContain(
      `posts.csv:2 "noon" in time isn't a time. Use hours:minutes, like 2:05.`,
    );
  });

  it("runs the shared study rules, with a location", () => {
    expect(
      messagesFor({ ...base, "posts.csv": "id,body,actor,time\n1,hello,nobody,0:00\n" }),
    ).toContain(`posts.csv:2 Post "1" is by "nobody", who isn't in the list of actors.`);
  });

  it("reports images that aren't in the folder", () => {
    const local = YAML.replace(`media: { baseUrl: "https://cdn.example.com/study/" }\n`, "");
    const messages = messagesFor({
      ...base,
      "study.yaml": local,
      "posts.csv": "id,picture,actor,time\n1,gone.jpg,ann,0:00\n",
    });
    expect(messages).toContain(`posts.csv:2 The image "gone.jpg" isn't in media/posts.`);
  });

  it("doesn't look for images locally when they're hosted elsewhere", () => {
    const { issues } = loadStudyFolder(
      folder({ ...base, "posts.csv": "id,picture,actor,time,condition\n1,x.jpg,ann,0:00,a|b\n" }),
    );
    expect(issues).toEqual([]);
  });

  it("includes the text of pages in the flow, and reports missing ones", () => {
    const withPage = YAML.replace(
      "flow: [{ step: feed }]",
      "flow: [{ step: consent, page: pages/consent.md }, { step: feed }]",
    );
    const { definition } = loadStudyFolder(
      folder({ ...base, "study.yaml": withPage, "pages/consent.md": "# Hello" }),
    );
    expect(definition?.pages).toEqual({ "pages/consent.md": "# Hello" });

    expect(messagesFor({ ...base, "study.yaml": withPage })).toContain(
      ` The flow uses the page "pages/consent.md", which doesn't exist.`,
    );
  });
});

describe("spaces", () => {
  const SETTINGS = `
schemaVersion: 1
slug: demo
title: Demo
site: { name: Demo }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions: { assignment: { method: uniform }, arms: [{ key: a }] }
platform: { style: mixed, features: { spaces: true } }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }]
`;

  it("reads spaces.csv, a post's space, and who's a moderator", () => {
    const { definition, issues } = loadStudyFolder(
      folder({
        "study.yaml": SETTINGS,
        "actors.csv": "username,name,moderator\nann,Ann,yes\nben,Ben,no\n",
        "spaces.csv": "key,name,rules,startsJoined\ncooking,Cooking,Be kind,no\nnews,News,,\n",
        "posts.csv": "id,body,actor,space,time\np1,hi,ann,cooking,0:00\np2,yo,ben,,0:00\n",
      }),
    );
    expect(issues.filter(({ severity }) => severity === "error")).toEqual([]);
    expect(definition?.spaces[0]).toMatchObject({
      key: "cooking",
      rules: "Be kind",
      startsJoined: false,
    });
    expect(definition?.spaces[1]?.startsJoined).toBe(true);
    expect(definition?.spaces[0]?.members).toBeUndefined();
    expect(definition?.posts[0]?.space).toBe("cooking");
    expect(definition?.posts[1]).not.toHaveProperty("space");
    expect(definition?.actors[0]?.moderator).toBe(true);
    expect(definition?.actors[1]).not.toHaveProperty("moderator");
  });

  it("needs nothing new from a study without them", () => {
    const { definition, issues } = loadStudyFolder(
      folder({
        "study.yaml": SETTINGS,
        "actors.csv": "username,name\nann,Ann\n",
        "posts.csv": "id,body,actor,time\np1,hi,ann,0:00\n",
      }),
    );
    expect(issues.filter(({ severity }) => severity === "error")).toEqual([]);
    expect(definition?.spaces).toEqual([]);
  });

  it("refuses a value that isn't yes or no", () => {
    const { issues } = loadStudyFolder(
      folder({
        "study.yaml": SETTINGS,
        "actors.csv": "username,name,moderator\nann,Ann,maybe\n",
        "posts.csv": "id,body,actor,time\np1,hi,ann,0:00\n",
      }),
    );
    expect(issues.map(({ message }) => message).join(" ")).toMatch(/has to be yes or no/);
  });
});

describe("forum columns", () => {
  const files = {
    "study.yaml": YAML,
    "actors.csv": "username,name,karma\nann,Ann,1200\nben,Ben,-3\nkim,Kim,\n",
    "spaces.csv": "key,name,accent\nx,X,#1d4ed8\n",
    "posts.csv": "id,title,body,actor,space,time\n1,A title,text,ann,x,-1:00\n2,,more,ben,,-1:00\n",
  };

  it("reads titles, karma, and a community's color", () => {
    const { definition } = loadStudyFolder(folder(files));
    expect(definition?.posts[0]?.title).toBe("A title");
    expect(definition?.posts[1]).not.toHaveProperty("title");
    expect(definition?.actors.map(({ karma }) => karma)).toEqual([1200, -3, undefined]);
    expect(definition?.spaces[0]?.accent).toBe("#1d4ed8");
  });

  it("says so when karma isn't a number", () => {
    const { issues } = loadStudyFolder(
      folder({ ...files, "actors.csv": "username,name,karma\nann,Ann,lots\nben,Ben,\n" }),
    );
    expect(hasErrors(issues)).toBe(true);
    expect(issues.map(({ message }) => message).join()).toContain('"lots" in karma');
  });
});

describe("polls, flair, and crossposts", () => {
  const files = {
    "study.yaml": YAML,
    "actors.csv": "username,name,flair\nann,Ann,x=Chef|y=Novice\n",
    "spaces.csv":
      "key,name,postFlair,userFlair,requirePostFlair\nx,X,News=#1d4ed8|Question,Chef,yes\ny,Y,,Novice,\n",
    "posts.csv":
      "id,body,actor,space,poll,pollResultsFirst,flair,crosspostOf,time\n1,Text,ann,x,Yes=12|No,yes,News,,-1:00\n2,,ann,y,,,,1,-1:00\n",
  };

  it("reads them", () => {
    const { definition, issues } = loadStudyFolder(folder(files));
    expect(hasErrors(issues)).toBe(false);
    expect(definition?.posts[0]?.poll).toEqual({
      options: [
        { text: "Yes", votes: 12 },
        { text: "No", votes: 0 },
      ],
      resultsFirst: true,
    });
    expect(definition?.posts[0]?.flair).toBe("News");
    expect(definition?.posts[1]?.crosspostOf).toBe("1");
    expect(definition?.spaces[0]?.postFlair).toEqual([
      { text: "News", color: "#1d4ed8" },
      { text: "Question" },
    ]);
    expect(definition?.spaces[0]?.requirePostFlair).toBe(true);
    expect(definition?.actors[0]?.spaceFlair).toEqual({ x: "Chef", y: "Novice" });
  });

  it("says so when flair on a person isn't written properly", () => {
    const { issues } = loadStudyFolder(
      folder({ ...files, "actors.csv": "username,name,flair\nann,Ann,Chef\n" }),
    );
    expect(issues.map(({ message }) => message).join()).toContain("space=Label");
  });

  it("refuses a poll with one option", () => {
    const { issues } = loadStudyFolder(
      folder({
        ...files,
        "posts.csv": "id,body,actor,poll,time\n1,Text,ann,Yes,-1:00\n",
      }),
    );
    expect(hasErrors(issues)).toBe(true);
  });
});

describe("removals.csv", () => {
  it("reads who removes what, when, and why", () => {
    const dir = folder({
      ...base,
      "removals.csv": "on,target,actor,time,reason,condition\npost,1,ann,1:00,Rule 2,\n",
    });
    const { definition } = loadStudyFolder(dir);
    expect(definition?.removals).toEqual([
      expect.objectContaining({
        on: "post",
        target: "1",
        actor: "ann",
        timeMs: 3_600_000,
        reason: "Rule 2",
      }),
    ]);
  });

  it("is optional, and refuses a kind it doesn't know", () => {
    expect(loadStudyFolder(folder(base)).definition?.removals).toEqual([]);
    const { issues } = loadStudyFolder(
      folder({ ...base, "removals.csv": "on,target,actor,time\nspace,1,ann,1:00\n" }),
    );
    expect(issues.map(({ message }) => message).join()).toContain("has to be post or comment");
  });
});

describe("flag-answers.csv", () => {
  it("reads an answer to any flag, and one naming a post", () => {
    const dir = folder({
      ...base,
      "flag-answers.csv":
        "on,target,action,actor,after,message\npost,1,remove,ann,0:10,Why\n,,answer,ann,0:00,No\n",
    });
    expect(loadStudyFolder(dir).definition?.flagAnswers).toEqual([
      expect.objectContaining({ on: "post", target: "1", action: "remove", message: "Why" }),
      expect.objectContaining({ action: "answer", message: "No", afterMs: 0 }),
    ]);
  });

  it("refuses an action it doesn't know", () => {
    const { issues } = loadStudyFolder(
      folder({ ...base, "flag-answers.csv": "action,actor,after\nban,ann,0:00\n" }),
    );
    expect(issues.map(({ message }) => message).join()).toContain("has to be remove or answer");
  });
});

describe("bans.csv and report-answers.csv", () => {
  it("reads both", () => {
    const { definition } = loadStudyFolder(
      folder({
        ...base,
        "bans.csv": "user,actor,time,reason,space\nann,ann,1:00,Why,\n",
        "report-answers.csv":
          "user,action,actor,after,message\n,answer,ann,0:00,No\nann,ban,ann,0:00,\n",
      }),
    );
    expect(definition?.bans).toEqual([
      expect.objectContaining({ user: "ann", timeMs: 3_600_000, reason: "Why" }),
    ]);
    expect(definition?.reportAnswers).toEqual([
      expect.objectContaining({ action: "answer", message: "No" }),
      expect.objectContaining({ action: "ban", user: "ann" }),
    ]);
  });

  it("refuses an action it doesn't know", () => {
    const { issues } = loadStudyFolder(
      folder({ ...base, "report-answers.csv": "action,actor,after\nremove,ann,0:00\n" }),
    );
    expect(issues.map(({ message }) => message).join()).toContain("has to be answer or ban");
  });
});

describe("auto-rules.csv and appeal-answers.csv", () => {
  it("reads both", () => {
    const { definition } = loadStudyFolder(
      folder({
        ...base,
        "auto-rules.csv":
          "id,on,match,action,actor,after,message,holdOutcome\nr,both,a|b,hold,ann,0:10,,remove\n",
        "appeal-answers.csv": "action,actor,after,message\nuphold,ann,0:00,No\n",
      }),
    );
    expect(definition?.autoRules).toEqual([
      expect.objectContaining({ ref: "r", on: "both", match: "a|b", holdOutcome: "remove" }),
    ]);
    expect(definition?.appealAnswers).toEqual([
      expect.objectContaining({ action: "uphold", message: "No" }),
    ]);
  });

  it("refuses what it doesn't know", () => {
    const { issues } = loadStudyFolder(
      folder({
        ...base,
        "auto-rules.csv": "id,on,match,action,actor,after\nr,space,a,ban,ann,0:00\n",
        "appeal-answers.csv": "action,actor,after\nmaybe,ann,0:00\n",
      }),
    );
    const said = issues.map(({ message }) => message).join();
    expect(said).toContain("has to be post, comment, or both");
    expect(said).toContain("has to be uphold or restore");
  });
});

describe("what short posts add to study files", () => {
  it("reads who starts out followed, for everyone or by condition, and counts", () => {
    const { definition } = loadStudyFolder(
      folder({
        ...base,
        "actors.csv":
          "username,name,followers,following,startsFollowed,badge\nann,Ann,5,6,yes,Expert\nbob,Bob,,,a|b,\ncy,Cy,,,no,\n",
        "posts.csv":
          "id,body,actor,time,repostOf,quoteOf,reposts,quotes\n1,hi,ann,0:00,,,3,4\n2,,bob,0:10,1,,,\n3,yo,bob,0:20,,1,,\n",
      }),
    );
    expect(definition?.actors[0]).toMatchObject({
      followers: 5,
      following: 6,
      startsFollowed: true,
      badge: "Expert",
    });
    expect(definition?.actors[1]?.startsFollowed).toEqual(["a", "b"]);
    expect(definition?.actors[2]?.startsFollowed).toBeUndefined();
    expect(definition?.posts[0]).toMatchObject({ reposts: 3, quotes: 4 });
    expect(definition?.posts[1]?.repostOf).toBe("1");
    expect(definition?.posts[2]?.quoteOf).toBe("1");
  });
});

describe("what's added for short posts, part 2", () => {
  it("reads notes, ads, views, and who's suggested", () => {
    const { definition } = loadStudyFolder(
      folder({
        ...base,
        "actors.csv": "username,name,suggested\nann,Ann,yes\n",
        "posts.csv": "id,body,actor,time,ad,views\n1,hi,ann,0:00,yes,50\n2,yo,ann,0:10,Promoted,\n",
        "context-notes.csv": "id,postID,body,time,helpful\nn,1,Context,1:00,4\n",
      }),
    );
    expect(definition?.actors[0]?.suggested).toBe(true);
    expect(definition?.posts[0]).toMatchObject({ ad: "Sponsored", views: 50 });
    expect(definition?.posts[1]?.ad).toBe("Promoted");
    expect(definition?.contextNotes).toEqual([
      expect.objectContaining({ ref: "n", post: "1", body: "Context", helpful: 4 }),
    ]);
  });
});
