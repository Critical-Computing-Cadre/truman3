import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { APP_PORT } from "../playwright.config.ts";

const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `looks-${project}-${name}.png`) });
  }
};
const app = `http://localhost:${APP_PORT}`;

test("Classic shows stories as tall cards", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await page.goto(`${app}/join/classic-stories-e2e?PROLIFIC_PID=CARDS-${project}-${Date.now()}`);
  const row = page.getByRole("region", { name: "Stories" });
  await expect(row.getByRole("button", { name: "Add to your story" })).toContainText(
    "Create story",
  );
  await expect(row.getByRole("button", { name: "Stories from Ann" })).toBeVisible();
  await shot(page, project, "1-story-cards");
  await row.getByRole("button", { name: "Stories from Bob" }).click();
  await expect(page.getByRole("dialog", { name: "Stories from Bob" })).toContainText("New bike");
});

test("Short posts has a banner on profiles, a Media tab, and Mute thread", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  await page.goto(`${app}/join/short-posts-e2e?PROLIFIC_PID=LOOKS-${project}-${Date.now()}`);
  await expect(page.getByRole("tablist", { name: "Feeds" })).toBeVisible();

  // Muting a thread, from a post's menu.
  const first = page.locator("article").first();
  await first.getByRole("button", { name: "More" }).click();
  await first.getByRole("button", { name: "Mute thread" }).click();
  await expect(first.getByRole("button", { name: "Unmute thread" })).toBeVisible();

  // A profile with a banner, counts in a row, and tabs.
  await page.goto(`${app}/u/ann`);
  await expect(page.getByTestId("profile-banner")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ann" })).toBeVisible();
  await expect(page.getByTestId("follow-counts")).toContainText("followers");
  const tabs = page.getByRole("tablist", { name: "Profile" });
  await expect(tabs.getByRole("tab", { name: "Posts" })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: "Media" }).click();
  await expect(tabs.getByRole("tab", { name: "Media" })).toHaveAttribute("aria-selected", "true");
  await shot(page, project, "2-short-profile");
});
