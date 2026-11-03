import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test("a researcher turns features off, and the feed they're editing changes to match", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(`Features ${Date.now() % 1_000_000}`);
  await page.getByRole("radio", { name: /EatSnap pack/ }).check();
  await page.getByRole("radio", { name: /Just the background/ }).check();
  await page.getByRole("radio", { name: /^Blocked/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();

  // Everything's there to begin with, like the Classic template.
  const post = page.locator("article").first();
  await expect(post.getByRole("button", { name: /Like/ }).first()).toBeVisible();
  await expect(post.getByRole("button", { name: "Flag" }).first()).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Study and platform" });
  await settings.getByRole("checkbox", { name: /^Likes/ }).uncheck();
  await settings.getByRole("checkbox", { name: /^Flagging/ }).uncheck();
  await settings.getByRole("button", { name: "Save changes" }).click();
  await expect(settings.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("features.png"), fullPage: true });

  await page.goBack();
  await expect(post).toBeVisible();
  await expect(post.getByRole("button", { name: "Reply" })).toBeVisible();
  await expect(post.getByRole("button", { name: /Like/ })).toHaveCount(0);
  await expect(post.getByRole("button", { name: "Flag" })).toHaveCount(0);
});
