import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createDb, schema } from "@truman3/db";
import { and, eq, isNull } from "drizzle-orm";
import { ADMIN_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { databaseUrl, email, password } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  databaseUrl: string;
  email: string;
  password: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==";
const database = createDb(databaseUrl);

test.afterAll(async () => {
  await database.close();
});

async function signIn(page: Page) {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
}

test("a researcher edits in the feed, saves, tries it, launches, and a new participant sees it", async ({
  page,
  context,
  browser,
}, testInfo) => {
  // This changes the one shared study, so it only runs once, on one screen size.
  test.skip(testInfo.project.name !== "desktop", "Runs once.");

  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));

  await signIn(page);
  await page.getByRole("button", { name: /Edit a copy of version|Keep editing/ }).click();
  await expect(page.getByRole("button", { name: "Save as new version" })).toBeVisible();

  const feed = page.getByRole("region", { name: /Feed in/ }).first();
  const firstPost = feed.locator("article").first();
  await expect(firstPost).toBeVisible();

  // Click the text of the post, and change it.
  const newText = `Edited in the feed ${Date.now()}`;
  await firstPost.getByRole("button", { name: /Text of this post/ }).click();
  await firstPost.getByLabel("Text of this post").fill(newText);
  await firstPost.getByLabel("Text of this post").blur();
  await expect(firstPost.getByText(newText)).toBeVisible();

  // It stays after reloading, because it saved.
  await page.reload();
  await expect(feed.getByText(newText)).toBeVisible();

  // Add a comment to it.
  const edited = feed.locator("article").filter({ hasText: newText });
  await edited.getByLabel("Add a comment").fill("A comment added here");
  await edited.getByRole("button", { name: "Add", exact: true }).click();
  await expect(edited.getByText("A comment added here")).toBeVisible();

  // Add a post at this point in the timeline, and write in it.
  const before = await feed.locator("article").count();
  await page.getByRole("button", { name: "New post here" }).click();
  await expect(feed.locator("article")).toHaveCount(before + 1);
  const added = feed.locator("article").first();
  const addedText = `A brand new post ${Date.now()}`;
  await added.getByRole("button", { name: /Text of this post/ }).click();
  await added.getByLabel("Text of this post").fill(addedText);
  await added.getByLabel("Text of this post").blur();
  await expect(feed.getByText(addedText)).toBeVisible();

  // Drop a photo onto the new post, the way a person would drag one in.
  const photoPost = feed.locator("article").filter({ hasText: addedText });
  await expect(photoPost.getByText("Drop a photo here")).toBeVisible();
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "my photo with any name.png", { type: "image/png" }));
    return transfer;
  }, PNG_BASE64);
  await photoPost.getByTestId("image-drop").dispatchEvent("drop", { dataTransfer });
  await expect(photoPost.getByTestId("image-drop").locator("img")).toHaveCount(1);
  await expect(photoPost.getByTestId("image-drop").locator("img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );

  await page.screenshot({ path: testInfo.outputPath("editing.png") });

  // Something that isn't an image gets refused, and says why.
  await photoPost.getByLabel("Choose a photo").setInputFiles({
    name: "notes.png",
    mimeType: "image/png",
    buffer: Buffer.from("not really a picture"),
  });
  await expect(photoPost.getByRole("alert")).toContainText("can't be used");
  await expect(photoPost.getByTestId("image-drop").locator("img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );

  // Limit the new post to one condition, and see it leave the others.
  const conditions = await page
    .getByLabel("Condition", { exact: true })
    .locator("option")
    .allTextContents();
  const [shownIn, other] = conditions as [string, string];
  const newPost = feed.locator("article").filter({ hasText: addedText });
  await newPost.getByText("Details").first().click();
  await newPost.getByLabel(shownIn, { exact: true }).check();
  await expect(newPost.getByText(`Only in ${shownIn}`).first()).toBeVisible();
  await page.getByLabel("Condition", { exact: true }).selectOption(other);
  await expect(
    page.getByRole("region", { name: `Feed in ${other}` }).getByText(addedText),
  ).toHaveCount(0);
  await page.getByLabel("Condition", { exact: true }).selectOption(shownIn);

  // Delete a post.
  const third = feed.locator("article").nth(2);
  const thirdText = await third.getByRole("button", { name: /Text of this post/ }).textContent();
  await third.getByText("Details").first().click();
  await third.getByRole("button", { name: "Delete this post" }).click();
  await expect(feed.getByText(thirdText ?? "")).toHaveCount(0);

  // Saving says that participants won't see it yet.
  await page.getByRole("button", { name: "Save as new version" }).click();
  await expect(page.getByText(/Participants won't see it yet/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("saving.png") });
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();

  const v2 = page.getByRole("listitem", { name: "Version 2" });
  const v1 = page.getByRole("listitem", { name: "Version 1" });
  await expect(v2).toBeVisible();
  await expect(v1.getByText("Live")).toBeVisible();
  await expect(v2.getByText("Live")).toHaveCount(0);

  const baseURL = testInfo.project.use.baseURL as string;
  const join = async (target: Page, id: string, username: string) => {
    await target.goto(`${baseURL}/join/eatsnap?PROLIFIC_PID=${id}-${Date.now()}`);
    await target.getByRole("button", { name: "I agree" }).click();
    await target.getByLabel("Username").fill(`${username}_${Date.now() % 100000}`);
    await target.getByLabel("Name", { exact: true }).fill(username);
    await target.getByRole("button", { name: "Save and continue" }).click();
    await target.getByRole("button", { name: "Continue" }).click();
    await target.locator("article").first().waitFor();
  };

  // A new participant still gets the old version, because this one hasn't launched.
  const beforeContext = await browser.newContext();
  const beforeLaunch = await beforeContext.newPage();
  await join(beforeLaunch, "BEFORE", "before");
  expect(await beforeLaunch.getByText(newText).count()).toBe(0);
  await beforeContext.close();

  // The researcher can try the saved version as a test participant first.
  await v2.getByRole("button", { name: "Try as a participant" }).click();
  const [pilot] = await Promise.all([
    context.waitForEvent("page"),
    v2.getByRole("link", { name: "Open as a test participant" }).click(),
  ]);
  await pilot.getByRole("button", { name: "I agree" }).click();
  await pilot.getByLabel("Username").fill(`pilot_${Date.now() % 100000}`);
  await pilot.getByLabel("Name", { exact: true }).fill("Pilot");
  await pilot.getByRole("button", { name: "Save and continue" }).click();
  await pilot.getByRole("button", { name: "Continue" }).click();
  await expect(pilot.getByText(newText)).toBeVisible();
  // The test participant is in the condition the new post is limited to, so the photo must load.
  await expect(
    pilot.locator("article").filter({ hasText: addedText }).locator("img.w-full"),
  ).toHaveJSProperty("naturalWidth", 1);
  await pilot.close();

  // Launching warns, then makes it live.
  await page.screenshot({ path: testInfo.outputPath("studies.png") });
  await v2.getByRole("button", { name: "Launch" }).click();
  await expect(page.getByText(/New participants will get this version/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("launching.png") });
  await page.getByRole("button", { name: "Launch it" }).click();
  await expect(v2.getByText("Live")).toBeVisible();
  await expect(v1.getByText("Live")).toHaveCount(0);
  expect(problems).toEqual([]);

  // Now a new participant gets it, through the real participant app.
  const afterContext = await browser.newContext();
  const participant = await afterContext.newPage();
  await join(participant, "AFTER", "after");
  await expect(participant.getByText(newText)).toBeVisible();
  await expect(participant.getByText("A comment added here")).toBeVisible();
  await expect(participant.getByText(thirdText ?? "")).toHaveCount(0);
  await afterContext.close();

  // What was edited is recorded as such.
  const rows = await database.db
    .select({ provenance: schema.content.provenance, body: schema.content.body })
    .from(schema.content)
    .where(and(eq(schema.content.body, newText), isNull(schema.content.worldId)));
  expect(rows[0]?.provenance).toEqual({ origin: "file", edited: true });
  const added2 = await database.db
    .select({ provenance: schema.content.provenance })
    .from(schema.content)
    .where(eq(schema.content.body, "A comment added here"));
  expect(added2[0]?.provenance).toEqual({ origin: "researcher" });
});
