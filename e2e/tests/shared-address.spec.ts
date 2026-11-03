import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { APP_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const SHARED = `http://localhost:${APP_PORT}`;

test("the admin app works at /admin on a community's address, beside a participant", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;

  // Someone taking part opens /admin. They get a sign-in form, and nothing about any study.
  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(`${SHARED}/join/eatsnap?PROLIFIC_PID=SHARED-${stamp}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`shared_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Shared Person");
  await participant.getByRole("button", { name: "Save and continue" }).click();
  await participant.getByRole("button", { name: "Continue" }).click();
  await expect(participant.locator("article").first()).toBeVisible();

  await participant.goto(`${SHARED}/admin/`);
  await expect(participant.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(participant.getByRole("heading", { name: "Studies" })).toHaveCount(0);
  const asked = await participant.request.get(`${SHARED}/api/admin/studies`);
  expect(asked.status()).toBe(401);
  await participantContext.close();

  // A researcher signs in on the same address, and opens a page directly.
  await page.goto(`${SHARED}/admin/`);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`^${SHARED}/admin`));

  await page.goto(`${SHARED}/admin/studies/new`);
  await expect(page.getByRole("button", { name: "Start the study" })).toBeVisible();

  // The same browser can take part too, and signing out of one leaves the other.
  const tab = await page.context().newPage();
  await tab.goto(`${SHARED}/join/eatsnap?PROLIFIC_PID=SHARED-R-${stamp}`);
  await tab.getByRole("button", { name: "I agree" }).click();
  await tab.getByLabel("Username").fill(`sharedr_${stamp}`);
  await tab.getByLabel("Name", { exact: true }).fill("Researcher Too");
  await tab.getByRole("button", { name: "Save and continue" }).click();
  await tab.getByRole("button", { name: "Continue" }).click();
  await expect(tab.locator("article").first()).toBeVisible();

  await page.goto(`${SHARED}/admin/`);
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`^${SHARED}/admin`));

  await tab.reload();
  await expect(tab.locator("article").first()).toBeVisible();
  await tab.close();
});
