import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { email, password } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  email: string;
  password: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

async function openDraft(page: Page) {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Edit a copy of version|Keep editing/ }).click();
  await expect(page.getByTestId("post-timeline")).toBeVisible();
}

/** Drags a marker to a point along the line, from 0 to 1, with a real mouse. */
async function dragTo(page: Page, marker: Locator, fraction: number) {
  const line = await page.getByTestId("post-timeline").boundingBox();
  const from = await marker.boundingBox();
  if (!line || !from) {
    throw new Error("The timeline isn't on screen.");
  }
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + line.width * fraction, from.y, { steps: 8 });
  await page.mouse.up();
}

test("dragging a post that can never appear onto the timeline fixes it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Dragging is on the desktop run.");

  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));

  await openDraft(page);
  await page.screenshot({ path: testInfo.outputPath("timeline.png") });

  const warning = page.getByText(/posts in this condition can never appear/);
  const count = async () => Number.parseInt((await warning.textContent()) ?? "", 10);
  const before = await count();
  expect(before).toBeGreaterThan(0);

  const lost = page.locator('[data-testid=post-timeline] [data-placement="late"]').first();
  const label = await lost.getAttribute("aria-label");
  const text = label?.split(": ").at(-1) ?? "";

  // Roughly the middle of the study, which is inside the feed's window.
  await dragTo(page, lost, 0.5);

  await expect.poll(count).toBe(before - 1);

  // It stays after reloading, because it saved.
  await page.reload();
  await expect(warning).toBeVisible();
  await expect.poll(count).toBe(before - 1);

  // Clicking it shows it in the feed, at that moment.
  // Other posts can start with the same words, and one past the end of the study can't be selected.
  const moved = page
    .getByTestId("post-timeline")
    .getByRole("button", {
      name: new RegExp(text.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    })
    .and(page.locator(':not([data-placement="late"])'));
  await moved.first().click();
  const feed = page.getByRole("region", { name: /Feed in/ }).first();
  await expect(feed.locator(".ring-sky-500")).toBeVisible();
  await expect(feed.locator(".ring-sky-500")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("timeline-selected.png") });

  expect(problems).toEqual([]);
});

test("a post can also be moved with the keyboard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  await openDraft(page);
  const marker = page.locator('[data-testid=post-timeline] [data-placement="ok"]').nth(20);
  const label = await marker.getAttribute("aria-label");
  const text = label?.split(": ").at(-1) ?? "";

  await marker.focus();
  await page.keyboard.press("ArrowRight");

  const same = page.getByTestId("post-timeline").getByRole("button", {
    name: new RegExp(text.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  });
  await expect.poll(() => same.first().getAttribute("aria-label")).not.toBe(label);
});
