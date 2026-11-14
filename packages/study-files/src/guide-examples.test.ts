import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadStudyFolder } from "./load.ts";

// The guide teaches by example, and people copy its examples into their own studies. So each one
// is checked here the way a study is checked: put into the study it says it comes from, and read.
// An example that's wrong fails here, before anyone pastes it.

const ROOT = path.resolve(import.meta.dirname, "../../..");
const GUIDE = path.join(ROOT, "apps/site/guide");
const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** The YAML examples on a guide page, in order. */
function examples(page: string) {
  const text = readFileSync(path.join(GUIDE, page), "utf8");
  // Some sit inside a numbered step, so they're indented.
  return [...text.matchAll(/^( *)```yaml\n([\s\S]*?)\n *```/gm)].map(([, indent, body]) =>
    (body as string)
      .split("\n")
      .map((line) => line.slice((indent as string).length))
      .join("\n"),
  );
}

/** What's wrong with a study, once one of its files is replaced by an example. */
function problemsWith(
  study: string,
  file: string,
  example: string,
  change?: (dir: string) => void,
) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-guide-"));
  folders.push(dir);
  cpSync(path.join(ROOT, "studies", study), dir, { recursive: true });
  writeFileSync(path.join(dir, file), `${example}\n`);
  change?.(dir);
  return loadStudyFolder(dir)
    .issues.filter(({ severity }) => severity === "error")
    .map(({ file: where, message }) => `${where ?? ""}: ${message}`);
}

describe("the guide's examples work as written", () => {
  it("Making things happen: a first beat, in the Classic sample", () => {
    const [first] = examples("beats.md");
    expect(first).toContain("id: welcome");
    expect(problemsWith("starters/classic", "beats.yaml", first as string)).toEqual([]);
  });

  it("Making things happen: the scene, in the bystander example it's cut down from", () => {
    const [, scene] = examples("beats.md");
    expect(scene).toContain("id: sam-defends");
    // The example's own tests and personas are about beats the cut-down scene leaves out.
    const withoutItsTests = (dir: string) => {
      rmSync(path.join(dir, "scenarios.yaml"));
      rmSync(path.join(dir, "personas.yaml"));
    };
    expect(
      problemsWith("examples/bystander", "beats.yaml", scene as string, withoutItsTests),
    ).toEqual([]);
  });

  it("Making things happen: a wrong name is caught, as the page says it is", () => {
    const [first] = examples("beats.md");
    const wrong = (first as string).replace("actor: grace_o", "actor: nobody_here");
    expect(problemsWith("starters/classic", "beats.yaml", wrong).join("\n")).toContain("welcome");
  });

  it("Testing a study: the scenario, in the bystander example", () => {
    const [scenario] = examples("testing.md");
    expect(scenario).toContain("scenarios:");
    expect(problemsWith("examples/bystander", "scenarios.yaml", scenario as string)).toEqual([]);
  });

  it("Testing a study: the persona, in the bystander example", () => {
    const [, persona] = examples("testing.md");
    expect(persona).toContain("personas:");
    expect(problemsWith("examples/bystander", "personas.yaml", persona as string)).toEqual([]);
  });
});
