import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT, APP_PORT, TEST_BUILT_APPS } from "../playwright.config.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

test.describe("what production serves", () => {
  test.skip(!TEST_BUILT_APPS, "These look at the built apps. Run `pnpm test:e2e:built`.");

  for (const app of ["participant", "admin"]) {
    test(`the ${app} build names no address`, () => {
      const assets = path.join(ROOT, "apps", app, "dist/assets");
      const scripts = readdirSync(assets).filter((name) => name.endsWith(".js"));
      expect(scripts.length).toBeGreaterThan(0);

      for (const script of scripts) {
        expect(readFileSync(path.join(assets, script), "utf8")).not.toMatch(
          /localhost:\d|\/\/127\./,
        );
      }
    });
  }

  test("the same build works at a second address, as one community's domain would", async ({
    page,
  }) => {
    // The other tests all use localhost. A session on one address has no bearing on the other.
    await page.goto(`http://127.0.0.1:${APP_PORT}/join/eatsnap`);
    await page.getByRole("textbox").first().fill("second-address-person");
    await page.getByRole("button").first().click();

    await expect(page).not.toHaveURL(/\/join\//);
    const cookies = await page.context().cookies(`http://127.0.0.1:${APP_PORT}`);
    expect(cookies.map(({ httpOnly, secure }) => ({ httpOnly, secure }))).toContainEqual({
      httpOnly: true,
      secure: true,
    });
  });

  test("a page opened directly loads, and /api is on the same address", async ({ request }) => {
    for (const port of [APP_PORT, ADMIN_PORT]) {
      const page = await request.get(`http://localhost:${port}/some/deep/page`);
      expect(page.status()).toBe(200);
      expect(await page.text()).toContain('<div id="root">');

      const health = await request.get(`http://localhost:${port}/api/health/ready`);
      expect(await health.json()).toEqual({ status: "ok" });
    }
  });
});
