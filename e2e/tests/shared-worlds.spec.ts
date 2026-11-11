import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

const { otherLabEmail, otherLabPassword } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../.e2e-state.json"), "utf8"),
) as { otherLabEmail: string; otherLabPassword: string };

/** Two participants in one shared world (ADR 67). */
test("two participants wait for each other, then see each other's posts as they happen", async ({
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
  // Ann is told, without reloading, and chooses to see it.
  await ann.getByRole("button", { name: "New posts" }).click({ timeout: 10_000 });
  await expect(ann.getByText("Hello from Cal")).toBeVisible();
  await expect(ann.getByRole("button", { name: "New posts" })).toHaveCount(0);

  // Cal writes something unkind, and a researcher watching takes it down for everyone.
  const unkind = `You're all idiots ${id}`;
  await cal.getByRole("button", { name: /Create a post/ }).click();
  await cal.getByRole("dialog").getByLabel("Write a post").fill(unkind);
  await cal.getByRole("dialog").getByRole("button", { name: "Post", exact: true }).click();
  await ann.getByRole("button", { name: "New posts" }).click({ timeout: 10_000 });
  await expect(ann.getByText(unkind)).toBeVisible();

  const researcher = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();
  await researcher.goto(`http://localhost:${ADMIN_PORT}`);
  await researcher.getByLabel("Email").fill(otherLabEmail);
  await researcher.getByLabel("Password").fill(otherLabPassword);
  await researcher.getByRole("button", { name: "Sign in" }).click();
  await researcher
    .getByRole("listitem")
    .filter({ hasText: "Shared world" })
    .first()
    .getByRole("link", { name: "Monitor and download" })
    .click();
  const watching = researcher.getByRole("region", { name: "Shared worlds" });
  const item = watching.getByRole("listitem").filter({ hasText: unkind });
  await item.getByRole("button", { name: "Remove" }).click();
  await item.getByLabel("Reason others see (optional)").fill("Be kind");
  await item.getByRole("button", { name: "Remove for everyone" }).click();
  await expect(item.getByText("Removed", { exact: true })).toBeVisible();

  // Ann's page changes by itself, since it's a moderator's removal.
  await expect(ann.getByText("Removed by Mod.")).toBeVisible({ timeout: 10_000 });
  await expect(ann.getByText(unkind)).toHaveCount(0);

  // The site's own terms, from the bottom of the page.
  await ann.getByRole("link", { name: "Terms of service" }).click();
  await expect(ann.getByText("Be kind to each other on Commons.")).toBeVisible();
});
