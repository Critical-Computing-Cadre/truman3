import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// This follows the site's "Your first study" guide (apps/site/guide/first-study.md), step by step,
// with the names it uses. If the admin app's wording changes, this fails, and the guide needs the
// same change.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test("the guide's first study can be followed as written", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `Guide study ${stamp}`;

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  // 1. Start the study
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await expect(page.getByLabel("Link name")).toHaveValue(`guide-study-${stamp}`);
  await expect(page.getByText("What kind of platform is it?")).toBeVisible();
  await page.getByText("Help me decide").click();
  await expect(page.getByText("Where do you want to start?")).toBeVisible();
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await expect(page.getByText("How are people assigned to conditions?")).toBeVisible();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await expect(page.getByText("Draft from a brief")).toBeVisible();
  await page.getByRole("button", { name: "Start the study" }).click();

  // 2. Change something
  const post = page.locator("article").first();
  await post.getByRole("button", { name: /Text of this post/ }).click();
  await post.getByLabel("Text of this post").fill(`Changed by the guide ${stamp}`);
  await post.getByLabel("Text of this post").blur();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await post.getByText("Details").first().click();
  await page.getByRole("link", { name: "Cast", exact: true }).click();
  await page.getByRole("button", { name: "Add a person" }).click();
  await page.getByRole("link", { name: "Back to the feed" }).click();
  await expect(page.getByRole("button", { name: "New post here" }).first()).toBeVisible();
  await page.getByText(/^Recent changes/).click();
  await expect(page.getByRole("button", { name: "Undo" }).first()).toBeVisible();

  // 3. Write the consent page
  await page.getByRole("link", { name: "Settings" }).click();
  const flow = page.getByRole("region", { name: "Study flow" });
  await expect(flow.getByText("Consent").first()).toBeVisible();
  await flow.getByLabel("Page text").first().fill("You're taking part in a study about a new app.");
  await flow.getByRole("button", { name: "Save changes" }).first().click();
  await expect(flow.getByRole("button", { name: "Save changes" }).first()).toBeDisabled();

  // 4. Save a version
  await page.getByRole("link", { name: "Back to the feed" }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();

  // 5. Go through it yourself
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await expect(study.getByText("Version 1").first()).toBeVisible();
  // The link shows before launch, to copy into a recruitment site.
  await expect(study.getByText("works once the study is open")).toBeVisible();
  await study.getByRole("button", { name: "Try as a participant" }).click();
  const [participant] = await Promise.all([
    page.waitForEvent("popup"),
    study.getByRole("link", { name: "Open as a test participant" }).click(),
  ]);
  await expect(
    participant.getByText("You're taking part in a study about a new app."),
  ).toBeVisible();

  // What to do next
  await expect(study.getByRole("button", { name: "Edit a copy of version 1" })).toBeVisible();
});
