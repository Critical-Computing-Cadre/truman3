import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

async function signIn(page: Page) {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
}

async function startStudy(page: Page, title: string, chooseStart: () => Promise<void>) {
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await chooseStart();
  // There's no default for how people are assigned.
  await expect(page.getByRole("button", { name: "Start the study" })).toBeDisabled();
  await page.getByRole("radio", { name: /^Blocked/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await expect(page.getByRole("button", { name: "Save as new version" })).toBeVisible();
}

async function saveAndLaunch(page: Page) {
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
}

test("someone builds a study from nothing, with no terminal, and a participant joins it", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `From nothing ${stamp}`;
  const slug = `from-nothing-${stamp}`;

  await signIn(page);
  await startStudy(page, title, async () => {
    await expect(page.getByLabel("Link name")).toHaveValue(slug);
    await page.getByRole("radio", { name: /Start with nothing/ }).check();
  });

  // There's nobody to write a post yet, so it says so.
  await page.getByRole("link", { name: "Add someone to the cast first" }).click();
  await expect(page.getByText("Nobody yet")).toBeVisible();

  await page.getByRole("button", { name: "Add a person" }).click();
  const person = page.getByRole("listitem", { name: "New person" });
  await person.getByLabel("Name", { exact: true }).fill("Casey Jones");
  await person.getByLabel("Name", { exact: true }).blur();
  const casey = page.getByRole("listitem", { name: "Casey Jones" });
  await casey.getByLabel("Username").fill("casey");
  await casey.getByLabel("Bio").click();
  await expect(casey.getByLabel("Username")).toHaveValue("casey");
  await casey.getByLabel("Bio").fill("Likes the outdoors");
  await casey.getByLabel("Location").click();
  await expect(casey.getByLabel("Bio")).toHaveValue("Likes the outdoors");

  // A username has to be unique, and it says so instead of breaking at the end.
  await page.getByRole("button", { name: "Add a person" }).click();
  const second = page.getByRole("listitem", { name: "New person" });
  await second.getByLabel("Username").fill("casey");
  await second.getByLabel("Name", { exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("already has that username");
  await page.reload();
  await expect(page.getByRole("heading", { name: /Cast of/ })).toBeVisible();

  // Removing someone who hasn't written anything works.
  await page
    .getByRole("listitem", { name: "New person" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByRole("listitem", { name: "New person" })).toHaveCount(0);

  // Write a post.
  await page.getByRole("link", { name: "Back to the feed" }).click();
  await page.getByRole("button", { name: "New post here" }).click();
  const post = page.locator("article").first();
  const body = `Hello from nothing ${stamp}`;
  await post.getByRole("button", { name: /Text of this post/ }).click();
  await post.getByLabel("Text of this post").fill(body);
  await post.getByLabel("Text of this post").blur();
  await expect(post.getByText(body)).toBeVisible();

  // The cast screen now won't let them go, since they have a post.
  await page.getByRole("link", { name: "Cast", exact: true }).click();
  await expect(
    page.getByRole("listitem", { name: "Casey Jones" }).getByRole("button", { name: "Remove" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Back to the feed" }).click();

  // It shows in the list before it has any versions.
  await saveAndLaunch(page);
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  await page.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();

  const context = await browser.newContext();
  const participant = await context.newPage();
  await participant.goto(`http://localhost:${APP_PORT}/join/${slug}?PROLIFIC_PID=NEW-${stamp}`);
  await expect(participant.getByRole("heading", { name: "Consent" })).toBeVisible();
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`joiner_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Joiner");
  await participant.getByRole("button", { name: "Save and continue" }).click();
  await expect(participant.getByText(body)).toBeVisible();
  await context.close();
});

test("a study starts from a pack, and can be saved as a new pack", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;

  await signIn(page);
  await startStudy(page, `From a pack ${stamp}`, async () => {
    await page.getByRole("radio", { name: /EatSnap pack/ }).check();
    await expect(page.getByText(/A food photo community/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("new-study.png"), fullPage: true });
    await page.getByRole("radio", { name: /Just the background/ }).check();
  });

  // Just the background means one condition, and the same feed as the pack.
  await expect(page.getByRole("combobox", { name: "Condition" }).first()).toHaveValue("control");
  await expect(page.locator("article").first()).toBeVisible();

  // Consent doesn't come from the pack.
  await page.getByRole("link", { name: "Settings" }).click();
  const consent = page.getByRole("listitem").filter({ hasText: "1. Consent" });
  await expect(consent.getByLabel("Page text")).toHaveValue(/consent text your IRB approved/);
  await page.getByRole("link", { name: "Back to the feed" }).click();

  // It's copied, so changing it here doesn't change the pack, and it can be saved as a new one.
  const name = `Our lab pack ${stamp}`;
  await page.getByRole("button", { name: "Save as a pack" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as a pack" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Save the pack" }).click();
  await expect(dialog.getByText(/Your team can start new studies from it/)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.goto(`${ADMIN}/studies/new`);
  await expect(page.getByRole("radio", { name: new RegExp(name) })).toBeVisible();
});
