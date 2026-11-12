import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { email, password, editorEmail, editorPassword } = JSON.parse(
  readFileSync(STATE_FILE, "utf8"),
) as { email: string; password: string; editorEmail: string; editorPassword: string };
const ADMIN = `http://localhost:${ADMIN_PORT}`;

async function openSettings(page: Page, who = email, secret = password) {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(who);
  await page.getByLabel("Password").fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Edit a copy of version|Keep editing/ }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: /Settings for/ })).toBeVisible();
}

test("a researcher changes settings, and a new participant gets them", async ({
  page,
  browser,
}, testInfo) => {
  // This changes the one shared study, so it only runs once, on one screen size.
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  await openSettings(page);
  await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true });

  // Each section shows its current value and saves by itself. Undo brings it back.
  const study = page.getByRole("region", { name: "Study and platform" });
  await study.getByLabel(/^Text/).check();
  await study.getByRole("button", { name: "Save changes" }).click();
  await expect(study.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByText(/^Recent changes/).click();
  const change = page
    .getByRole("listitem")
    .filter({ hasText: "changed the study and platform settings" });
  await change.first().getByRole("button", { name: "Undo" }).click();
  await expect(study.getByLabel(/^Photo/)).toBeChecked();

  // A new condition, with what differs in it set right there.
  const conditions = page.getByRole("region", { name: "Conditions" });
  await conditions.getByRole("button", { name: "Add a condition" }).click();
  await conditions.getByRole("textbox", { name: "Name" }).last().fill("new-condition");
  const newArm = conditions.locator("details").last();
  await newArm.locator("summary").click();
  await newArm.getByLabel("Comment boxes").selectOption("onReply");
  await conditions.getByRole("button", { name: "Save changes" }).click();
  await expect(conditions.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(conditions.getByText("Settings that differ in this condition (1)")).toBeVisible();

  // Then removed again, so the study keeps its own conditions.
  await conditions.getByRole("button", { name: "Remove" }).last().click();
  await conditions.getByRole("button", { name: "Save changes" }).click();
  await expect(conditions.locator("details")).toHaveCount(5);

  // Shared worlds are saved with the conditions, and stay after a reload. Then off again, since
  // other tests use this study.
  await conditions.getByLabel("Put participants together, so they see each other").check();
  await conditions.getByLabel("People in a world").fill("4");
  await conditions.getByRole("button", { name: "Save changes" }).click();
  await expect(conditions.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.reload();
  await expect(conditions.getByLabel("People in a world")).toHaveValue("4");
  await conditions.getByLabel("Put participants together, so they see each other").uncheck();
  await conditions.getByRole("button", { name: "Save changes" }).click();
  await expect(conditions.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.reload();
  await expect(conditions.getByLabel("People in a world")).toHaveCount(0);

  // Comment boxes, for the whole study, and a main color of its own in place of Classic's blue.
  await study.getByLabel(/^After pressing Reply/).check();
  await study.getByLabel("Main color").fill("#2f7d32");
  await expect(
    study.getByRole("button", { name: "Use this kind of site's own color" }),
  ).toBeVisible();
  await study.getByRole("button", { name: "Save changes" }).click();
  await expect(study.getByRole("button", { name: "Save changes" })).toBeDisabled();

  // The consent page, seen the way participants will.
  const flow = page.getByRole("region", { name: "Study flow" });
  const stamp = Date.now();
  const consent = flow.getByRole("listitem").filter({ hasText: "1. Consent" });
  const text = `# Edited consent ${stamp}\n\nA new paragraph.`;
  await consent.getByLabel("Page text").fill(text);
  await consent.getByRole("button", { name: "See it as participants will" }).click();
  await expect(consent.getByRole("heading", { name: `Edited consent ${stamp}` })).toBeVisible();
  await consent.getByRole("button", { name: "Save changes" }).click();
  await expect(consent.getByRole("button", { name: "Save changes" })).toHaveCount(0);

  // An exit link, which can be tried with a test ID.
  const exit = flow.getByRole("listitem").filter({ hasText: "Exit" });
  await exit
    .getByLabel("Where to send them at the end")
    .fill("https://example.com/survey?pid={externalId}");
  await expect(exit.getByRole("link", { name: /Try this link/ })).toHaveAttribute(
    "href",
    "https://example.com/survey?pid=TEST_ID",
  );
  await flow.getByRole("button", { name: "Save changes" }).last().click();
  await expect(exit.getByLabel("Where to send them at the end")).toHaveValue(
    "https://example.com/survey?pid={externalId}",
  );

  // Save it as a version and launch it.
  await page.getByRole("link", { name: "Back to the feed" }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  // Newest first, and the list never shows an old one first, so this is the version just saved.
  await page.getByRole("button", { name: "Launch", exact: true }).first().click();
  await page.getByRole("button", { name: "Launch it" }).click();
  await expect(page.getByRole("button", { name: "Launch it" })).toBeHidden();

  // A new participant gets all of it.
  const participantContext = await browser.newContext();
  const participant = await participantContext.newPage();
  await participant.goto(
    `http://localhost:${APP_PORT}/join/eatsnap?PROLIFIC_PID=SETTINGS-${stamp}`,
  );
  await expect(participant.getByRole("heading", { name: `Edited consent ${stamp}` })).toBeVisible();
  // The study's color is there from the first page, on a button as well as in the page's settings.
  await expect(participant.locator("html")).toHaveAttribute("data-layout", "classic");
  await expect(participant.getByRole("button", { name: "I agree" })).toHaveCSS(
    "background-color",
    "rgb(47, 125, 50)",
  );
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`settings_${stamp % 100000}`);
  await participant.getByLabel("Name", { exact: true }).fill("Settings");
  await participant.getByRole("button", { name: "Save and continue" }).click();
  await participant.getByRole("button", { name: "Continue", exact: true }).click();
  const post = participant.locator("article").first();
  await expect(post).toBeVisible();
  await expect(post.getByLabel("Write a comment")).toHaveCount(0);
  await post.getByRole("button", { name: "Reply" }).click();
  await expect(post.getByLabel("Write a comment")).toBeFocused();
  await participantContext.close();
});

test("two researchers can't overwrite each other's settings without knowing", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await openSettings(first);
  await openSettings(second, editorEmail, editorPassword);

  const firstFeed = first.getByRole("region", { name: "Feed", exact: true });
  const secondFeed = second.getByRole("region", { name: "Feed", exact: true });

  // Starting to edit shows up for the other person.
  const firstBlocked = firstFeed.getByLabel("Hide accounts someone has blocked");
  await firstBlocked.focus();
  await expect(secondFeed.getByText("A Researcher editing this")).toBeVisible();

  // The second person is partway through their own edit when the first person saves.
  await secondFeed.getByLabel("Hide content someone has flagged").check();
  await firstBlocked.uncheck();
  await firstFeed.getByRole("button", { name: "Save changes" }).click();

  // They're told, and can't save over it without seeing it.
  await expect(secondFeed.getByText(/Someone else saved this/)).toBeVisible();
  await expect(secondFeed.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await secondFeed.getByRole("button", { name: "Discard" }).click();
  await expect(secondFeed.getByLabel("Hide accounts someone has blocked")).not.toBeChecked();
  await expect(secondFeed.getByLabel("Hide content someone has flagged")).not.toBeChecked();

  await firstContext.close();
  await secondContext.close();
});
