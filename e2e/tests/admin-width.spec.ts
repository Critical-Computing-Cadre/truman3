import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

const state = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../.e2e-state.json"), "utf8"),
) as { otherLabEmail: string; otherLabPassword: string };

// A table or a hidden label that's wider than the screen makes the whole page scroll sideways on a
// phone, and then buttons sit where a finger doesn't expect them. A wide table should scroll inside
// its own card.
test("the lab's pages are never wider than the screen", async ({ page }) => {
  await page.goto(`http://localhost:${ADMIN_PORT}`);
  await page.getByLabel("Email").fill(state.otherLabEmail);
  await page.getByLabel("Password").fill(state.otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  for (const name of ["Studies", "Your lab", "Access for agents"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const { screen, content } = await page.evaluate(() => ({
      screen: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(content, `${name} is wider than the screen`).toBeLessThanOrEqual(screen);
  }
});
