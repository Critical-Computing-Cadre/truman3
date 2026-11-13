import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { email, password } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  email: string;
  password: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

async function signIn(page: Page) {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
}

async function openPreview(page: Page) {
  await signIn(page);
  await page.getByRole("link", { name: "See the feed" }).first().click();
  await expect(page.getByLabel("Time in the study")).toBeVisible();
  await expect(page.locator("article").first()).toBeVisible();
}

test("a wrong password doesn't get in", async ({ page }) => {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("isn't right");
});

test("a researcher sees the real feed and moves through time", async ({ page }, testInfo) => {
  const broken: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("/admin/me")) {
      broken.push(`${response.status()} ${response.url()}`);
    }
  });

  await openPreview(page);
  const feed = page.getByRole("region", { name: /Feed in/ }).first();

  // The same post view participants get, with real images.
  const image = feed.locator("article img[loading=lazy]").first();
  await expect(image).toBeVisible();
  await expect(
    feed.locator("article").first().getByRole("button", { name: "Reply" }),
  ).toBeDisabled();

  // It warns about what can't be seen, which is hard to spot in a spreadsheet.
  await expect(page.getByText(/70 posts in this condition can never appear/)).toBeVisible();

  const startCount = await feed.locator("article").count();
  const firstPost = await feed.locator("article").first().textContent();

  // Moving through time changes the feed.
  await page.getByLabel("Time in the study").fill(String(6 * 3_600_000));
  await expect(page.getByText("Day 1, 6h in")).toBeVisible();
  await expect.poll(() => feed.locator("article").first().textContent()).not.toBe(firstPost);
  expect(startCount).toBeGreaterThan(0);

  await page.screenshot({ path: testInfo.outputPath("preview.png") });
  expect(broken).toEqual([]);
});

test("play moves time forward, and can be paused", async ({ page }) => {
  await openPreview(page);
  const time = page.locator("output");
  await expect(time).toHaveText("Day 1, 0h in");

  await page.getByRole("button", { name: "Play" }).click();
  // Any later time will do. It moves quickly, so looking for one exact moment could miss it.
  await expect(time).not.toHaveText("Day 1, 0h in");

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  const paused = await time.textContent();
  await page.waitForTimeout(1_200);
  await expect(time).toHaveText(paused ?? "");
});

test("comparing two conditions shows what differs, labeled", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Side by side needs a wide screen.");
  await openPreview(page);

  await page.getByLabel("Condition", { exact: true }).selectOption("marginal");
  await page.getByLabel("Compare with").selectOption("troll");
  await expect(page.getByRole("region", { name: "Feed in marginal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Feed in troll" })).toBeVisible();

  // Move along until targeted comments have appeared.
  await page.getByLabel("Time in the study").fill(String(36 * 3_600_000));
  await expect(page.getByText("Day 2, 12h in")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Feed in marginal" }).getByText("Only in marginal").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Feed in marginal" }).getByText("Only in troll"),
  ).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath("compare.png") });
});

test("signing out ends access", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a researcher makes a token for an agent, sees it once, and revokes it", async ({
  page,
  request,
}, testInfo) => {
  await signIn(page);
  await page.getByRole("link", { name: "Access for agents" }).click();
  await expect(page.getByRole("heading", { name: "Access for agents" })).toBeVisible();
  const name = `Claude Code ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("What it's for").fill(name);
  await page.getByRole("button", { name: "Create a token" }).click();
  const token = (await page.getByTestId("new-token").textContent()) ?? "";
  expect(token).toMatch(/^truman_pat_/);

  // It works for an agent, through the API, but not for launching anything.
  const api = `http://localhost:${ADMIN_PORT}/api`;
  const headers = { authorization: `Bearer ${token}` };
  expect((await request.get(`${api}/admin/me`, { headers })).status()).toBe(200);
  expect(
    (
      await request.post(`${api}/admin/versions/${crypto.randomUUID()}/launch`, { headers })
    ).status(),
  ).toBe(403);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("new-token")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toHaveCount(0);
  expect((await request.get(`${api}/admin/me`, { headers })).status()).toBe(401);
});
