import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createDb, schema } from "@truman3/db";
import { desc, eq } from "drizzle-orm";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { databaseUrl, otherLabEmail, otherLabPassword } = JSON.parse(
  readFileSync(STATE_FILE, "utf8"),
) as { databaseUrl: string; otherLabEmail: string; otherLabPassword: string };
const database = createDb(databaseUrl);

test.afterAll(async () => {
  await database.close();
});

test.use({ actionTimeout: 15_000 });

const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${project}-${name}.png`) });
  }
};

const eventTypes = async () =>
  (
    await database.db
      .select({ type: schema.events.type })
      .from(schema.events)
      .orderBy(desc(schema.events.id))
      .limit(200)
  ).map(({ type }) => type);

const saved = (page: Page) =>
  expect(page.getByTestId("save-status")).toHaveText("All changes saved");

async function addPost(page: Page, title: string) {
  await page.getByRole("button", { name: "New post here" }).click();
  const empty = page.getByRole("article", { name: /^Post by/ });
  await empty.getByRole("button", { name: /Title of this post/ }).click();
  await empty.getByLabel("Title of this post").fill(title);
  await empty.getByLabel("Title of this post").blur();
  const post = page.getByRole("article", { name: title });
  await post.getByText("Details").first().click();
  return post;
}

test("a researcher writes polls, flair, and crossposts, and a participant uses them", async ({
  page: participant,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name;
  const stamp = Date.now() % 1_000_000;
  const title = `Polls ${project} ${stamp}`;
  const slug = `polls-${project}-${stamp}`;

  const researcher = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await researcher.newPage();
  await page.goto(`http://localhost:${ADMIN_PORT}`);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /^Forum/ }).check();
  await page.getByRole("radio", { name: /Start with nothing/ }).check();
  await page.getByRole("radio", { name: /^Blocked/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();

  // Two communities, with flair.
  await page.getByRole("link", { name: "Spaces", exact: true }).click();
  const addSpace = async (name: string) => {
    await page.getByRole("button", { name: "Add a space" }).click();
    const added = page.getByRole("listitem", { name: "New space" });
    await added.getByLabel("Name").fill(name);
    await added.getByLabel("Name").blur();
    await saved(page);
    return page.getByRole("listitem", { name });
  };
  const cooking = await addSpace("Cooking");
  await addSpace("Garden");
  await cooking.getByLabel("New flair for On posts", { exact: true }).fill("Question");
  await cooking.getByRole("button", { name: "Add", exact: true }).first().click();
  await saved(page);
  await expect(
    cooking.getByRole("button", { name: "Remove Question from On posts" }),
  ).toBeVisible();
  await cooking.getByLabel("Posts participants write here have to have flair").check();
  await saved(page);
  await cooking.getByLabel("New flair for On people", { exact: true }).fill("Chef");
  await cooking.getByRole("button", { name: "Add", exact: true }).last().click();
  await saved(page);
  await page.getByRole("link", { name: "Back to the feed" }).click();

  // Someone in the cast, who has flair.
  await page.getByRole("link", { name: "Add someone to the cast first" }).click();
  await page.getByRole("button", { name: "Add a person" }).click();
  const added = page.getByRole("listitem", { name: "New person" });
  await added.getByLabel("Name", { exact: true }).fill("Casey Jones");
  await added.getByLabel("Name", { exact: true }).blur();
  const casey = page.getByRole("listitem", { name: "Casey Jones" });
  await casey.getByLabel("Flair in Cooking").selectOption("Chef");
  await saved(page);
  await page.getByRole("link", { name: "Back to the feed" }).click();

  // A poll with starting counts, whose results wait for a vote.
  const polled = await addPost(page, "Which pan");
  await polled.getByRole("combobox", { name: "Space" }).selectOption({ label: "Cooking" });
  await saved(page);
  await polled.getByRole("combobox", { name: "Flair" }).selectOption("Question");
  await saved(page);
  await polled.getByRole("button", { name: "Add a poll" }).click();
  await saved(page);
  await polled.getByLabel("Poll option 1").fill("Cast iron");
  await polled.getByLabel("Poll option 1").blur();
  await saved(page);
  await polled.getByLabel("Poll option 2").fill("Steel");
  await polled.getByLabel("Poll option 2").blur();
  await saved(page);
  await polled.getByLabel("Starting votes for option 1").fill("30");
  await polled.getByLabel("Starting votes for option 1").blur();
  await saved(page);
  await polled.getByLabel("Starting votes for option 2").fill("10");
  await polled.getByLabel("Starting votes for option 2").blur();
  await saved(page);

  // A scripted crosspost of it, in the other community.
  const copied = await addPost(page, "Seen in Cooking");
  await copied.getByRole("combobox", { name: "Space" }).selectOption({ label: "Garden" });
  await saved(page);
  await copied.getByRole("combobox", { name: "Crosspost of" }).selectOption({ index: 1 });
  await saved(page);
  await expect(copied.getByTestId("crosspost-original")).toContainText("Which pan");

  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();
  await researcher.close();

  const app = `http://localhost:${APP_PORT}`;
  await participant.goto(`${app}/join/${slug}?PROLIFIC_PID=POLLS-${project}-${stamp}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`polls_${project}_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Someone");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  const poll = participant.getByRole("article", { name: "Which pan" });
  await expect(poll.getByTestId("post-flair")).toHaveText("Question");
  await expect(poll.getByTestId("author-flair")).toHaveText("Chef");
  await expect(poll.getByText("See the results after you vote.")).toBeVisible();
  await expect(poll.getByText("%")).toHaveCount(0);
  await shot(participant, project, "polls-1-before-vote");

  // Voting shows results, and there's no way to vote again.
  await poll.getByRole("button", { name: "Steel" }).click();
  await expect(poll.getByText("(your vote)")).toBeVisible();
  await expect(poll.getByText("27% · 11")).toBeVisible();
  await expect(poll.getByRole("button", { name: /Cast iron/ })).toHaveCount(0);
  await expect.poll(eventTypes).toContain("content.poll_voted");
  await shot(participant, project, "polls-2-after-vote");

  // A scripted crosspost shows where it came from.
  const scripted = participant.getByRole("article", { name: "Seen in Cooking" });
  const original = scripted.getByTestId("crosspost-original");
  await expect(original).toContainText("Which pan");
  await expect(original).toContainText("Cooking");
  await scripted.scrollIntoViewIfNeeded();
  await shot(participant, project, "polls-3-crosspost");

  // Less-used buttons are behind More on a phone, and all of them work from there.
  const more = poll.getByRole("button", { name: "More" });
  const phone = project !== "desktop";
  await expect(more).toHaveCount(phone ? 1 : 0);
  if (phone) {
    await expect(poll.getByRole("button", { name: "Crosspost" })).toHaveCount(0);
    await more.focus();
    await participant.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await shot(participant, project, "polls-4-more-open");
    await poll.getByRole("button", { name: "Save", exact: true }).focus();
    await participant.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toBeFocused();
    await more.click();
  }
  await poll.getByRole("button", { name: "Crosspost" }).click();

  // Crossposting: only other communities they've joined.
  const dialog = participant.getByRole("dialog", { name: "Crosspost" });
  await expect(dialog.getByRole("option", { name: "Cooking" })).toHaveCount(0);
  await dialog.getByLabel("Community").selectOption({ label: "Garden" });
  await dialog.getByLabel("Title").fill("You have to see this");
  await shot(participant, project, "polls-5-crosspost-dialog");
  await dialog.getByRole("button", { name: "Crosspost" }).click();
  await expect(dialog).toHaveCount(0);
  const mine = participant.getByRole("article", { name: "You have to see this" });
  await expect(mine.getByTestId("crosspost-original")).toContainText("Which pan");
  await expect(mine.getByTestId("post-space")).toContainText("Garden");

  const [row] = await database.db
    .select({ crosspostOf: schema.content.crosspostOf, worldId: schema.content.worldId })
    .from(schema.content)
    .where(eq(schema.content.title, "You have to see this"))
    .orderBy(desc(schema.content.createdAt))
    .limit(1);
  expect(row?.crosspostOf).toBeTruthy();
  expect(row?.worldId).toBeTruthy();

  // A required flair, and a poll of their own.
  await participant.getByRole("button", { name: /Create a post/ }).click();
  const writing = participant.getByRole("dialog", { name: "Add a New Post" });
  await writing.getByLabel("Community").selectOption({ label: "Cooking" });
  await writing.getByLabel("Title").fill("My own poll");
  await writing.getByRole("button", { name: "Add a poll" }).click();
  await writing.getByLabel("Option 1", { exact: true }).fill("Yes");
  await expect(writing.getByText("A poll needs")).toBeVisible();
  await expect(writing.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  await writing.getByLabel("Option 2", { exact: true }).fill("No");
  await writing.getByLabel("Flair").selectOption("Question");
  await shot(participant, project, "polls-6-composer");
  await writing.getByRole("button", { name: "Post", exact: true }).click();
  const ownPoll = participant.getByRole("article", { name: "My own poll" });
  await expect(ownPoll.getByRole("button", { name: "Yes" })).toBeVisible();
  await expect(ownPoll.getByTestId("post-flair")).toHaveText("Question");

  // Choosing their own flair from the community's list.
  await participant.goto(`${app}/spaces/cooking`);
  await participant.getByLabel("Your flair").first().selectOption("Chef");
  await expect.poll(eventTypes).toContain("space.flair_chosen");
  await expect(
    participant.getByRole("article", { name: "My own poll" }).getByTestId("author-flair"),
  ).toHaveText("Chef");
  await shot(participant, project, "polls-7-space-page");
});
