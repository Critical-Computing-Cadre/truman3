import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// This follows two pages of the site's guide, step by step, with the names they use: "Making
// things happen" (apps/site/guide/beats.md) and "Testing a study" (apps/site/guide/testing.md).
// It pastes the guide's own first beat, so that example is tried in the real app. If the admin
// app's wording changes, this fails, and the guide needs the same change.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;
const GUIDE = path.resolve(import.meta.dirname, "../../apps/site/guide");

/** The first YAML example on a guide page that has this in it. */
function example(page: string, having: string) {
  const text = readFileSync(path.join(GUIDE, page), "utf8");
  const found = [...text.matchAll(/^( *)```yaml\n([\s\S]*?)\n *```/gm)]
    .map(([, indent, body]) =>
      (body as string)
        .split("\n")
        .map((line) => line.slice((indent as string).length))
        .join("\n"),
    )
    .find((block) => block.includes(having));
  if (!found) {
    throw new Error(`${page} has no example with "${having}" in it.`);
  }
  return found;
}

// A test for the guide's first beat, in the shape the guide's own scenario has. The guide's
// scenario is about the bystander example, which this study isn't.
const SCENARIO = `scenarios:
  - name: Someone welcomes their first post
    condition: control
    steps:
      - at: "0:01"
        post: "Hello, I'm new here"
      - at: "0:10"
        expect:
          happened: [welcome]
          sees: ["Welcome! Glad you're here."]
`;

test("the guide's pages on beats and on testing can be followed as written", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  test.setTimeout(180_000);
  const stamp = Date.now() % 1_000_000;
  const title = `Guide beats ${stamp}`;

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await expect(page.getByRole("button", { name: "Save as new version" })).toBeVisible();

  // Making things happen: where beats are written
  await page.getByRole("link", { name: "Beats", exact: true }).click();
  await expect(page.getByText("How beats work")).toBeVisible();
  const beats = page.getByRole("textbox", { name: "Beats" });
  await beats.fill(example("beats.md", "id: welcome"));
  await page.getByRole("button", { name: "Save beats" }).click();
  await expect(page.getByText("No problems found.")).toBeVisible();
  // Or it names the beat and what's wrong with it, such as a person who isn't in the cast.
  await beats.fill(
    example("beats.md", "id: welcome").replace("actor: grace_o", "actor: nobody_here"),
  );
  await page.getByRole("button", { name: "Save beats" }).click();
  await expect(
    page.getByText(
      'The beat "welcome" is done by "nobody_here", who isn\'t in the list of actors.',
    ),
  ).toBeVisible();
  await beats.fill(example("beats.md", "id: welcome"));
  await page.getByRole("button", { name: "Save beats" }).click();
  await expect(page.getByText("No problems found.")).toBeVisible();

  // Testing a study: preview, at any time
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await expect(page.getByLabel("Condition", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Compare with")).toBeVisible();
  await expect(page.getByLabel("Time in the study")).toBeVisible();
  await expect(page.getByText("Bars show new posts over time.")).toBeVisible();
  // The posts are on a timeline under the controls, which can be hidden and shown again.
  await page.getByRole("button", { name: "Hide posts on the timeline" }).click();
  await page.getByRole("button", { name: "Show posts on the timeline" }).click();
  await expect(page.getByText("Red can never appear.")).toBeVisible();

  // Scenario tests
  await page.getByRole("link", { name: "Tests", exact: true }).click();
  await expect(page.getByText("How scenarios work")).toBeVisible();
  await page.getByRole("textbox", { name: "Scenarios" }).fill(SCENARIO);
  await page.getByRole("button", { name: "Save scenarios" }).click();
  await expect(page.getByText("No problems found.")).toBeVisible();

  // Personas
  await page.getByRole("link", { name: "Personas", exact: true }).click();
  await expect(page.getByText("How personas work")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Personas" })
    // The guide's persona is in the bystander example's "silent" condition.
    .fill(example("testing.md", "personas:").replace("condition: silent", "condition: control"));
  await page.getByRole("button", { name: "Save personas" }).click();
  await expect(page.getByText("No problems found.")).toBeVisible();

  // Save a version. The tests run by themselves.
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  // The result is beside the version.
  await expect(study.getByText("The test passed")).toBeVisible({ timeout: 90_000 });
  await expect(study.getByRole("button", { name: "Run tests again" })).toBeVisible();

  // Try as a participant: pick a condition in the dropdown, and press the button.
  await expect(study.getByLabel("Condition to try in version 1")).toBeVisible();
  await expect(study.getByRole("button", { name: "Try as a participant" })).toBeVisible();

  // Simulated participants
  await study.getByRole("link", { name: "Simulate" }).click();
  await expect(page.getByRole("radio", { name: "At random" })).toBeChecked();
  await page.getByLabel("How many participants").fill("5");
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  // The report starts with what's worth a look, or says nothing stood out.
  await expect(page.getByText(/Worth a look:|Nothing stood out\./)).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByTestId("simulated-beats")).toContainText("welcome");
  await expect(page.getByRole("button", { name: "Repeat the last run" })).toBeVisible();

  // Personas, played by a model. This Truman has no Claude key, so it says so and goes no further.
  await page.getByRole("radio", { name: "Personas" }).check();
  await expect(
    page.getByText(/How many of each|Personas can't be played until then/).first(),
  ).toBeVisible();
});
