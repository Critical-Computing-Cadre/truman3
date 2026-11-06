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

/** A small valid image, so posting goes through real upload and storage. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
    buffer: PNG,
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

test("places, tags, Explore, highlights, and close friends", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const app = `http://localhost:${APP_PORT}`;
  await page.goto(`${app}/join/photo-e2e?PROLIFIC_PID=PHOTO2-${project}-${Date.now()}`);

  // A post says where it was, and who's in it when the icon's pressed.
  const halloween = page.locator("article").filter({ hasText: "Halloween warm-up" });
  await expect(halloween.getByRole("link", { name: "Ithaca, New York" })).toBeVisible();
  await halloween.getByRole("button", { name: "Tagged: Bob" }).click();
  await expect(halloween.getByTestId("photo-tags")).toHaveText("Bob");
  await shot(page, project, "5-place-and-tags");

  // Every post at a place.
  await halloween.getByRole("link", { name: "Ithaca, New York" }).click();
  await expect(page.getByRole("heading", { name: "Ithaca, New York" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Posts at Ithaca, New York" }).getByRole("listitem"),
  ).toHaveCount(2);

  // Explore has photos from people they don't follow.
  await page.goto(`${app}/explore`);
  const explore = page.getByRole("list", { name: "Explore" });
  await expect(explore.getByRole("link", { name: "Post by Cleo" })).toBeVisible();
  await expect(explore.getByRole("listitem")).toHaveCount(1);
  await shot(page, project, "6-explore");

  // A highlight keeps a story on a profile after it's gone from the row.
  await page.goto(`${app}/u/ann`);
  await page.getByRole("button", { name: "Highlight: Trips" }).click();
  const trips = page.getByRole("dialog", { name: "Highlight: Trips" });
  await expect(trips.getByText("Summer trip")).toBeVisible();
  await trips.getByRole("button", { name: "Close" }).click();
  await expect(trips).toBeHidden();

  // Posts someone's tagged in are on their profile's Tagged tab.
  await page.getByRole("tab", { name: "Tagged" }).click();
  await expect(page.getByRole("list", { name: "Tagged" }).getByRole("listitem")).toHaveCount(1);

  // Ann goes on their close friends list.
  await page.getByRole("button", { name: "Add to close friends" }).click();
  await expect(page.getByRole("button", { name: "Close friend ✓" })).toBeVisible();

  // Someone else's close-friends story has its own ring and label.
  await page.goto(`${app}/`);
  const row = page.getByRole("region", { name: "Stories" });
  await row.getByRole("button", { name: "Stories from Dee, close friends" }).click();
  const dee = page.getByRole("dialog", { name: "Stories from Dee" });
  await expect(dee.getByText("Close friends", { exact: true })).toBeVisible();
  await shot(page, project, "7-close-friends");
  await dee.getByRole("button", { name: "Close" }).click();

  // Their own story, for close friends only, is seen only by those on the list.
  await row.getByRole("button", { name: "Add to your story" }).click();
  const adding = page.getByRole("dialog", { name: "Add to your story" });
  await adding.getByLabel("Photo").setInputFiles({
    name: "mine.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await adding.getByLabel("Caption (optional)").fill("Friends only");
  await adding.getByLabel("Close friends only").check();
  await adding.getByRole("button", { name: "Share" }).click();
  await row.getByRole("button", { name: "Your story", exact: true }).click();
  const mine = page.getByRole("dialog").filter({ hasText: "Friends only" });
  await expect(mine.getByTestId("story-viewers")).toHaveText("Seen by Ann");
  await mine.getByRole("button", { name: "Close" }).click();

  // A post of theirs can say where it was.
  await page.getByRole("button", { name: "Create a post" }).click();
  const newPost = page.getByRole("dialog");
  await newPost.getByLabel("Write a post").fill("At the market");
  await newPost.getByLabel("Add photos").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await newPost.getByLabel("Add a place (optional)").fill("Lima");
  await newPost.getByRole("button", { name: "Post", exact: true }).click();
  await expect(newPost).toBeHidden();
  const market = page.locator("article").filter({ hasText: "At the market" });
  await expect(market.getByRole("link", { name: "Lima" })).toBeVisible();
});
