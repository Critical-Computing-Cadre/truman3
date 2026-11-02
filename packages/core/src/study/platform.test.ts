import { describe, expect, it } from "vitest";
import { studySettingsSchema } from "./definition.ts";
import { fillLinkTemplate } from "./links.ts";
import { checkNewPost, platformStyleFor } from "./platform.ts";

const settings = (extra: object = {}) =>
  studySettingsSchema.parse({
    schemaVersion: 1,
    slug: "demo",
    title: "Demo",
    site: { name: "Demo" },
    length: { days: 1 },
    entry: { idParam: "PID", idLabel: "ID", source: "x" },
    conditions: {
      assignment: { method: "uniform" },
      arms: [{ key: "a" }, { key: "b", platform: { style: "text" } }],
    },
    flow: [{ step: "feed" }],
    ...extra,
  });

describe("easy defaults", () => {
  it("gives a chronological, stable feed and a mixed platform when nothing is set", () => {
    const parsed = settings();

    expect(parsed.platform.style).toBe("mixed");
    expect(parsed.feed).toMatchObject({
      ranker: "chronological",
      reshuffleEachVisit: false,
      removeFlagged: false,
    });
  });
});

describe("platformStyleFor", () => {
  it("uses the study's style, unless a condition has its own", () => {
    const parsed = settings({ platform: { style: "photo" } });

    expect(platformStyleFor(parsed, "a")).toBe("photo");
    expect(platformStyleFor(parsed, "b")).toBe("text");
  });
});

describe("checkNewPost", () => {
  it.each([
    ["photo", false, true, true],
    ["photo", true, true, true],
    ["photo", true, false, false],
    ["photo", false, false, false],
    ["text", true, false, true],
    ["text", false, false, false],
    ["text", true, true, false],
    ["mixed", true, false, true],
    ["mixed", false, true, true],
    ["mixed", true, true, true],
    ["mixed", false, false, false],
  ] as const)("on a %s platform, text %s and image %s: allowed %s", (style, text, image, ok) => {
    expect(checkNewPost(style, text, image) === null).toBe(ok);
  });
});

describe("fillLinkTemplate", () => {
  it("fills in both IDs", () => {
    expect(
      fillLinkTemplate("https://x.example/s?PROLIFIC_PID={externalId}&id={participantId}", {
        externalId: "abc",
        participantId: "p-1",
      }),
    ).toBe("https://x.example/s?PROLIFIC_PID=abc&id=p-1");
  });

  it("encodes values, so an odd ID can't break the link", () => {
    expect(
      fillLinkTemplate("https://x.example/s?id={externalId}", {
        externalId: "a b&c=d",
        participantId: "x",
      }),
    ).toBe("https://x.example/s?id=a%20b%26c%3Dd");
  });
});
