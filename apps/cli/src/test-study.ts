import { runScenarios } from "@truman3/api/scenarios";
import { findings, MAX_SIMULATED, type SimulationReport, simulate } from "@truman3/api/simulate";
import { hasErrors, type StudyIssue } from "@truman3/core";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { loadStudyFolder } from "@truman3/study-files";
import { importStudyFolder } from "@truman3/study-import";

/**
 * Runs a study folder's scenarios.yaml in a database made for the run and dropped after it, so
 * nothing real is touched. Improvised lines use their rehearsed or fallback lines, so it costs
 * nothing. See docs/guides/testing-studies.md.
 */
export async function testStudy(
  folder: string,
  printIssues: (issues: StudyIssue[]) => void,
): Promise<number> {
  const { definition, issues } = loadStudyFolder(folder);
  if (!definition || hasErrors(issues)) {
    printIssues(issues);
    return 1;
  }
  if (definition.scenarios.length === 0) {
    console.error(`There are no scenarios to run. Add a scenarios.yaml to ${folder}.`);
    return 1;
  }

  const database = await createTestDatabase();
  const storage = createStorage(storageConfigFromEnv());
  try {
    await storage.ensureBucket();
    const imported = await importStudyFolder(database.db, storage, folder);
    if (imported.status === "failed") {
      printIssues(imported.issues);
      return 1;
    }
    const results = await runScenarios({
      db: database.db,
      storage,
      versionId: imported.studyVersionId,
      scenarios: definition.scenarios,
    });
    for (const result of results) {
      console.log(`${result.passed ? "✓" : "✗"} ${result.name}`);
      for (const problem of result.problems) {
        console.log(`    ${problem}`);
      }
    }
    const failed = results.filter(({ passed }) => !passed).length;
    console.log(
      failed === 0
        ? `\nAll ${results.length} scenarios passed.`
        : `\n${failed} of ${results.length} scenarios failed.`,
    );
    if (definition.christof?.live.enabled) {
      console.log("Improvised lines used their rehearsed or fallback lines, not a model.");
    }
    return failed === 0 ? 0 : 1;
  } finally {
    storage.close();
    await database.destroy();
  }
}

/**
 * Sends simulated participants through a study folder, in a database made for the run and dropped
 * after it, and prints what happened to them. They behave at random, so it costs nothing. See
 * docs/guides/testing-studies.md.
 */
export async function simulateStudy(
  folder: string,
  options: string[],
  printIssues: (issues: StudyIssue[]) => void,
): Promise<number> {
  const participants = Number(options.find((option) => /^\d+$/.test(option)) ?? 50);
  const seedAt = options.indexOf("--seed");
  const seed = seedAt === -1 ? Math.floor(Math.random() * 1_000_000) : Number(options[seedAt + 1]);
  if (participants < 1 || participants > MAX_SIMULATED || !Number.isInteger(seed) || seed < 0) {
    console.error(`Simulate 1 to ${MAX_SIMULATED} participants, with a whole-number seed.`);
    return 1;
  }
  const { definition, issues } = loadStudyFolder(folder);
  if (!definition || hasErrors(issues)) {
    printIssues(issues);
    return 1;
  }

  const database = await createTestDatabase();
  const storage = createStorage(storageConfigFromEnv());
  try {
    await storage.ensureBucket();
    const imported = await importStudyFolder(database.db, storage, folder);
    if (imported.status === "failed") {
      printIssues(imported.issues);
      return 1;
    }
    console.log(`Sending ${participants} simulated participants through, with seed ${seed}…`);
    const report = await simulate({
      db: database.db,
      storage,
      versionId: imported.studyVersionId,
      settings: { participants, seed },
    });
    for (const line of describeReport(report)) {
      console.log(line);
    }
    const notes = findings(report);
    console.log(notes.length === 0 ? "\nNothing stood out." : "\nWorth a look:");
    for (const note of notes) {
      console.log(`  - ${note}`);
    }
    console.log(
      `\nTo repeat this run exactly: pnpm study simulate ${folder} ${participants} --seed ${seed}`,
    );
    return 0;
  } finally {
    storage.close();
    await database.destroy();
  }
}

/** A report as lines of text: who started where, what they did, and what happened. */
export function describeReport(report: SimulationReport): string[] {
  const conditions = Object.entries(report.conditions);
  const lines = [
    "",
    `Participants: ${conditions.map(([key, count]) => `${count} in "${key}"`).join(", ")}`,
    `They did: ${
      Object.entries(report.actions)
        .map(
          ([action, { done, refused }]) =>
            `${done} ${action}${refused ? ` (${refused} refused)` : ""}`,
        )
        .join(", ") || "nothing"
    }`,
    "",
    "Beats, and how many in each condition they happened for:",
  ];
  for (const beat of report.beats) {
    const shown = conditions
      .filter(([key]) => beat.conditions.length === 0 || beat.conditions.includes(key))
      .map(([key, count]) => `${key} ${beat.happenedFor[key] ?? 0}/${count}`);
    const extra = [
      beat.mostForOne > 1 ? `up to ${beat.mostForOne} times for one` : "",
      ...Object.entries(beat.skipped).map(([reason, count]) => `skipped ${count}: ${reason}`),
      beat.stillDue > 0 ? `${beat.stillDue} still due when they finished` : "",
    ].filter(Boolean);
    lines.push(`  ${beat.id}: ${shown.join(", ")}${extra.length ? ` (${extra.join("; ")})` : ""}`);
  }
  if (report.decisions.length > 0) {
    lines.push("", "Decision points, and where they sent people:");
    for (const decision of report.decisions) {
      const to = Object.entries(decision.to).map(([key, count]) => `${count} to "${key}"`);
      lines.push(
        `  ${decision.id}: ${decision.reached} decided${to.length ? `, ${to.join(", ")}` : ""}`,
      );
    }
  }
  return lines;
}
