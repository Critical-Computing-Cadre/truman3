import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// This follows the site's "Conditions" guide (apps/site/guide/conditions.md), step by step, with
// the names it uses. If the admin app's wording changes, this fails, and the guide needs the same
// change.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test("the guide's page on conditions can be followed as written", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `Guide conditions ${stamp}`;

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

  // Add conditions
  await page.getByRole("link", { name: "Settings" }).click();
  const card = page.getByRole("region", { name: "Conditions" });
  await card.getByRole("button", { name: "Add a condition" }).click();
  await card.getByRole("textbox", { name: "Name" }).last().fill("defended");
  await expect(card.getByLabel("Weight").last()).toHaveValue("1");
  // Weights of 1 and 1: half of people go to each, and the card shows the percentage.
  await expect(card.getByText("50% of people")).toHaveCount(2);
  await card.getByLabel("Weight").last().fill("2");
  await expect(card.getByText("67% of people")).toBeVisible();
  await card.getByLabel("Weight").last().fill("1");
  await expect(card.getByLabel("Factors").last()).toBeVisible();

  // How people are assigned
  await expect(card.getByText("How are people assigned to conditions?")).toBeVisible();
  await expect(
    card.getByText("Each person is assigned at random, so counts can drift apart."),
  ).toBeVisible();
  await card.getByRole("radio", { name: /^Blocked/ }).check();
  await expect(card.getByLabel("Block size")).toHaveValue("2");

  // What can differ: settings
  const differs = card.locator("details").last();
  await expect(differs.getByText("Settings that differ in this condition")).toBeVisible();
  await differs.locator("summary").click();
  for (const name of ["Platform", "Comment boxes", "Feed order", "Comment order"]) {
    await expect(differs.getByRole("combobox", { name, exact: true })).toBeVisible();
  }
  await differs.getByLabel("Comment boxes").selectOption({ index: 1 });
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByRole("button", { name: "Save changes" })).toBeDisabled();
  // The summary line counts how many settings differ.
  await expect(card.getByText("Settings that differ in this condition (1)")).toBeVisible();

  // What can differ: posts and comments
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  const post = page.locator("article").first();
  await post.getByText("Details").first().click();
  const shownIn = post.getByRole("group", { name: "Shown in" }).first();
  await expect(shownIn.getByText("(none ticked means all)")).toBeVisible();
  const text = (await post.locator("p").first().textContent()) ?? "";
  await shownIn.getByLabel("defended").check();
  // It leaves the feed being looked at, which is control's. It's in defended's, marked.
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await page.getByLabel("Condition", { exact: true }).selectOption("defended");
  const limited = page.locator("article").filter({ hasText: text }).first();
  await expect(limited.getByText("Only in defended").first()).toBeVisible();

  // What can differ: the cast's pictures
  await page.getByRole("link", { name: "Cast", exact: true }).click();
  await expect(page.getByText("Pictures by condition").first()).toBeVisible();

  // Compare two conditions
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await page.getByLabel("Condition", { exact: true }).selectOption("control");
  await page.getByLabel("Compare with").selectOption("defended");
  await expect(page.getByRole("region", { name: "Feed in control" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Feed in defended" })).toBeVisible();
  // Move the time slider and both move together.
  await expect(page.getByLabel("Time in the study")).toHaveCount(1);

  // The same controls are on the read-only preview of a saved version.
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("link", { name: "See the feed" }).click();
  await expect(page.getByLabel("Condition", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Compare with")).toBeVisible();
});
