import { parseBeats } from "@truman3/study-files";
import { describe, expect, it } from "vitest";
import { withPersonaCard } from "./persona-cards.ts";

describe("a persona card in beats.yaml", () => {
  const text = `# Our beats

cast:
  ann: # the baker
    voice: Short and warm.
beats: []
`;

  it("is set for one person, leaving the rest of the file, comments included", () => {
    const saved = withPersonaCard(text, "bo", {
      about: " Rides bikes. ",
      voice: "",
      relationships: { ann: "An old friend", participant: " " },
      redLines: ["Never gives medical advice"],
    });
    expect(saved).toContain("# Our beats");
    expect(saved).toContain("# the baker");
    const read = parseBeats(saved);
    expect(read.issues).toEqual([]);
    expect(read.cast.ann).toMatchObject({ voice: "Short and warm." });
    // Empty fields aren't written.
    expect(read.cast.bo).toEqual({
      about: "Rides bikes.",
      relationships: { ann: "An old friend" },
      redLines: ["Never gives medical advice"],
    });
  });

  it("is taken away when it's emptied, and starts a file that has none", () => {
    const none = withPersonaCard(text, "ann", { redLines: [] });
    expect(none).not.toContain("cast:");
    expect(none).toContain("# Our beats");
    expect(
      parseBeats(withPersonaCard("", "ann", { goals: "To sell bread", redLines: [] })).cast,
    ).toEqual({
      ann: { goals: "To sell bread", redLines: [] },
    });
  });
});
