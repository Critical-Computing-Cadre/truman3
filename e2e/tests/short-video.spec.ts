import { readFileSync } from "node:fs";
import path from "node:path";
import { devices, expect, type Locator, test } from "@playwright/test";
import { createDb, schema } from "@truman3/db";
import { and, eq } from "drizzle-orm";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

// The short-video kind of site (ADR 95): one video at a time, playing by itself without sound until
// a tap, a swipe for the next, and comments over the video.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { databaseUrl, otherLabEmail, otherLabPassword } = JSON.parse(
  readFileSync(STATE_FILE, "utf8"),
) as Record<string, string>;
const database = createDb(databaseUrl as string);
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test.afterAll(async () => {
  await database.close();
});

const state = (video: Locator) =>
  video.evaluate((element: HTMLVideoElement) => ({
    playing: !element.paused,
    muted: element.muted,
  }));

test("a participant watches short videos, turns the sound on, swipes, and comments", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, on a phone-sized page of its own.");
  test.setTimeout(120_000);
  const stamp = Date.now() % 1_000_000;
  const title = `Loop ${stamp}`;

  // A researcher starts from the Short video sample, and opens it to participants.
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail as string);
  await page.getByLabel("Password").fill(otherLabPassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: "Short video", exact: true }).check();
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  const sample = page.locator("article").first();
  await expect(sample.locator("video")).toBeVisible();
  await expect.poll(async () => (await sample.boundingBox())?.height ?? 0).toBeGreaterThan(400);
  await page.screenshot({ path: testInfo.outputPath("builder.png") });
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();
  const slug = (await study.getByText(/\/join\//).textContent())?.match(/\/join\/([^\s?]+)/)?.[1];

  // A participant, on a phone.
  const context = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
  const participant = await context.newPage();
  const id = `LOOP-${stamp}`;
  await participant.goto(`http://localhost:${APP_PORT}/join/${slug}?PROLIFIC_PID=${id}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`loop_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Loop Person");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  // The newest video fills the screen and plays by itself, without sound.
  const posts = participant.locator("article");
  const first = posts.nth(0).locator("video");
  await expect.poll(() => state(first)).toEqual({ playing: true, muted: true });
  const box = await posts.nth(0).boundingBox();
  expect(box?.height).toBeGreaterThan(600);
  await participant.screenshot({ path: testInfo.outputPath("feed.png") });

  // One tap, and sound is on, for this video and the ones after it.
  await posts.nth(0).getByRole("button", { name: "Tap for sound" }).click();
  await expect.poll(() => state(first)).toEqual({ playing: true, muted: false });
  await participant.waitForTimeout(1500);

  // A swipe moves to the next, which plays with sound, and the first stops.
  await participant.getByLabel("Videos").press("ArrowDown");
  const second = posts.nth(1).locator("video");
  await expect.poll(() => state(second)).toEqual({ playing: true, muted: false });
  await expect.poll(() => state(first)).toEqual({ playing: false, muted: false });

  // Comments slide up over the video, and they can add one.
  await participant.getByLabel("Videos").press("ArrowDown");
  const third = posts.nth(2);
  await expect.poll(() => state(third.locator("video"))).toMatchObject({ playing: true });
  await third.getByRole("button", { name: /Comments/ }).click();
  const sheet = third.getByRole("region", { name: "Comments" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Write a comment").fill("love this");
  await sheet.getByRole("button", { name: "Send comment" }).click();
  await expect(sheet.getByRole("listitem").filter({ hasText: "love this" })).toBeVisible();
  await expect(sheet.getByLabel("Write a comment")).toHaveValue("");
  await participant.screenshot({ path: testInfo.outputPath("comments.png") });
  await sheet.getByRole("button", { name: "Close comments" }).click();

  // A tap on the video pauses it.
  await third.getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => state(third.locator("video"))).toMatchObject({ playing: false });
  await expect(third.getByRole("button", { name: "Play" })).toBeVisible();
  // Swiping on ends that spell of watching, which sends it.
  await participant.getByLabel("Videos").press("ArrowDown");
  await expect.poll(() => state(posts.nth(3).locator("video"))).toMatchObject({ playing: true });

  // Leaving sends what was watched.
  await participant.goto(`http://localhost:${APP_PORT}/rules`);
  await context.close();

  const [row] = await database.db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(eq(schema.participants.externalId, id));
  await expect
    .poll(async () => {
      const watched = await database.db
        .select({ payload: schema.events.payload })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.participantId, row?.id as string),
            eq(schema.events.type, "video.watched"),
          ),
        );
      return watched.map(({ payload }) => payload as { soundOn: boolean; plays: number });
    })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ soundOn: true, surface: "feed" }),
        expect.objectContaining({ pauses: 1 }),
      ]),
    );
});
