import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// This follows the site's "Running a study" guide (apps/site/guide/running.md), step by step, with
// the names it uses. If the admin app's wording changes, this fails, and the guide needs the same
// change. Publishing on Prolific and looking at flagged photos need real accounts and real
// uploads, so they aren't followed here.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test("the guide's page on running a study can be followed as written", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `Guide running ${stamp}`;

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  const link = `/join/guide-running-${stamp}`;

  // Launch
  await expect(study.getByText(link)).toBeVisible();
  await expect(study.getByText("works once the study is open")).toBeVisible();
  await study.getByRole("button", { name: "Launch" }).click();
  const launching = page.getByRole("dialog", { name: "Launch version 1" });
  await expect(
    launching.getByText("New participants will get this version, starting now."),
  ).toBeVisible();
  // It warns that the consent page still has the placeholder text.
  await expect(
    launching.getByText("The consent page still has the placeholder text."),
  ).toBeVisible();
  await launching.getByRole("button", { name: "Not yet" }).click();
  await expect(launching).toBeHidden();
  await study.getByRole("button", { name: "Launch" }).click();
  await launching.getByLabel("This is only a test, so launch it anyway").check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();
  await expect(study.getByText("Live", { exact: true })).toBeVisible();
  await expect(study.getByText("Study link:")).toBeVisible();
  await expect(study.getByText("works once the study is open")).toHaveCount(0);

  // Monitor
  await study.getByRole("link", { name: "Monitor and download" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  for (const count of ["Joined", "In progress", "Finished", "Active in the last 15 minutes"]) {
    await expect(page.getByText(count, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "By condition" })).toBeVisible();
  await expect(page.getByText("Test participants aren't counted")).toBeVisible();
  // Nothing has been flagged, so there's no card of photos to look at.
  await expect(page.getByText("Photos to look at")).toHaveCount(0);

  // Recruit on Prolific: connecting an account is the first step.
  await page.getByRole("link", { name: "Recruit on Prolific" }).click();
  await expect(page.getByRole("heading", { name: "Recruit on Prolific" })).toBeVisible();
  await expect(page.getByLabel("Prolific API token")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();

  // Stop
  await page.getByRole("link", { name: "Studies", exact: true }).click();
  await study.getByRole("button", { name: "Stop new participants" }).click();
  await page
    .getByRole("dialog", { name: "Stop new participants" })
    .getByRole("button", { name: "Stop new participants" })
    .click();
  await expect(study.getByText("Not open to new participants")).toBeVisible();

  // Changing a study that's running
  await study.getByRole("button", { name: "Edit a copy of version 1" }).click();
  const post = page.locator("article").first();
  await post.getByRole("button", { name: /Text of this post/ }).click();
  await post.getByLabel("Text of this post").fill(`Changed while running ${stamp}`);
  await post.getByLabel("Text of this post").blur();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  // It isn't live yet: each version has its own Launch.
  const second = study.getByRole("listitem", { name: "Version 2" });
  await expect(second.getByRole("button", { name: "Launch" })).toBeVisible();

  // When it's over
  await study.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
  await page.getByRole("button", { name: /^Archived \(/ }).click();
  await expect(page.getByRole("heading", { name: "Archived studies" })).toBeVisible();
  const archived = page.getByRole("listitem").filter({ hasText: title }).first();
  await archived.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Back to studies" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title }).first()).toBeVisible();
});
