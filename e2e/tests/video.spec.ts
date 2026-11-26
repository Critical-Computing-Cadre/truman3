import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createDb, schema } from "@truman3/db";
import { and, eq } from "drizzle-orm";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

// A video on a post (ADR 94): a researcher drops one on a post in the builder, and a participant
// watches it, which is recorded.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { databaseUrl, otherLabEmail, otherLabPassword } = JSON.parse(
  readFileSync(STATE_FILE, "utf8"),
) as Record<string, string>;
const database = createDb(databaseUrl as string);
const ADMIN = `http://localhost:${ADMIN_PORT}`;
const VIDEOS = path.resolve(import.meta.dirname, "../../packages/core/src/video-fixtures");

test.afterAll(async () => {
  await database.close();
});

test("a researcher puts a video on a post, and a participant watches it", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `Video ${stamp}`;

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail as string);
  await page.getByLabel("Password").fill(otherLabPassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();

  // A file that isn't a playable MP4 is refused, saying why.
  const post = page.locator("article").first();
  await expect(post).toBeVisible();
  await post.getByTestId("image-drop").hover();
  await post.getByRole("button", { name: /Replace photo/ }).click({ force: true });
  await post.getByLabel("Choose a photo or video").setInputFiles({
    name: "clip.mp4",
    mimeType: "video/mp4",
    buffer: readFileSync(path.join(VIDEOS, "hevc.mp4")),
  });
  await expect(post.getByRole("alert")).toContainText("HEVC (H.265)");

  // A playable one takes the place of the post's photo.
  await post.getByTestId("image-drop").hover();
  await post.getByRole("button", { name: /Replace photo/ }).click({ force: true });
  await post.getByLabel("Choose a photo or video").setInputFiles({
    name: "clip.mp4",
    mimeType: "video/mp4",
    buffer: readFileSync(path.join(VIDEOS, "h264.mp4")),
  });
  const video = post.locator("video");
  await expect(video).toBeVisible();
  await expect(post.getByRole("button", { name: "Remove video" })).toBeAttached();
  // Captions: a file that isn't WebVTT is refused, and a WebVTT file is added (ADR 101).
  await post.getByText("Details").first().click();
  await post.getByLabel("Add captions").setInputFiles({
    name: "clip.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,500\nNot WebVTT\n"),
  });
  await expect(post.getByRole("alert")).toContainText("isn't a WebVTT");
  await post.getByLabel("Add captions").setInputFiles({
    name: "clip.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from("WEBVTT\n\n00:00.000 --> 00:02.000\nA sun crosses the sky.\n"),
  });
  await expect(post.getByRole("button", { name: "Remove captions" })).toBeVisible();
  await post.screenshot({ path: testInfo.outputPath("builder.png") });

  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();
  const slug = (await study.getByText(/\/join\//).textContent())?.match(/\/join\/([^\s?]+)/)?.[1];

  // A participant plays it, then scrolls on, and that spell of watching is recorded.
  const context = await browser.newContext();
  const participant = await context.newPage();
  const id = `VIDEO-${stamp}`;
  await participant.goto(`http://localhost:${APP_PORT}/join/${slug}?PROLIFIC_PID=${id}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`video_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Video Person");
  await participant.getByRole("button", { name: "Save and continue" }).click();
  const shown = participant.locator("video").first();
  await shown.scrollIntoViewIfNeeded();
  await expect(shown).toHaveAttribute("src", /\/media\/[0-9a-f]{64}\.mp4$/);
  // Its captions load from the page's own address, and show unless they're turned off.
  await expect
    .poll(() =>
      shown.evaluate((element: HTMLVideoElement) => {
        const [track] = element.textTracks;
        return track
          ? `${track.mode}: ${track.cues?.[0] ? (track.cues[0] as VTTCue).text : ""}`
          : "";
      }),
    )
    .toBe("showing: A sun crosses the sky.");
  const played = await shown.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    try {
      await element.play();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return true;
    } catch {
      return false;
    }
  });
  await participant.screenshot({ path: testInfo.outputPath("participant.png") });
  // Leaving the page sends what's been watched.
  await participant.goto(`http://localhost:${APP_PORT}/profile`);
  await context.close();

  const [participantRow] = await database.db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(eq(schema.participants.externalId, id));
  await expect
    .poll(async () => {
      const rows = await database.db
        .select({ payload: schema.events.payload })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.participantId, participantRow?.id as string),
            eq(schema.events.type, "video.watched"),
          ),
        );
      return rows.map(({ payload }) => payload);
    })
    .toEqual(
      played
        ? [
            expect.objectContaining({
              plays: 1,
              playedMs: expect.any(Number),
              seconds: expect.closeTo(2, 0),
              soundOn: false,
              captionsOn: true,
              surface: "feed",
            }),
          ]
        : [],
    );
  // This browser can't always play H.264. Say so, rather than pass quietly.
  testInfo.annotations.push({ type: "video played", description: String(played) });
  expect(played, "the test browser couldn't play H.264").toBe(true);
});
