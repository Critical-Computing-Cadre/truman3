import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// The Community page (ADR 99). This lab has no Claude key, so drafting is refused, with the reason;
// the drafting itself is tested with a stand-in model in community.itest.ts.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<
  string,
  string
>;

test("a researcher describes a community to draft", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  await page.goto(`http://localhost:${ADMIN_PORT}`);
  await page.getByLabel("Email").fill(otherLabEmail as string);
  await page.getByLabel("Password").fill(otherLabPassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(`Town ${stamp}`);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await page.getByRole("link", { name: "Community" }).click();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();

  const draft = page.getByRole("button", { name: "Draft the community" });
  await expect(draft).toBeDisabled();
  await page
    .getByLabel("What is this community, and what's it like?")
    .fill("Neighbors in a small town, swapping news and recipes. Mostly friendly.");
  await page.getByLabel(/What people talk about/).fill("the farmers market\nroad work");
  await page.getByLabel("Days before they arrive").fill("1");
  // Everyone in the cast takes part unless they're left out.
  const people = page.getByRole("group", { name: "Who takes part" }).getByRole("checkbox");
  expect(await people.count()).toBeGreaterThan(2);
  await people.first().uncheck();
  await page.screenshot({ path: testInfo.outputPath("community.png"), fullPage: true });
  await draft.click();
  await expect(page.getByRole("alert")).toContainText("no Claude key");
});
