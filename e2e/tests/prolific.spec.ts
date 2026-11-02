import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT, PROLIFIC_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test("a researcher connects Prolific, creates a draft, and approves and pays people", async ({
  page,
}, testInfo) => {
  // One fake Prolific study is shared by this run, so this only runs once.
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill("Prolific study");
  await page.getByRole("radio", { name: /Start from nothing|nothing/i }).check();
  await page.getByRole("radio", { name: /^Blocked/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();

  const card = page.locator("li, section, article").filter({ hasText: "Prolific study" }).last();
  await card.getByRole("link", { name: "Monitor and download" }).click();
  await page.getByRole("link", { name: "Recruit on Prolific" }).click();

  // Each person connects their own account. A bad token gets refused.
  await page.getByLabel("Prolific API token").fill("not-a-real-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("didn't accept your token");
  await page.getByLabel("Prolific API token").fill("e2e-prolific-token");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected as Pat Researcher")).toBeVisible();

  await page.getByLabel("Prolific project").selectOption({ label: "The Lab: Project One" });
  await page.getByLabel("Description participants see").fill("A short study.");
  await page.getByLabel("Estimated minutes").fill("15");
  await page.getByLabel("Pay per person").fill("3.50");
  await page.getByLabel("Number of people").fill("2");
  await page.getByLabel("Posts seen").fill("1");
  await page.getByRole("button", { name: "Create the draft on Prolific" }).click();

  await expect(page.getByText(/Status: UNPUBLISHED/)).toBeVisible();
  await expect(page.getByText("Truman never publishes for you")).toBeVisible();
  await expect(page.getByText("Nobody has started on Prolific yet.")).toBeVisible();

  // A submission from someone who isn't in this study, such as someone who withdrew.
  await page.request.post(`http://localhost:${PROLIFIC_PORT}/test/submissions`, {
    data: { prolificId: "someone-who-withdrew" },
  });
  await page.reload();
  await expect(page.getByText(/Nobody here has this ID/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("prolific.png"), fullPage: true });

  // They didn't pass, so selecting everyone who passes won't include them.
  await expect(page.getByRole("button", { name: "Select everyone who passes" })).toBeDisabled();
  await page.getByLabel("Select someone-who-withdrew").check();

  // A bonus shows what it costs first, and nothing's paid until it's confirmed.
  await page.getByLabel("Bonus for each selected person").fill("1.50");
  await page.getByRole("button", { name: "See what it costs" }).click();
  const bonus = page.getByRole("dialog", { name: "Confirm bonus" });
  await expect(bonus.getByText("1.60")).toBeVisible();
  await bonus.getByRole("button", { name: "Pay bonus" }).click();
  await expect(page.getByText("Prolific accepted the bonus")).toBeVisible();

  // Approving warns that this person didn't pass.
  await page.getByLabel("Select someone-who-withdrew").check();
  await page.getByRole("button", { name: "Approve 1 selected" }).click();
  const approve = page.getByRole("dialog", { name: "Confirm approval" });
  await expect(approve.getByText("1 of them didn't pass your rules")).toBeVisible();
  await approve.getByRole("button", { name: "Approve and pay" }).click();
  await expect(page.getByText(/Prolific accepted the approval of 1/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "APPROVED" })).toBeVisible();

  await page.getByText("What's been done from here").click();
  await expect(page.getByText(/approved, 1 person/)).toBeVisible();
  await expect(page.getByText(/paid bonus, 1 person, 1.60 total/)).toBeVisible();
});
