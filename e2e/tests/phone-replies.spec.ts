import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { APP_PORT } from "../playwright.config.ts";

/** Where to keep pictures of what this looks like, when someone asks for them. */
const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `phone-${project}-${name}.png`) });
  }
};
const app = `http://localhost:${APP_PORT}`;

test("On a phone, a post's own page keeps the box to reply at the bottom of the screen", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "phone", "A wide screen has the box under the post.");
  await page.goto(`${app}/join/short-posts-e2e?PROLIFIC_PID=REPLYBAR-${Date.now()}`);
  await expect(page.getByRole("tablist", { name: "Feeds" })).toBeVisible();
  const href = await page.locator('a[href^="/p/"]').first().getAttribute("href");
  await page.goto(`${app}${href}`);

  // The box sits on the bottom edge, where the sections are on other pages (ADR 106).
  const bar = page.getByTestId("reply-bar");
  await expect(bar.getByLabel("Write a comment")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sections on a phone" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Compose" })).toBeHidden();
  const edge = async () => {
    const box = await bar.boundingBox();
    return Math.round((box?.y ?? 0) + (box?.height ?? 0));
  };
  const screen = page.viewportSize()?.height;
  expect(await edge()).toBe(screen);
  // It stays there however far down the page they go.
  await page.mouse.wheel(0, 400);
  expect(await edge()).toBe(screen);

  await bar.getByLabel("Write a comment").fill("Said from the bottom of the screen");
  await shot(page, project, "5-reply-bar");
  await bar.getByRole("button", { name: "Send comment" }).click();
  await expect(page.getByText("Said from the bottom of the screen")).toBeVisible();
  await expect(bar.getByLabel("Write a comment")).toHaveValue("");

  // Back on the feed, the sections are along the bottom again.
  await page.getByRole("link", { name: "Back to the feed" }).click();
  await expect(page.getByRole("navigation", { name: "Sections on a phone" })).toBeVisible();
});
