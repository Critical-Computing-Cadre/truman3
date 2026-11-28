import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { APP_PORT } from "../playwright.config.ts";

const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `looks-${project}-${name}.png`) });
  }
};
const app = `http://localhost:${APP_PORT}`;

test("Classic shows stories as tall cards, and as circles on a phone", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  await page.goto(`${app}/join/classic-stories-e2e?PROLIFIC_PID=CARDS-${project}-${Date.now()}`);
  const row = page.getByRole("region", { name: "Stories" });
  // Tall cards would push the posts off a phone's screen, so there it's a row of circles.
  await expect(row.getByRole("button", { name: "Add to your story" })).toContainText(
    project === "phone" ? "Your story" : "Create story",
  );
  await expect(row.getByRole("button", { name: "Stories from Ann" })).toBeVisible();
  await shot(page, project, "1-story-cards");
  await row.getByRole("button", { name: "Stories from Bob" }).click();
  await expect(page.getByRole("dialog", { name: "Stories from Bob" })).toContainText("New bike");
});

test("Short posts has a banner on profiles, a Media tab, and Mute thread", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  await page.goto(`${app}/join/short-posts-e2e?PROLIFIC_PID=LOOKS-${project}-${Date.now()}`);
  await expect(page.getByRole("tablist", { name: "Feeds" })).toBeVisible();

  // Muting a thread, from a post's menu.
  const first = page.locator("article").first();
  await first.getByRole("button", { name: "More" }).click();
  await first.getByRole("button", { name: "Mute thread" }).click();
  await expect(first.getByRole("button", { name: "Unmute thread" })).toBeVisible();

  // A profile with a banner, counts in a row, and tabs.
  await page.goto(`${app}/u/ann`);
  await expect(page.getByTestId("profile-banner")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ann" })).toBeVisible();
  await expect(page.getByTestId("follow-counts")).toContainText("followers");
  const tabs = page.getByRole("tablist", { name: "Profile" });
  await expect(tabs.getByRole("tab", { name: "Posts" })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: "Media" }).click();
  await expect(tabs.getByRole("tab", { name: "Media" })).toHaveAttribute("aria-selected", "true");
  await shot(page, project, "2-short-profile");
});

test("On a phone, the bars slide away going down, and a post is written on a whole screen", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "phone", "A wide screen keeps its bars, and writes in a window.");
  await page.goto(`${app}/join/short-posts-e2e?PROLIFIC_PID=BARS-${Date.now()}`);
  await expect(page.getByRole("tablist", { name: "Feeds" })).toBeVisible();

  // Going down the page, the bars leave the screen. Going up at all, they're back (ADR 104).
  const tabs = page.getByRole("navigation", { name: "Sections on a phone" });
  await expect(tabs).toBeInViewport();
  await page.mouse.wheel(0, 700);
  await expect(page.locator("html")).toHaveAttribute("data-bars", "hidden");
  await expect(tabs).not.toBeInViewport();
  await shot(page, project, "3-bars-away");
  await page.mouse.wheel(0, -120);
  await expect(page.locator("html")).not.toHaveAttribute("data-bars", "hidden");
  await expect(tabs).toBeInViewport();

  // The round button over the posts opens a whole screen to write on, with Post at the top.
  await page.getByRole("button", { name: "Compose" }).click();
  const writing = page.getByRole("dialog", { name: "Add a New Post" });
  await expect(writing.getByRole("button", { name: "Close" })).toHaveText("Cancel");
  const box = await writing.boundingBox();
  const screen = page.viewportSize();
  expect(box?.width).toBe(screen?.width);
  expect(box?.height).toBe(screen?.height);
  const send = writing.getByRole("button", { name: "Post", exact: true });
  await expect(send).toBeDisabled();
  expect((await send.boundingBox())?.y).toBeLessThan(60);
  await writing.getByLabel("Write a post").fill("Written from the round button");
  await shot(page, project, "4-writing");
  await send.click();
  await expect(writing).toBeHidden();
  // It shows in the feed. Someone in this study reposts it too, so it may be there twice.
  await expect(
    page.locator("article").filter({ hasText: "Written from the round button" }).first(),
  ).toBeVisible();
});
