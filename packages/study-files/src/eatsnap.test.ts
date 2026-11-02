import path from "node:path";
import { hasErrors } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { loadStudyFolder } from "./load.ts";

const EATSNAP = path.resolve(import.meta.dirname, "../../../studies/examples/eatsnap");

describe("the eatsnap reference study", () => {
  const { definition, issues } = loadStudyFolder(EATSNAP);

  it("has no errors", () => {
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
  });

  it("has everything from truman_2023", () => {
    expect(definition?.actors).toHaveLength(76);
    expect(definition?.posts).toHaveLength(284);
    expect(definition?.comments).toHaveLength(342);
    expect(definition?.reactions).toHaveLength(174);
  });

  it("keeps the condition targeting on comments", () => {
    const targeted = definition?.comments.filter((comment) => comment.conditions.length > 0);
    const counts = Object.groupBy(targeted ?? [], (comment) => comment.conditions[0] ?? "");

    expect(targeted).toHaveLength(25);
    expect(counts.marginal).toHaveLength(16);
    expect(counts.troll).toHaveLength(3);
  });

  it("merges both old notification files into reactions", () => {
    const byType = Object.groupBy(definition?.reactions ?? [], (reaction) => reaction.type);

    expect(byType.read).toHaveLength(122);
    expect(byType.like).toHaveLength(46);
    expect(byType.reply).toHaveLength(6);
  });

  it("warns about the 70 posts that can never appear under its settings", () => {
    const warnings = issues.filter((issue) => issue.severity === "warning");
    const afterEnd = warnings.filter((issue) => issue.message.includes("after the study ends"));
    const beforeWindow = warnings.filter((issue) => issue.message.includes("outside the feed"));

    expect(afterEnd).toHaveLength(58);
    expect(beforeWindow).toHaveLength(12);
    expect(warnings).toHaveLength(70);
  });
});
