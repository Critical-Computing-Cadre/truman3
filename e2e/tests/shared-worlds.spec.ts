import { expect, test } from "@playwright/test";
import { APP_PORT } from "../playwright.config.ts";

/** Two participants in one shared world (ADR 67). */
test("two participants wait for each other, then see each other's posts", async ({
  browser,
}, testInfo) => {
  const app = `http://localhost:${APP_PORT}`;
  const id = `${testInfo.project.name}-${Date.now()}`;
  const ann = await (await browser.newContext()).newPage();
  const cal = await (await browser.newContext()).newPage();

  await ann.goto(`${app}/join/shared-e2e?PROLIFIC_PID=ANN-${id}`);
  await expect(ann.getByRole("heading", { name: "Waiting for others to join" })).toBeVisible();
  await expect(ann.getByTestId("waiting")).toContainText("1 of 2 are here");

  // When Cal joins, the world is full, and it starts for both.
  await cal.goto(`${app}/join/shared-e2e?PROLIFIC_PID=CAL-${id}`);
  await expect(cal.getByText("Welcome to Commons")).toBeVisible();
  await expect(ann.getByText("Welcome to Commons")).toBeVisible({ timeout: 10_000 });

  await cal.getByRole("button", { name: /Create a post/ }).click();
  const dialog = cal.getByRole("dialog");
  await dialog.getByLabel("Write a post").fill("Hello from Cal");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(cal.getByText("Hello from Cal")).toBeVisible();
  await ann.reload();
  await expect(ann.getByText("Hello from Cal")).toBeVisible();

  // The site's own terms, from the bottom of the page.
  await ann.getByRole("link", { name: "Terms of service" }).click();
  await expect(ann.getByText("Be kind to each other on Commons.")).toBeVisible();
});
