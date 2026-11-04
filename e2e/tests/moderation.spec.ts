import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { APP_PORT } from "../playwright.config.ts";

const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `moderation-${project}-${name}.png`) });
  }
};

test("a moderator's removals show in place of what was removed", async ({ page }, testInfo) => {
  const id = `MOD-${testInfo.project.name}-${Date.now()}`;
  await page.goto(`http://localhost:${APP_PORT}/join/moderation-e2e?PROLIFIC_PID=${id}`);

  // Someone else's post: the note is there, and what it said isn't, even in the page's text.
  await expect(page.getByRole("article", { name: "A post that stays" })).toBeVisible();
  const note = page.getByTestId("removed-note").first();
  await expect(note).toContainText("Removed by Sam the Mod.");
  await expect(note).toContainText("Reason: Rule 2: be kind");
  await expect(note).not.toContainText("Nobody else");
  await expect(page.getByText("A post that breaks a rule")).toHaveCount(0);
  await expect(page.getByText("Words nobody should read")).toHaveCount(0);
  await shot(page, testInfo.project.name, "1-list");

  // A comment, on its post's own page. The thread stays, and only that comment goes.
  await page
    .getByRole("article", { name: "A post that stays" })
    .getByRole("link", { name: "A post that stays" })
    .click();
  await expect(page.getByText("A comment that stays")).toBeVisible();
  await expect(page.getByText("A comment nobody should read")).toHaveCount(0);
  await expect(page.getByTestId("removed-note")).toContainText("Removed by Sam the Mod.");
  await shot(page, testInfo.project.name, "2-comment");
  await page.goBack();

  // Their own post: they keep what they wrote, and are told about it.
  await page.getByRole("button", { name: /Create a post/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("My own post");
  await dialog.getByLabel("Write a post").fill("Something I wrote");
  await dialog.getByLabel("Community").selectOption({ label: "Cooking" });
  await dialog.getByRole("button", { name: "Post", exact: true }).click();

  const own = page.getByRole("article", { name: "My own post" });
  await expect(own.getByText("Something I wrote")).toBeVisible();
  const ownNote = own.getByTestId("removed-note");
  await expect(ownNote).toContainText("Nobody else can see this now.");
  await expect(ownNote).toContainText("Reason: Rule 3: no spam");
  await expect(own.getByRole("button", { name: "Vote up" })).toBeDisabled();
  await shot(page, testInfo.project.name, "3-own");

  // The notification says the same, and the bell has it.
  await page
    .getByRole("link", { name: /notifications/i })
    .first()
    .click();
  await expect(page.getByText("Sam the Mod removed your post")).toBeVisible();
  await expect(page.getByText("Reason: Rule 3: no spam")).toBeVisible();
  await shot(page, testInfo.project.name, "4-notification");
});
