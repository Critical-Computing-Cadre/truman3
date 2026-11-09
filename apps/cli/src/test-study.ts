import { runScenarios } from "@truman3/api/scenarios";
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
