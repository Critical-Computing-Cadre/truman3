import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { devices, expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// Takes the pictures the public site's guide uses (apps/site/public/shots), from the real apps, so
// they can be retaken whenever the apps change:
//
//   DOCS_SHOTS=1 pnpm test:e2e docs-screenshots
//
// It's skipped in an ordinary run, so the pictures only change when someone means them to.

const SHOTS = path.resolve(import.meta.dirname, "../../apps/site/public/shots");
const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;
const shot = (name: string) => path.join(SHOTS, `${name}.png`);

const KINDS = [
  { radio: "Classic", file: "classic" },
  { radio: "Photo", file: "photo" },
  { radio: "Short posts", file: "short-posts" },
  { radio: "Forum", file: "forum" },
] as const;

/** Gets a test participant from the link to the feed, through whatever steps the study has. */
async function reachFeed(page: Page) {
  const agree = page.getByRole("button", { name: "I agree" });
  const username = page.getByLabel("Username");
  const next = page.getByRole("button", { name: "Continue" });
  for (let step = 0; step < 6; step++) {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    if (await agree.isVisible()) {
      await agree.click();
      await agree.waitFor({ state: "hidden" });
    } else if (await username.isVisible()) {
      await username.fill(`sam${Date.now() % 100000}`);
      await page.getByLabel("Name", { exact: true }).fill("Sam Rivera");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await username.waitFor({ state: "hidden" });
    } else if (await next.isVisible()) {
      await next.click();
      await page.waitForTimeout(400);
    } else {
      break;
    }
  }
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}

test("takes the guide's pictures", async ({ page, browser }, testInfo) => {
  test.skip(process.env.DOCS_SHOTS !== "1", "Only when retaking the site's pictures.");
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  test.setTimeout(300_000);
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 860 });
  const stamp = Date.now() % 1_000_000;

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();

  for (const [index, kind] of KINDS.entries()) {
    const title = `Weekend plans ${kind.file} ${stamp}`;
    await page.getByRole("link", { name: "New study" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("radio", { name: kind.radio, exact: true }).check();
    await page.getByRole("radio", { name: /Sample content/ }).check();
    await page.getByRole("radio", { name: /^Blocked/ }).check();
    if (index === 0) {
      await page.screenshot({ path: shot("new-study"), fullPage: true });
    }
    await page.getByRole("button", { name: "Start the study" }).click();
    await expect(page.getByRole("button", { name: "Save as new version" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    if (index === 0) {
      await page.screenshot({ path: shot("builder") });
      await page.getByRole("link", { name: "Cast", exact: true }).click();
      await expect(page.getByRole("heading", { name: /Cast of/ })).toBeVisible();
      await page.screenshot({ path: shot("cast") });
      await page.getByRole("link", { name: "Back to the feed" }).click();
      await page.getByRole("link", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { name: /Settings for/ })).toBeVisible();
      await page
        .getByRole("region", { name: "Conditions" })
        .screenshot({ path: shot("conditions") });
      await page.getByRole("region", { name: "Study flow" }).screenshot({ path: shot("flow") });
      await page.getByRole("link", { name: "Back to the feed" }).click();
      await page.getByRole("link", { name: "Beats", exact: true }).click();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: shot("beats") });
      await page.getByRole("link", { name: "Back to the feed" }).click();
    }

    await page.getByRole("button", { name: "Save as new version" }).click();
    if (index === 0) {
      await page.screenshot({ path: shot("save-version") });
    }
    await page.getByRole("button", { name: "Save version" }).click();
    await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();

    const study = page.getByRole("listitem").filter({ hasText: title }).first();
    await study.getByRole("button", { name: "Try as a participant" }).click();
    const link = study.getByRole("link", { name: "Open as a test participant" });
    await expect(link).toBeVisible();
    if (index === 0) {
      await study.screenshot({ path: shot("studies") });
    }
    const phone = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
    const participant = await phone.newPage();
    await participant.goto((await link.getAttribute("href")) as string);
    await reachFeed(participant);
    await participant.screenshot({ path: shot(`kind-${kind.file}`) });
    await phone.close();

    // The same on a wide screen, where each kind lays its page out differently.
    // The link is for one test participant, so this asks for another.
    await page.reload();
    await study.getByRole("button", { name: "Try as a participant" }).click();
    await expect(link).toBeVisible();
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const wide = await desk.newPage();
    await wide.goto((await link.getAttribute("href")) as string);
    await reachFeed(wide);
    await wide.screenshot({ path: shot(`kind-${kind.file}-wide`) });
    // The pages beyond the feed, to look over. They aren't used on the site, so they stay with the
    // test's own output.
    const origin = new URL(wide.url()).origin;
    // A kind without a page for each post has no such link, and waiting for one would never end.
    const first = async (selector: string) => {
      const links = wide.locator(selector);
      return (await links.count()) > 0 ? links.first().getAttribute("href") : null;
    };
    const someone = await first('article a[href^="/u/"]');
    const onePost = await first('a[href^="/p/"]');
    const more: [string, string | null][] = [
      ["someone", someone],
      ["post", onePost],
      ["notifications", "/notifications"],
      ["explore", "/explore"],
      ["account", "/account"],
    ];
    for (const [name, address] of more) {
      if (address) {
        await wide.goto(origin + address);
        await wide.waitForLoadState("networkidle");
        await wide.waitForTimeout(300);
        await wide.screenshot({ path: testInfo.outputPath(`${kind.file}-${name}.png`) });
      }
    }
    await wide.getByRole("link", { name: "Profile" }).first().click();
    await wide.waitForLoadState("networkidle");
    await wide.screenshot({ path: testInfo.outputPath(`${kind.file}-me.png`) });
    await desk.close();
  }

  await page.getByRole("link", { name: "Your lab" }).click();
  await expect(page.getByRole("heading", { name: "Your lab" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("your-lab") });
});
