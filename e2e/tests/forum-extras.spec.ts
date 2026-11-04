import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
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

/** Opens a post's details in the builder, and gives its text a title. */
async function addPost(page: Page, title: string): Promise<Locator> {
  await page.getByRole("button", { name: "New post here" }).click();
  const empty = page.getByRole("article", { name: /^Post by/ });
  await empty.getByRole("button", { name: /Title of this post/ }).click();
  await empty.getByLabel("Title of this post").fill(title);
  await empty.getByLabel("Title of this post").blur();
  const post = page.getByRole("article", { name: title });
  await post.getByText("Details").first().click();
  return post;
}

const saved = (page: Page) =>
  expect(page.getByTestId("save-status")).toHaveText("All changes saved");

test("a researcher writes links, pins, locks, and tags, and a participant uses all of them", async ({
  page: participant,
  browser,
  context: participantContext,
}, testInfo) => {
  test.setTimeout(150_000);
  const project = testInfo.project.name;
  const stamp = Date.now() % 1_000_000;
  const title = `Extras ${project} ${stamp}`;
  const slug = `extras-${project}-${stamp}`;

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

  await page.getByRole("link", { name: "Add someone to the cast first" }).click();
  await page.getByRole("button", { name: "Add a person" }).click();
  const added = page.getByRole("listitem", { name: "New person" });
  await added.getByLabel("Name", { exact: true }).fill("Casey Jones");
  await added.getByLabel("Name", { exact: true }).blur();
  const casey = page.getByRole("listitem", { name: "Casey Jones" });
  await casey.getByLabel("Username").fill("casey");
  await casey.getByLabel("Bio").click();
  await expect(casey.getByLabel("Username")).toHaveValue("casey");
  await saved(page);
  await page.getByRole("link", { name: "Back to the feed" }).click();

  // A title by itself is a post.
  await addPost(page, "Only a title");
  await saved(page);

  const linked = await addPost(page, "Worth reading");
  await linked.getByLabel("Link", { exact: true }).fill("javascript:alert(1)");
  await linked.getByLabel("Link", { exact: true }).blur();
  await expect(linked.getByText("Use a full http or https address")).toBeVisible();
  await linked.getByLabel("Link", { exact: true }).fill("https://www.example.org/story");
  await linked.getByLabel("Link", { exact: true }).blur();
  await saved(page);
  await expect(linked.getByRole("link", { name: /example\.org/ })).toBeVisible();

  const pinned = await addPost(page, "Read this first");
  await pinned.getByLabel("The home feed").check();
  await saved(page);

  const locked = await addPost(page, "No more comments");
  await locked.getByLabel(/^Locked/).check();
  await saved(page);

  const spoiler = await addPost(page, "The ending");
  await spoiler.getByRole("button", { name: /Text of this post/ }).click();
  await spoiler.getByLabel("Text of this post").fill("They all lived.");
  await spoiler.getByLabel("Text of this post").blur();
  await spoiler.getByLabel(/^Spoiler/).check();
  await saved(page);
  // Someone editing it still sees what it says.
  await expect(spoiler.getByText("They all lived.")).toBeVisible();

  // Adult tags are off in Forum until a study turns them on.
  await expect(spoiler.getByLabel(/^Adult content/)).toHaveCount(0);

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
  await participantContext.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: app,
  });
  await participant.goto(`${app}/join/${slug}?PROLIFIC_PID=EXTRAS-${project}-${stamp}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`extras_${project}_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Someone");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  // Pinned goes first, whatever the order.
  const articles = participant.getByRole("article");
  await expect(articles.first()).toHaveAccessibleName("Read this first");
  await expect(articles.first().getByText("Pinned")).toBeVisible();
  await shot(participant, project, "extras-1-feed");

  // A link goes elsewhere safely, and clicking it is recorded.
  const link = participant
    .getByRole("article", { name: "Worth reading" })
    .getByRole("link", { name: /example\.org/ });
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("href", "https://www.example.org/story");
  await participantContext.route("https://www.example.org/**", (route) =>
    route.fulfill({ status: 200, body: "elsewhere" }),
  );
  const [opened] = await Promise.all([participantContext.waitForEvent("page"), link.click()]);
  await opened.close();
  await expect.poll(eventTypes).toContain("content.link_opened");

  // A spoiler stays covered until it's clicked.
  const covered = participant.getByRole("article", { name: "The ending" });
  await expect(covered.getByText("They all lived.")).toHaveCount(0);
  await shot(participant, project, "extras-2-covered");
  await covered.getByRole("button", { name: /Spoiler/ }).click();
  await expect(covered.getByText("They all lived.")).toBeVisible();
  await expect.poll(eventTypes).toContain("content.revealed");

  // On a phone, the less-used buttons are behind More.
  const openMore = async (post: Locator) => {
    const more = post.getByRole("button", { name: "More" });
    if (await more.isVisible()) {
      await more.click();
    }
  };

  // Share says it copied, and the link is to that post.
  await openMore(covered);
  await covered.getByRole("button", { name: "Share" }).click();
  await expect(covered.getByRole("button", { name: "Link copied" })).toBeVisible();
  const copied = await participant.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(new RegExp(`^${app}/p/[0-9a-f-]+$`));
  await expect.poll(eventTypes).toContain("content.shared");

  // Someone with no session who opens it sees nothing of the study's posts.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(copied);
  await expect(strangerPage.getByText("They all lived.")).toHaveCount(0);
  await expect(strangerPage.getByText("The ending")).toHaveCount(0);
  await stranger.close();

  // Saving and hiding.
  const reading = participant.getByRole("article", { name: "Worth reading" });
  await openMore(reading);
  await reading.getByRole("button", { name: "Save", exact: true }).click();
  await expect(reading.getByRole("button", { name: "Saved" })).toBeVisible();
  const titleOnly = participant.getByRole("article", { name: "Only a title" });
  await openMore(titleOnly);
  await titleOnly.getByRole("button", { name: "Hide" }).click();
  await expect(participant.getByRole("article", { name: "Only a title" })).toHaveCount(0);
  await participant.reload();
  await expect(articles.first()).toHaveAccessibleName("Read this first");
  await expect(participant.getByRole("article", { name: "Only a title" })).toHaveCount(0);

  // A locked post has no way to comment.
  await participant
    .getByRole("article", { name: "No more comments" })
    .getByRole("link", { name: "0 comments" })
    .click();
  const lockedPage = participant.getByRole("article", { name: "No more comments" });
  await expect(lockedPage.getByText("Locked", { exact: true })).toBeVisible();
  await expect(lockedPage.getByLabel("Write a comment")).toHaveCount(0);
  await expect(lockedPage.getByRole("button", { name: "Reply" })).toHaveCount(0);
  await expect(lockedPage.getByText("This post is locked")).toBeVisible();
  await shot(participant, project, "extras-3-locked");

  // Lists on their own profile, and hiding can be undone there.
  await participant.goto(`${app}/u/extras_${project}_${stamp}`);
  const lists = participant.getByRole("region", { name: "Your saved and hidden posts" });
  await lists.getByRole("button", { name: "Saved" }).click();
  await expect(lists.getByRole("article", { name: "Worth reading" })).toBeVisible();
  // An open list takes the place of their own posts, so nothing says there's nothing to show.
  await expect(participant.getByText("No posts to show.")).toHaveCount(0);
  await shot(participant, project, "extras-4-saved");
  await lists.getByRole("button", { name: "Hidden" }).click();
  const hidden = lists.getByRole("article", { name: "Only a title" });
  await expect(hidden).toBeVisible();
  await openMore(hidden);
  await hidden.getByRole("button", { name: "Unhide" }).click();
  await expect(hidden).toHaveCount(0);
  await participant.goto(app);
  await expect(participant.getByRole("article", { name: "Only a title" })).toBeVisible();

  // Writing one: just a title and a link, tagged as a spoiler.
  const open = participant.getByRole("button", { name: /Create a post/ });
  await open.click();
  const dialog = participant.getByRole("dialog");
  await dialog.getByLabel("Title").fill("My find");
  await expect(dialog.getByRole("button", { name: "Post", exact: true })).toBeEnabled();
  await dialog.getByLabel("Link").fill("nope");
  await expect(dialog.getByText("Use a full address")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  await dialog.getByLabel("Link").fill("https://example.com/find");
  await dialog.getByLabel("Spoiler").check();
  await shot(participant, project, "extras-5-composer");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  const mine = participant.getByRole("article", { name: "My find" });
  await expect(mine.getByRole("button", { name: /Spoiler/ })).toBeVisible();

  const [row] = await database.db
    .select({ linkUrl: schema.content.linkUrl, tags: schema.content.tags })
    .from(schema.content)
    .where(eq(schema.content.title, "My find"))
    .orderBy(desc(schema.content.createdAt))
    .limit(1);
  expect(row).toEqual({ linkUrl: "https://example.com/find", tags: ["spoiler"] });
});
