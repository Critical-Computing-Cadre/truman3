import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { email, password, editorEmail, editorPassword } = JSON.parse(
  readFileSync(STATE_FILE, "utf8"),
) as { email: string; password: string; editorEmail: string; editorPassword: string };
const ADMIN = `http://localhost:${ADMIN_PORT}`;

async function openDraft(page: Page, who: string, secret: string) {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(who);
  await page.getByLabel("Password").fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Edit a copy of version|Keep editing/ }).click();
  await expect(page.locator("article").first()).toBeVisible();
}

test("two researchers work on the same draft at once", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  await openDraft(first, email, password);
  await openDraft(second, editorEmail, editorPassword);

  // Each can see the other.
  await expect(first.getByTestId("also-here")).toContainText("Second Researcher");
  await expect(second.getByTestId("also-here")).toContainText("A Researcher");

  const firstFeed = first.getByRole("region", { name: /Feed in/ }).first();
  const secondFeed = second.getByRole("region", { name: /Feed in/ }).first();
  const firstPost = firstFeed.locator("article").first();

  // Starting to edit shows up for the other person.
  const original = await firstPost.getByRole("button", { name: /Text of this post/ }).textContent();
  await firstPost.getByRole("button", { name: /Text of this post/ }).click();
  await expect(secondFeed.getByText("A Researcher editing this")).toBeVisible();
  await second.screenshot({ path: testInfo.outputPath("together.png") });

  // What's typed appears for the other person once it's saved, without reloading.
  const typed = `Typed by the first person ${Date.now()}`;
  await firstPost.getByLabel("Text of this post").fill(typed);
  await firstPost.getByLabel("Text of this post").blur();
  await expect(secondFeed.getByText(typed)).toBeVisible();
  await expect(secondFeed.getByText("A Researcher editing this")).toHaveCount(0);

  // Someone in the middle of typing keeps their text when another change arrives.
  const secondPost = secondFeed.locator("article").nth(1);
  await secondPost.getByRole("button", { name: /Text of this post/ }).click();
  await secondPost.getByLabel("Text of this post").fill("Still typing this");
  const thirdPost = firstFeed.locator("article").nth(2);
  const other = `Another change ${Date.now()}`;
  await thirdPost.getByRole("button", { name: /Text of this post/ }).click();
  await thirdPost.getByLabel("Text of this post").fill(other);
  await thirdPost.getByLabel("Text of this post").blur();
  // It arrives with the other person's next check, every 2 seconds, which a busy machine can delay.
  await expect(secondFeed.getByText(other)).toBeVisible({ timeout: 15_000 });
  await expect(secondPost.getByLabel("Text of this post")).toHaveValue("Still typing this");
  await second.keyboard.press("Escape");

  // Undo reverses a change, for both of them.
  await first.getByText(/^Recent changes/).click();
  const change = first
    .getByRole("listitem")
    .filter({ hasText: typed.slice(0, 30) })
    .first();
  await expect(change).toContainText("You");
  await change.getByRole("button", { name: "Undo" }).click();
  await expect(firstFeed.getByText(typed)).toHaveCount(0);
  await expect(secondFeed.getByText(typed)).toHaveCount(0);
  if (original) {
    await expect(secondFeed.getByText(original).first()).toBeVisible();
  }
  await first.screenshot({ path: testInfo.outputPath("undo.png") });

  // When one person leaves, the other sees that.
  await secondContext.close();
  await expect(first.getByTestId("also-here")).toHaveCount(0, { timeout: 20_000 });
  await firstContext.close();
});
