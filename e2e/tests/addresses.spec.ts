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

test("a researcher chooses the domain a study's participants go to (ADR 74)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Changes a shared study, so runs once.");
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  const picker = page.getByLabel("Participants go to").first();
  await picker.selectOption("eatsnap.test");
  await expect(page.getByText(/https:\/\/eatsnap\.test\/join\//).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("address.png"), fullPage: true });

  // Back to the usual address, for the tests that use this study.
  await picker.selectOption("");
  await expect(page.getByText(/https:\/\/eatsnap\.test\/join\//)).toHaveCount(0);
});
