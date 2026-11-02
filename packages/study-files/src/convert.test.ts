import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertLegacyStudy } from "./convert.ts";
import { loadStudyFolder } from "./load.ts";

const dirs: string[] = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-convert-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("convertLegacyStudy", () => {
  it("produces a valid study from an old Truman repo", () => {
    const legacy = tempDir();
    const write = (name: string, text: string) => {
      mkdirSync(path.dirname(path.join(legacy, name)), { recursive: true });
      writeFileSync(path.join(legacy, name), text);
    };

    write(
      ".env.example",
      `NUM_DAYS=3\nIDENTIFIER="MTurk ID"\nEXP_CONDITIONS_NAMES=one,two\nFEED_ORDER=SHUFFLE\nREMOVE_FLAGGED_CONTENT=TRUE\nSITE_NAME=old.site\n`,
    );
    write(
      "input/actors.csv",
      "username,name,gender,age,location,bio,picture,condition,class\nann,Ann,,20,,,ann.jpg,,\n",
    );
    write(
      "input/posts.csv",
      "id,body,picture,actor,likes,time,condition,class\n0,hello,0.jpg,ann,,0:05,one,\n",
    );
    write(
      "input/replies.csv",
      "id,body,actor,postID,likes,time,condition,class\n0,hi,ann,0,,0:10,two,\n",
    );
    write(
      "input/notifications (read, like).csv",
      "userPostID,userReplyID,type,actor,time,condition,class\n0,,read,ann,0:01,,\n,2,like,ann,0:02,,\n",
    );
    write(
      "input/notifications (reply).csv",
      "id,userPostID,body,actor,time,condition,class\n0,1,nice,ann,0:04,,\n",
    );
    write("post_pictures/0.jpg", "image");
    write("profile_pictures/ann.jpg", "image");

    const out = path.join(tempDir(), "study");
    convertLegacyStudy(legacy, out, "old-study");
    const { definition, issues } = loadStudyFolder(out);

    expect(issues).toEqual([]);
    expect(definition?.settings).toMatchObject({
      slug: "old-study",
      length: { days: 3 },
      entry: { idLabel: "MTurk ID" },
      conditions: { arms: [{ key: "one" }, { key: "two" }] },
      feed: { ranker: "shuffle", removeFlagged: true },
    });
    expect(definition?.comments[0]).toMatchObject({ post: "0", conditions: ["two"] });
    expect(definition?.reactions.map(({ on, nth, type }) => [on, nth, type])).toEqual([
      ["post", 0, "read"],
      ["comment", 2, "like"],
      ["post", 1, "reply"],
    ]);
  });
});
