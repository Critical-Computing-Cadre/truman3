import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// Recruiting beyond Prolific (ADR 98): the Recruit page shows what to paste where, checks what the
// study does now, and makes the changes in a draft.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<
  string,
  string
>;

test("a researcher sets a study up for CloudResearch, then SONA", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `Connect ${stamp}`;
  await page.goto(`http://localhost:${ADMIN_PORT}`);
  await page.getByLabel("Email").fill(otherLabEmail as string);
  await page.getByLabel("Password").fill(otherLabPassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("link", { name: "Recruit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recruit participants" })).toBeVisible();

  // CloudResearch: the link to paste into Connect, and what has to change.
  await page.getByRole("radio", { name: /CloudResearch Connect/ }).check();
  const setup = page.getByRole("region", { name: "Setting it up" });
  await expect(setup.getByText(/\/join\/connect-\d+$/)).toBeVisible();
  await setup
    .getByLabel(/Paste the completion redirect/)
    .fill("https://connect.cloudresearch.com/participant/project/ABC123/complete");
  await expect(setup.getByText(/It should read participantId/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cloudresearch.png"), fullPage: true });
  await setup.getByRole("button", { name: "Make these changes in a draft" }).click();

  // The draft's Settings page has them, ready to save as a new version.
  await expect(page.getByRole("heading", { name: /Settings for/ })).toBeVisible();
  await expect(page.getByLabel("The link's name for their recruitment ID")).toHaveValue(
    "participantId",
  );
  await expect(page.getByLabel("What to call it, if someone has to type it")).toHaveValue(
    "CloudResearch ID",
  );
  await expect(page.getByLabel("Where to send them at the end")).toHaveValue(
    "https://connect.cloudresearch.com/participant/project/ABC123/complete",
  );
  await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true });

  // SONA, on the same draft's version: the code goes where SONA's credit link says XXXX.
  await page.goto(`http://localhost:${ADMIN_PORT}/admin/`);
  await page
    .getByRole("listitem")
    .filter({ hasText: title })
    .first()
    .getByRole("link", { name: "Recruit", exact: true })
    .click();
  await page.getByRole("radio", { name: /SONA/ }).check();
  await expect(setup.getByText(/\/join\/connect-\d+\?id=%SURVEY_CODE%$/)).toBeVisible();
  await setup
    .getByLabel(/client-side completion URL/)
    .fill(
      "https://yourschool.sona-systems.com/webstudy_credit.aspx?experiment_id=1&credit_token=abc&survey_code=XXXX",
    );
  await setup.getByRole("button", { name: "Make these changes in a draft" }).click();
  await expect(page.getByLabel("The link's name for their recruitment ID")).toHaveValue("id");
  await expect(page.getByLabel("Where to send them at the end")).toHaveValue(
    "https://yourschool.sona-systems.com/webstudy_credit.aspx?experiment_id=1&credit_token=abc&survey_code={externalId}",
  );
});
