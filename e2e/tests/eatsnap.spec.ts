import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createDb, schema } from "@truman3/db";
import { exportStudy } from "@truman3/study-export";
import { parse } from "csv-parse/sync";
import { eq, sql } from "drizzle-orm";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const DAY = 24 * 3_600_000;
const MINUTE = 60_000;

/** A small valid image, so posting a photo goes through real upload and storage. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64",
);

type Row = Record<string, string>;

const { databaseUrl } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { databaseUrl: string };
const database = createDb(databaseUrl);

test.afterAll(async () => {
  await database.close();
});

const joinLink = (id: string) => `/join/eatsnap?PROLIFIC_PID=${id}`;

async function createAccount(page: Page, username: string) {
  await expect(
    page.getByRole("heading", { name: "Tell us a little about yourself" }),
  ).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Name", { exact: true }).fill("Test Person");
  await page.getByLabel("Bio").fill("Just testing");
  await page.getByRole("button", { name: "Save and continue" }).click();
}

/** Goes from the study link to the feed. */
async function goToFeed(page: Page, id: string, username: string) {
  await page.goto(joinLink(id));
  await expect(page.getByRole("button", { name: "I agree" })).toBeVisible();
  await page.getByRole("button", { name: "I agree" }).click();
  await createAccount(page, username);
  await expect(
    page.getByRole("heading", { name: "Community Rules for EatSnap.Love" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("article").first()).toBeVisible();
}

async function participantFor(externalId: string) {
  const [row] = await database.db
    .select({
      id: schema.participants.id,
      status: schema.participants.status,
      worldId: schema.worldMemberships.worldId,
      key: schema.conditions.key,
    })
    .from(schema.participants)
    .innerJoin(
      schema.worldMemberships,
      eq(schema.worldMemberships.participantId, schema.participants.id),
    )
    .innerJoin(schema.assignments, eq(schema.assignments.participantId, schema.participants.id))
    .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
    .where(eq(schema.participants.externalId, externalId));
  if (!row) {
    throw new Error(`No participant "${externalId}".`);
  }
  return row;
}

/** Moves a participant's whole timeline back, as if this much time had passed. */
async function passTime(externalId: string, ms: number) {
  const { worldId } = await participantFor(externalId);
  const [world] = await database.db
    .select({ startedAt: schema.worlds.startedAt })
    .from(schema.worlds)
    .where(eq(schema.worlds.id, worldId));
  await database.db
    .update(schema.worlds)
    .set({ startedAt: new Date((world?.startedAt.getTime() ?? 0) - ms) })
    .where(eq(schema.worlds.id, worldId));
  // Everything already scheduled in this world moves back by the same amount.
  const shift = sql`- ${ms} * interval '1 millisecond'`;
  await database.db
    .update(schema.notifications)
    .set({ dueAt: sql`${schema.notifications.dueAt} ${shift}` })
    .where(eq(schema.notifications.worldId, worldId));
  await database.db
    .update(schema.content)
    .set({ visibleAt: sql`${schema.content.visibleAt} ${shift}` })
    .where(eq(schema.content.worldId, worldId));
}

function unique(name: string, testInfo: { project: { name: string } }) {
  return `${name}-${testInfo.project.name}-${Date.now()}`;
}

test("a participant goes through the whole study, and the export matches what they did", async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      problems.push(`${response.status()} ${response.url()}`);
    }
  });

  const externalId = unique("PID", testInfo);
  await goToFeed(page, externalId, `tester_${testInfo.project.name}_${Date.now() % 100000}`);

  // Only the study's branding shows.
  await expect(page).toHaveTitle("EatSnap.Love");
  expect((await page.locator("body").textContent()) ?? "").not.toMatch(
    /truman|condition|participant/i,
  );

  const participant = await participantFor(externalId);
  const posts = page.locator("article");
  const scripted = posts.first();

  // Like, undo, and like again.
  const like = scripted.getByRole("button", { name: /Like/ }).first();
  await like.click();
  await expect(scripted.getByRole("button", { name: /♥ Like/ })).toBeVisible();
  await scripted.getByRole("button", { name: /♥ Like/ }).click();
  await expect(scripted.getByRole("button", { name: /♡ Like/ })).toBeVisible();
  await scripted.getByRole("button", { name: /♡ Like/ }).click();
  await expect(scripted.getByRole("button", { name: /♥ Like/ })).toBeVisible();

  // Comment on a scripted post.
  await scripted.getByRole("button", { name: "Reply" }).click();
  await scripted.getByLabel("Write a comment").fill("Looks great!");
  await scripted.getByRole("button", { name: "Post", exact: true }).click();
  await expect(scripted.getByText("Looks great!")).toBeVisible();

  // Flag a different scripted post.
  const second = posts.nth(1);
  await second.scrollIntoViewIfNeeded();
  await second.getByRole("button", { name: "Flag", exact: true }).first().click();
  await expect(second.getByText("You've flagged this!")).toBeVisible();

  // Make a post with a photo, through real upload.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByLabel("Write a post").fill("My first post");
  await page.getByLabel("Add a photo").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.locator("form").first().getByRole("button", { name: "Post", exact: true }).click();
  const mine = posts.filter({ hasText: "My first post" });
  await expect(mine).toBeVisible();
  const photo = mine.locator("img").last();
  await expect(photo).toHaveJSProperty("naturalWidth", 1);

  // Follow and report an actor.
  await posts.nth(1).locator("header a").first().click();
  await expect(page.getByRole("button", { name: "Follow" })).toBeVisible();
  await page.getByRole("button", { name: "Follow" }).click();
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByLabel("They are posting spam.").check();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("button", { name: "Reported" })).toBeVisible();

  // An hour on, scripted reactions have come due, and new content has appeared.
  await passTime(externalId, 60 * MINUTE);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Notifications, [1-9]/ })).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "My first post" }).getByText("Looking good :)"),
  ).toBeVisible();

  await page.getByRole("link", { name: /Notifications/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText(/read your post/)).toBeVisible();
  await expect(page.getByText(/read your comment/)).toBeVisible();
  await expect(page.getByText(/replied: Looking good/)).toBeVisible();

  // The count clears after viewing.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Notifications, 0 new" })).toBeVisible();

  // Leaving and returning picks up where they were, without creating anyone new.
  await page.context().clearCookies();
  await page.goto(joinLink(externalId));
  await expect(page.locator("article").first()).toBeVisible();
  expect((await participantFor(externalId)).id).toBe(participant.id);

  // Give timing reports time to send.
  await page.waitForTimeout(6_000);

  // The study's time runs out, and they go to the end rather than the feed.
  await passTime(externalId, 2 * DAY);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Thanks for being part of/ })).toBeVisible();
  expect(await page.locator("article").count()).toBe(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();

  // Finished means out for good.
  expect((await participantFor(externalId)).status).toBe("completed");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "You're not signed in." })).toBeVisible();
  await page.goto(joinLink(externalId));
  await expect(page.getByRole("alert")).toHaveText("This account is no longer active.");

  expect(problems).toEqual([]);

  // The export has to match what this participant actually did.
  const folder = mkdtempSync(path.join(tmpdir(), "truman-e2e-"));
  try {
    await exportStudy(database.db, "eatsnap", folder);
    const read = (name: string): Row[] =>
      parse(readFileSync(path.join(folder, name), "utf8"), { columns: true });

    const summary = read("summary.csv").find((row) => row.participant_id === participant.id);
    expect(summary).toMatchObject({
      status: "completed",
      posts_created: "1",
      comments_created: "1",
      content_liked: "1",
      like_actions: "2",
      content_flagged: "1",
      flag_actions: "1",
      actors_followed: "1",
      actors_reported: "1",
      sessions: "2",
    });

    const events = read("events.csv").filter((row) => row.participant_id === participant.id);
    const views = events.filter((row) => row.type === "content.viewed");
    expect(views.length).toBeGreaterThan(0);
    expect(views.some((row) => row.target_content_ref)).toBe(true);
    expect(views.every((row) => Number(row.dwell_ms) >= 0)).toBe(true);
    expect(events.some((row) => row.type === "page.viewed")).toBe(true);
    expect(events.some((row) => row.type === "reaction.scheduled" && row.source === "script")).toBe(
      true,
    );
    expect(events.at(-1)?.type).toBe("flow.exited");

    // Every comment shown fits this participant's condition, across all 25 targeted comments.
    const content = read("content.csv");
    const allowed = (row?: Row) =>
      !row?.conditions || row.conditions.split("|").includes(participant.key);
    const byId = new Map(content.map((row) => [row.content_id, row]));
    const shown = read("impressions.csv").filter((row) => row.participant_id === participant.id);
    expect(shown.length).toBeGreaterThan(0);
    for (const row of shown) {
      expect(allowed(byId.get(row.content_id ?? ""))).toBe(true);
      for (const commentId of (row.comment_ids ?? "").split("|").filter(Boolean)) {
        expect(allowed(byId.get(commentId))).toBe(true);
      }
    }

    expect(JSON.stringify(read("participants.csv"))).not.toContain(externalId);
    expect(readFileSync(path.join(folder, "codebook.md"), "utf8")).toContain("Version 1");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("someone without a link is asked for their ID, and a wrong link goes nowhere", async ({
  page,
}, testInfo) => {
  await page.goto("/join/does-not-exist");
  await expect(page.getByRole("heading", { name: "This page isn't available." })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "You're not signed in." })).toBeVisible();

  await page.goto("/join/eatsnap");
  await page.getByLabel("Prolific ID").fill(unique("TYPED", testInfo));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "I agree" })).toBeVisible();
});

test("the layout fits a phone without sideways scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Only applies to the phone size.");

  const externalId = unique("LAYOUT", testInfo);
  await goToFeed(page, externalId, `layout_${Date.now() % 100000}`);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
