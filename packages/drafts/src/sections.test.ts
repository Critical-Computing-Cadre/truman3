import { describe, expect, it } from "vitest";
import { applySections } from "./sections.ts";

const base = {
  schemaVersion: 1,
  slug: "s",
  title: "S",
  site: { name: "S" },
  length: { days: 1 },
  entry: { idParam: "PID", idLabel: "ID", source: "test" },
  conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }] },
  flow: [{ step: "feed" }],
};
const conditions = base.conditions;

describe("applySections", () => {
  it("takes a section's settings from its latest save, including what it leaves out", () => {
    const shared = applySections(base, {}, [
      {
        revision: 1,
        data: { section: "conditions", value: { conditions, worlds: { size: 4, waitMinutes: 5 } } },
      },
    ]);
    expect(shared.settings.worlds).toEqual({ size: 4, waitMinutes: 5 });

    // Turning shared worlds off leaves the key out, and that removes it.
    const solo = applySections({ ...base, worlds: { size: 4, waitMinutes: 5 } }, {}, [
      { revision: 2, data: { section: "conditions", value: { conditions } } },
    ]);
    expect(solo.settings.worlds).toBeUndefined();
    expect(solo.settings.title).toBe("S");
  });
});
