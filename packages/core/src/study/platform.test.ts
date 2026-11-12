import { describe, expect, it } from "vitest";
import { FEATURE_KEYS } from "../features/catalog.ts";
import { TEMPLATES } from "../features/templates.ts";
import { linkDomain, MAX_LINK_LENGTH, safeLink } from "../post-extras.ts";
import type { StudySettings } from "./definition.ts";
import { studySettingsSchema } from "./definition.ts";
import { fillLinkTemplate } from "./links.ts";
import {
  accentFor,
  checkNewPost,
  commentBoxFor,
  featuresFor,
  freezePlatform,
  layoutFor,
  platformStyleFor,
  sureButtonFor,
  themeFor,
} from "./platform.ts";

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

describe("commentBoxFor", () => {
  const study = (commentBox?: "open" | "onReply", armBox?: "open" | "onReply") =>
    settings({
      platform: { style: "photo", ...(commentBox ? { commentBox } : {}) },
      conditions: {
        assignment: { method: "uniform" },
        arms: [{ key: "a" }, { key: "b", ...(armBox ? { platform: { commentBox: armBox } } : {}) }],
      },
    });

  it("is open unless the study says otherwise", () => {
    expect(commentBoxFor(study(), "a")).toBe("open");
    expect(commentBoxFor(study("onReply"), "a")).toBe("onReply");
  });

  it("can differ by condition, without changing the condition's platform style", () => {
    const both = study("open", "onReply");
    expect(commentBoxFor(both, "b")).toBe("onReply");
    expect(platformStyleFor(both, "b")).toBe("photo");
  });
});

describe("sureButtonFor", () => {
  it("makes going back dark unless the study or a condition says otherwise", () => {
    const study = (sureButton?: string, armButton?: string) =>
      settings({
        platform: { style: "photo", ...(sureButton ? { sureButton } : {}) },
        conditions: {
          assignment: { method: "uniform" },
          arms: [
            { key: "a" },
            { key: "b", ...(armButton ? { platform: { sureButton: armButton } } : {}) },
          ],
        },
      });
    expect(sureButtonFor(study(), "a")).toBe("goBack");
    expect(sureButtonFor(study("postAnyway"), "a")).toBe("postAnyway");
    expect(sureButtonFor(study(undefined, "postAnyway"), "b")).toBe("postAnyway");
    expect(() => study("maybe")).toThrow();
  });
});

describe("themeFor", () => {
  const study = (theme?: string, armTheme?: string) =>
    settings({
      platform: { style: "photo", ...(theme ? { theme } : {}) },
      conditions: {
        assignment: { method: "uniform" },
        arms: [{ key: "a" }, { key: "b", ...(armTheme ? { platform: { theme: armTheme } } : {}) }],
      },
    });

  it("is light unless the study says otherwise", () => {
    expect(themeFor(study(), "a")).toBe("light");
    expect(themeFor(study("dark"), "a")).toBe("dark");
    expect(themeFor(study("device"), "a")).toBe("device");
  });

  it("starts as its kind of site does: dark for a photo app and a microblog", () => {
    const of = (template: string) => settings({ platform: { style: "mixed", template } });
    expect(themeFor(of("classic"), "a")).toBe("light");
    expect(themeFor(of("forum"), "a")).toBe("light");
    expect(themeFor(of("photo"), "a")).toBe("dark");
    expect(themeFor(of("shortPosts"), "a")).toBe("dark");
    expect(
      themeFor(settings({ platform: { style: "mixed", template: "photo", theme: "light" } }), "a"),
    ).toBe("light");
  });

  it("can differ by condition", () => {
    expect(themeFor(study("light", "dark"), "b")).toBe("dark");
    expect(themeFor(study("light", "dark"), "a")).toBe("light");
  });

  it("takes nothing else", () => {
    expect(() => study("sepia")).toThrow();
  });
});

describe("accentFor", () => {
  const study = (accent?: string, armAccent?: string) =>
    settings({
      platform: { style: "photo", ...(accent ? { accent } : {}) },
      conditions: {
        assignment: { method: "uniform" },
        arms: [
          { key: "a" },
          { key: "b", ...(armAccent ? { platform: { accent: armAccent } } : {}) },
        ],
      },
    });

  it("leaves the color to the kind of site unless the study picks one", () => {
    expect(accentFor(study(), "a")).toBeNull();
    expect(accentFor(study("#225588"), "a")).toBe("#225588");
  });

  it("can differ by condition", () => {
    expect(accentFor(study("#225588", "#aa3300"), "b")).toBe("#aa3300");
    expect(accentFor(study("#225588", "#aa3300"), "a")).toBe("#225588");
  });

  it("takes only a color written as #rrggbb, so nothing else can reach a page's styles", () => {
    expect(() => study("red")).toThrow();
    expect(() => study("#fff")).toThrow();
    expect(() => study("#225588; background: url(x)")).toThrow();
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

describe("checkNewPost with a title or a link", () => {
  it("lets either stand alone, except on a photo platform", () => {
    expect(checkNewPost("mixed", false, false, { titled: true })).toBeNull();
    expect(checkNewPost("text", false, false, { linked: true })).toBeNull();
    expect(checkNewPost("photo", false, false, { titled: true, linked: true })).not.toBeNull();
    expect(checkNewPost("text", false, true, { titled: true })).not.toBeNull();
  });
});

describe("safeLink", () => {
  it("takes full web addresses", () => {
    expect(safeLink(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(safeLink("http://example.com")).toBe("http://example.com/");
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " data:text/html,x",
    "vbscript:x",
    "file:///etc/passwd",
    "example.com",
    "https://user:secret@example.com/",
    "",
  ])("refuses %s", (link) => {
    expect(safeLink(link)).toBeNull();
  });

  it("refuses a very long address", () => {
    expect(safeLink(`https://example.com/${"a".repeat(MAX_LINK_LENGTH)}`)).toBeNull();
  });

  it("names the domain people recognize", () => {
    expect(linkDomain("https://www.example.org/story")).toBe("example.org");
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

describe("features", () => {
  const settings = (platform: object, armPlatform?: object) =>
    ({
      platform: { style: "mixed", ...platform },
      conditions: {
        assignment: { method: "uniform" },
        arms: [
          { key: "a", factors: {}, weight: 1, ...(armPlatform ? { platform: armPlatform } : {}) },
          { key: "b", factors: {}, weight: 1 },
        ],
      },
    }) as unknown as StudySettings;

  it("has the Classic template's features when nothing's chosen", () => {
    expect(featuresFor(settings({}), "a")).toEqual(TEMPLATES.classic.features);
    expect(layoutFor(settings({}))).toBe("classic");
  });

  it("lets a study change the template, and a condition change the study", () => {
    const changed = settings(
      { features: { likes: false, flagging: false } },
      { features: { likes: true } },
    );
    expect(featuresFor(changed, "a")).toMatchObject({
      likes: true,
      flagging: false,
      comments: true,
    });
    expect(featuresFor(changed, "b")).toMatchObject({ likes: false, flagging: false });
  });

  it("copies the template in when freezing, so changing a template can't change a version", () => {
    const frozen = freezePlatform(settings({ features: { likes: false } }));
    expect(frozen.platform).toMatchObject({ template: "classic", layout: "classic" });
    expect(Object.keys(frozen.platform.features ?? {}).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(frozen.platform.features?.likes).toBe(false);
    expect(frozen.platform.features?.comments).toBe(true);
    expect(featuresFor(frozen, "a")).toEqual(
      featuresFor(settings({ features: { likes: false } }), "a"),
    );
  });
});
