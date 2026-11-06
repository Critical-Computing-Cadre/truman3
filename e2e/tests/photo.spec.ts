import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createDb, schema } from "@truman3/db";
import { desc, eq } from "drizzle-orm";
import { APP_PORT } from "../playwright.config.ts";

const { databaseUrl } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../.e2e-state.json"), "utf8"),
) as { databaseUrl: string };
const database = createDb(databaseUrl);
test.afterAll(async () => {
  await database.close();
});

const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `photo-${project}-${name}.png`) });
  }
};

test("stories, square photos, who liked them, and a profile grid", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const app = `http://localhost:${APP_PORT}`;
  await page.goto(`${app}/join/photo-e2e?PROLIFIC_PID=PHOTO-${project}-${Date.now()}`);

  // Stories that are up now, and none that ended or haven't started.
  const row = page.getByRole("region", { name: "Stories" });
  await expect(row.getByRole("button", { name: "Stories from Ann" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Stories from Bob" })).toBeVisible();
  await expect(row.getByRole("button", { name: /Stories from Cleo/ })).toHaveCount(0);
  await expect(page.getByTestId("liked-by").first()).toBeVisible();
  await expect(page.getByText("Liked by Bob and 107 others")).toBeVisible();
  await shot(page, project, "1-feed");

  // The newest first: Bob's, then Ann's two, one after the other, and then it closes.
  await row.getByRole("button", { name: "Stories from Bob" }).click();
  const bob = page.getByRole("dialog", { name: "Stories from Bob" });
  await expect(bob.getByText("At the lake")).toBeVisible();
  await bob.getByRole("button", { name: "Next" }).click();
  const ann = page.getByRole("dialog", { name: "Stories from Ann" });
  await expect(ann.getByText("Morning coffee")).toBeVisible();
  await shot(page, project, "2-story");
  await ann.getByRole("button", { name: "Next" }).click();
  await ann.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Stories from Ann, seen" })).toBeVisible();

  const viewed = await database.db
    .select({ payload: schema.events.payload })
    .from(schema.events)
    .where(eq(schema.events.type, "story.viewed"))
    .orderBy(desc(schema.events.id))
    .limit(3);
  expect(viewed.map(({ payload }) => (payload as { ended: string }).ended)).toEqual([
    "next",
    "next",
    "next",
  ]);

  // Their own story, and who "viewed" it, as the study wrote.
  await row.getByRole("button", { name: "Add to your story" }).click();
  const adding = page.getByRole("dialog", { name: "Add to your story" });
  await adding.getByLabel("Photo").setInputFiles({
    name: "mine.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await adding.getByLabel("Caption (optional)").fill("My day");
  await adding.getByRole("button", { name: "Share" }).click();
  // The add button gives way to their own story, once it's there.
  await row.getByRole("button", { name: "Your story", exact: true }).click();
  const mine = page.getByRole("dialog").filter({ hasText: "My day" });
  await expect(mine.getByTestId("story-viewers")).toContainText("Seen by Ann, Bob");
  await shot(page, project, "3-own-story");
  await mine.getByRole("button", { name: "Close" }).click();

  // A profile is a grid of photos.
  await page.goto(`${app}/u/ann`);
  const grid = page.getByRole("list", { name: "Posts" });
  await expect(grid.getByRole("listitem")).toHaveCount(2);
  await shot(page, project, "4-profile");
});
