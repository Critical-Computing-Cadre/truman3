import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createDb, schema } from "@truman3/db";
import { and, asc, eq } from "drizzle-orm";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

// The video platform kind of site (ADR 96): a grid of videos, a watch page with Up next, and the
// next video playing by itself when one ends.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { databaseUrl, otherLabEmail, otherLabPassword } = JSON.parse(
  readFileSync(STATE_FILE, "utf8"),
) as Record<string, string>;
const database = createDb(databaseUrl as string);
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test.afterAll(async () => {
  await database.close();
});

test("a participant opens a video from the grid, subscribes, comments, and autoplay moves on", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  test.setTimeout(120_000);
  const stamp = Date.now() % 1_000_000;
  const title = `Lookout ${stamp}`;

  // A researcher starts from the Video platform sample, and opens it to participants.
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail as string);
  await page.getByLabel("Password").fill(otherLabPassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: "Video platform", exact: true }).check();
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await expect(page.locator("article").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("builder.png"), fullPage: true });
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();
  const slug = (await study.getByText(/\/join\//).textContent())?.match(/\/join\/([^\s?]+)/)?.[1];

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const participant = await context.newPage();
  const id = `LOOKOUT-${stamp}`;
  await participant.goto(`http://localhost:${APP_PORT}/join/${slug}?PROLIFIC_PID=${id}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`lookout_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Lookout Person");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  // Home is a grid of videos, each with its title, channel, views, and length.
  const card = participant.getByRole("article", {
    name: "Jupiter's Great Red Spot is shrinking and getting taller",
  });
  await expect(card).toBeVisible();
  await expect(participant.locator("article")).toHaveCount(7);
  await expect(card.getByText("0:35")).toBeVisible();
  await expect(card.getByText("Gas Giants")).toBeVisible();
  await expect(card.getByText(/287K views/)).toBeVisible();
  await participant.screenshot({ path: testInfo.outputPath("home.png") });

  // Its page: the video plays, with Up next beside it.
  await card
    .getByRole("link", { name: "Jupiter's Great Red Spot is shrinking and getting taller" })
    .click();
  const video = participant.locator("article video");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused))
    .toBe(true);
  const upNext = participant.getByRole("region", { name: "Up next" });
  await expect(upNext.getByRole("link")).toHaveCount(6);
  const next = upNext.getByRole("link").first();
  const nextTitle = (await next.locator("span.line-clamp-2").textContent()) ?? "";

  // Subscribe is following the channel.
  // A channel they don't follow yet.
  await participant.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(participant.getByRole("button", { name: "Subscribed", exact: true })).toBeVisible();

  // A comment.
  await participant
    .getByRole("heading", { name: /Comments/ })
    .getByRole("button", { name: "Reply" })
    .click();
  await participant.getByLabel("Write a comment").fill("taller!");
  await participant.getByRole("button", { name: "Send comment" }).click();
  await expect(participant.getByRole("listitem").filter({ hasText: "taller!" })).toBeVisible();
  await participant.screenshot({ path: testInfo.outputPath("watch.png") });

  // When it ends, the next one follows, after a countdown that can be cancelled.
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = element.duration - 0.3;
  });
  await expect(upNext.getByRole("status")).toContainText("Up next in");
  await expect(participant.getByRole("heading", { name: nextTitle })).toBeVisible({
    timeout: 10_000,
  });

  // It's the second video they've opened, so an ad plays first (ADR 97): the sample has one before
  // every second video, skippable after 5 seconds.
  const ad = participant.getByRole("region", { name: "Ad from Hollowbean Coffee" });
  await expect(ad).toBeVisible();
  await expect(ad.getByRole("link", { name: "Visit site" })).toHaveAttribute(
    "href",
    "https://example.com/hollowbean",
  );
  await expect(ad.getByRole("button", { name: /Skip in/ })).toBeDisabled();
  // The ad has captions, which show, and a button to turn them off, since it has no controls.
  const track = () =>
    ad.locator("video").evaluate((element: HTMLVideoElement) => {
      const [captions] = element.textTracks;
      return captions ? `${captions.mode}, ${captions.cues?.length ?? 0} cues` : "none";
    });
  await expect.poll(track).toBe("showing, 2 cues");
  await ad.getByRole("button", { name: "Captions on" }).click();
  await expect.poll(track).toBe("hidden, 2 cues");
  await ad.getByRole("button", { name: "Captions off" }).click();
  await expect.poll(track).toBe("showing, 2 cues");
  await participant.screenshot({ path: testInfo.outputPath("ad.png") });
  await ad.getByRole("button", { name: "Skip ad ›" }).click({ timeout: 10_000 });
  // Then the video itself.
  await expect(ad).toHaveCount(0);
  await expect
    .poll(() =>
      participant.locator("article video").evaluate((element: HTMLVideoElement) => !element.paused),
    )
    .toBe(true);
  // Leaving sends what's waiting to be recorded.
  await participant.goto(`http://localhost:${APP_PORT}/rules`);
  await context.close();

  // How each was opened is recorded: from the grid, then by autoplay.
  const [row] = await database.db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(eq(schema.participants.externalId, id));
  await expect
    .poll(async () =>
      (
        await database.db
          .select({ payload: schema.events.payload })
          .from(schema.events)
          .where(
            and(
              eq(schema.events.participantId, row?.id as string),
              eq(schema.events.type, "content.opened"),
            ),
          )
          .orderBy(asc(schema.events.occurredAt))
      ).map(({ payload }) => (payload as { from: string }).from),
    )
    .toEqual(["feed", "autoplay"]);
  const watchedAds = await database.db
    .select({ payload: schema.events.payload })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.participantId, row?.id as string),
        eq(schema.events.type, "preroll.watched"),
      ),
    );
  expect(watchedAds.map(({ payload }) => payload)).toEqual([
    expect.objectContaining({
      ad: "coffee",
      completed: false,
      visited: false,
      captionsOn: true,
      skippedAt: expect.any(Number),
    }),
  ]);
  expect(
    (watchedAds[0]?.payload as { skippedAt: number } | undefined)?.skippedAt,
  ).toBeGreaterThanOrEqual(5);
  const follows = await database.db
    .select({ type: schema.events.type })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.participantId, row?.id as string),
        eq(schema.events.type, "actor.followed"),
      ),
    );
  expect(follows).toHaveLength(1);
});
