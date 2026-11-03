import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

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

test("a researcher writes a reply to a comment, and a participant can reply too", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "New study" }).click();
  const stamp = Date.now() % 1_000_000;
  const title = `Threads ${stamp}`;
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /EatSnap pack/ }).check();
  await page.getByRole("radio", { name: /Just the background/ }).check();
  await page.getByRole("radio", { name: /^Blocked/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();

  const post = page.locator("article").first();
  await expect(post).toBeVisible();
  // Classic has no replies to replies, so there's nothing to open until they're turned on.
  await expect(post.getByText("Add a reply")).toHaveCount(0);

  await page.getByRole("link", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Study and platform" });
  await settings.getByRole("checkbox", { name: /^Replies to replies/ }).check();
  await settings.getByRole("button", { name: "Save changes" }).click();
  await expect(settings.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.goBack();

  await post.getByLabel("Comment written by").waitFor();
  await post.getByLabel("Add a comment").fill("A comment to reply to");
  await post.getByRole("button", { name: "Add", exact: true }).click();
  const parent = post.getByRole("listitem").filter({ hasText: "A comment to reply to" });
  await expect(parent).toBeVisible();

  await parent.getByText("Add a reply").click();
  await parent.getByLabel("Add a reply").fill("A reply underneath");
  await parent.getByRole("button", { name: "Add", exact: true }).click();

  const reply = post.getByRole("listitem").filter({ hasText: "A reply underneath" });
  await expect(reply).toBeVisible();
  await expect(reply).toHaveCSS("margin-left", "20px");
  await reply.screenshot({ path: testInfo.outputPath("threads.png") });

  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();

  const context = await browser.newContext();
  const participant = await context.newPage();
  await participant.goto(
    `http://localhost:${APP_PORT}/join/threads-${stamp}?PROLIFIC_PID=THREAD-${stamp}`,
  );
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`threads_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Thread Person");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  const seen = participant.locator("article").first();
  await seen.getByLabel("Write a comment").fill("My comment");
  await seen.getByLabel("Write a comment").press("Enter");
  const mine = seen.getByRole("listitem").filter({ hasText: "My comment" });
  await mine.getByRole("button", { name: "Reply" }).click();
  await expect(seen.getByText("Replying to Thread Person")).toBeVisible();
  await seen.getByLabel("Write a comment").fill("My reply");
  await seen.getByLabel("Write a comment").press("Enter");
  const myReply = seen.getByRole("listitem").filter({ hasText: "My reply" });
  await expect(myReply).toHaveCSS("margin-left", "20px");
  await expect(seen.getByText("Replying to")).toHaveCount(0);
  await context.close();
});

test("a researcher turns votes on and sets a score, and a participant votes", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "New study" }).click();
  const stamp = Date.now() % 1_000_000;
  const title = `Votes ${stamp}`;
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /EatSnap pack/ }).check();
  await page.getByRole("radio", { name: /Just the background/ }).check();
  await page.getByRole("radio", { name: /^Blocked/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();

  const post = page.locator("article").first();
  await expect(post).toBeVisible();
  await expect(post.getByRole("button", { name: "Vote up" })).toHaveCount(0);

  await page.getByRole("link", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Study and platform" });
  await settings.getByRole("checkbox", { name: /^Up and down votes/ }).check();
  await settings.getByRole("button", { name: "Save changes" }).click();
  await expect(settings.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.goBack();

  await post.getByText("Details").first().click();
  await post.getByLabel("Up votes").first().fill("12");
  await post.getByLabel("Down votes").first().fill("2");
  await post.getByLabel("Down votes").first().blur();
  await expect(post.getByTestId("score").first()).toContainText("10");

  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();

  const context = await browser.newContext();
  const participant = await context.newPage();
  await participant.goto(
    `http://localhost:${APP_PORT}/join/votes-${stamp}?PROLIFIC_PID=VOTE-${stamp}`,
  );
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`votes_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Vote Person");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  // Its score is about to change, so find it once and keep to that place in the feed.
  const seen = participant.locator("article");
  await expect(seen.first()).toBeVisible();
  const place = await seen.evaluateAll((posts) =>
    posts.findIndex((post) => post.textContent?.includes("Score 10")),
  );
  const scored = seen.nth(place);
  await scored.getByRole("button", { name: "Vote up" }).first().click();
  await expect(scored.getByTestId("score").first()).toContainText("11");
  await scored.getByRole("button", { name: "Vote down" }).first().click();
  await expect(scored.getByTestId("score").first()).toContainText("9");
  await scored.getByRole("button", { name: "Vote down" }).first().click();
  await expect(scored.getByTestId("score").first()).toContainText("10");
  await scored.screenshot({ path: testInfo.outputPath("votes.png") });
  await context.close();
});
