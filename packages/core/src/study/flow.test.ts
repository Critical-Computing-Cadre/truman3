import { describe, expect, it } from "vitest";
import { type StudySettings, studySettingsSchema } from "./definition.ts";
import { canLeaveFeed, currentFlowStep } from "./flow.ts";

const DAY = 24 * 3_600_000;

function settings(flow: unknown[]): StudySettings {
  return studySettingsSchema.parse({
    schemaVersion: 1,
    slug: "demo",
    title: "Demo",
    site: { name: "Demo" },
    length: { days: 2 },
    entry: { idParam: "PID", idLabel: "ID", source: "x" },
    conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }] },
    feed: { ranker: "chronological" },
    flow,
  });
}

const FULL = settings([
  { step: "consent", page: "c.md" },
  { step: "account" },
  { step: "feed" },
  { step: "page", page: "debrief.md" },
  { step: "exit" },
]);

describe("currentFlowStep", () => {
  it("follows their position during the study", () => {
    expect(currentFlowStep(FULL, 0, 0)).toMatchObject({ position: 0, step: { step: "consent" } });
    expect(currentFlowStep(FULL, 2, DAY)).toMatchObject({ position: 2, step: { step: "feed" } });
  });

  it("moves anyone at or before the feed past it once the study's time is up", () => {
    expect(currentFlowStep(FULL, 2, 2 * DAY).position).toBe(3);
    expect(currentFlowStep(FULL, 0, 3 * DAY).position).toBe(3);
  });

  it("doesn't move anyone backward", () => {
    expect(currentFlowStep(FULL, 4, 3 * DAY).position).toBe(4);
  });

  it("reports the end of the flow", () => {
    expect(currentFlowStep(FULL, 5, 0)).toEqual({ step: null, position: 5 });
    expect(currentFlowStep(settings([{ step: "feed" }]), 0, 2 * DAY).step).toBeNull();
  });
});

describe("canLeaveFeed", () => {
  it("is never allowed unless the study sets a time", () => {
    expect(canLeaveFeed({ step: "feed" }, 100 * DAY)).toBe(false);
  });

  it("is allowed from the set time onward", () => {
    const step = { step: "feed", finishAfterMinutes: 10 } as const;
    expect(canLeaveFeed(step, 9 * 60_000)).toBe(false);
    expect(canLeaveFeed(step, 10 * 60_000)).toBe(true);
  });

  it("can be allowed right away", () => {
    expect(canLeaveFeed({ step: "feed", finishAfterMinutes: 0 }, 0)).toBe(true);
  });
});
