import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createDb, schema } from "@truman3/db";
import { and, desc, eq } from "drizzle-orm";
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

async function addPost(page: Page, title: string, ups: string, downs: string) {
  await page.getByRole("button", { name: "New post here" }).click();
  // A post has no name of its own until it has a title.
  const empty = page.getByRole("article", { name: /^Post by/ });
  await empty.getByRole("button", { name: /Title of this post/ }).click();
  await empty.getByLabel("Title of this post").fill(title);
  await empty.getByLabel("Title of this post").blur();
  const post = page.getByRole("article", { name: title });
  await post.getByRole("button", { name: /Text of this post/ }).click();
  await post.getByLabel("Text of this post").fill(`About ${title}`);
  await post.getByLabel("Text of this post").blur();
  await post.getByText("Details").first().click();
  await post.getByLabel("Space").first().selectOption({ label: "Cooking" });
  await post.getByLabel("Up votes").first().fill(ups);
  await post.getByLabel("Up votes").first().blur();
  await post.getByLabel("Down votes").first().fill(downs);
  await post.getByLabel("Down votes").first().blur();
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  return post;
}

test("a participant changes the order, karma moves, a notification goes to its comment, and the preview matches", async ({
  page: participant,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const project = testInfo.project.name;
  const stamp = Date.now() % 1_000_000;
  const title = `Controls ${project} ${stamp}`;
  const slug = `controls-${project}-${stamp}`;

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
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
  await casey.getByLabel("Karma").fill("1500");
  await casey.getByLabel("Bio").click();
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await page.getByRole("link", { name: "Feed", exact: true }).click();

  await page.getByRole("link", { name: "Spaces", exact: true }).click();
  await page.getByRole("button", { name: "Add a space" }).click();
  const newSpace = page.getByRole("listitem", { name: "New space" });
  await newSpace.getByLabel("Name", { exact: true }).fill("Cooking");
  await newSpace.getByLabel("Name", { exact: true }).blur();
  const space = page.getByRole("listitem", { name: "Cooking" });
  await space.getByLabel("Description").fill("For people who like to cook.");
  await space.getByLabel("Rules").click();
  await space.getByLabel("Rules").fill("Be kind.\nNo spam.");
  await space.getByLabel("Members of Cooking").click();
  await space.getByLabel("Members of Cooking").fill("1200");
  await space.getByLabel("Members of Cooking").blur();
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await page.getByRole("link", { name: "Feed", exact: true }).click();

  // Two posts, where top and controversial disagree about which comes first.
  await addPost(page, "Agreed", "100", "0");
  const split = await addPost(page, "Split", "40", "38");
  await split.getByLabel("Add a comment").fill("Written first");
  await split.getByRole("button", { name: "Add", exact: true }).click();
  await expect(split.getByText("Written first")).toBeVisible();
  await split.getByLabel("Add a comment").fill("Written second");
  await split.getByRole("button", { name: "Add", exact: true }).click();
  await expect(split.getByText("Written second")).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  const platform = page.getByRole("region", { name: "Study and platform" });
  await platform.getByRole("button", { name: "Add a karma change" }).click();
  await platform.getByRole("button", { name: "Add a karma change" }).click();
  const changes = platform.getByTestId("karma-change");
  await changes.nth(0).getByLabel("Points to add").fill("500");
  await changes.nth(1).getByLabel("Username").fill("casey");
  await changes.nth(1).getByLabel("Points to add").fill("-200");
  await platform.getByRole("button", { name: "Save changes" }).click();
  await expect(platform.getByRole("button", { name: "Save changes" })).toBeDisabled();
  const feed = page.getByRole("region", { name: "Feed" });
  await feed.getByLabel(/^Let people pick how comments/).check();
  await feed.getByLabel(/^Let participants choose the order/).check();
  await feed.getByRole("button", { name: "Save changes" }).click();
  await expect(feed.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.goBack();

  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();

  // The preview lists posts with no comments, and opens one, as a participant's does.
  const previewing = await context.newPage();
  const [versionHref] = await study
    .getByRole("link", { name: "See the feed" })
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  await previewing.goto(`http://localhost:${ADMIN_PORT}${versionHref}`);
  const previewPost = previewing.getByRole("article", { name: "Split" });
  await expect(previewPost.getByText("Written first")).toHaveCount(0);
  await previewPost.getByRole("button", { name: "2 comments" }).click();
  await expect(
    previewing.getByRole("article", { name: "Split" }).getByText("Written first"),
  ).toBeVisible();
  await expect(previewing.getByRole("article", { name: "Agreed" })).toHaveCount(0);
  await previewing.getByRole("button", { name: "Back to the feed" }).click();
  await expect(previewing.getByRole("article", { name: "Agreed" })).toBeVisible();
  await previewing.close();

  await participant.goto(`http://localhost:${APP_PORT}/join/${slug}?PROLIFIC_PID=C-${stamp}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  const username = `controls_${stamp}`;
  await participant.getByLabel("Username").fill(username);
  await participant.getByLabel("Name", { exact: true }).fill("Controls Person");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  // The study's order to start, which is the template's.
  const articles = participant.getByRole("article");
  await expect(articles.first()).toHaveAccessibleName("Agreed");
  await shot(participant, project, "6-feed-with-sidebar");

  // Choosing an order changes the list, and survives a reload.
  await participant.getByLabel("Sort").selectOption("controversial");
  await expect(articles.first()).toHaveAccessibleName("Split");
  await participant.reload();
  await expect(participant.getByLabel("Sort")).toHaveValue("controversial");
  await expect(articles.first()).toHaveAccessibleName("Split");

  // Comments, on the post's own page.
  await articles.first().getByRole("link", { name: "2 comments" }).click();
  const comments = () => participant.getByRole("article", { name: "Split" }).locator("li");
  await participant.getByLabel("Sort comments").selectOption("best");
  await expect(participant.getByLabel("Sort comments")).toHaveValue("best");
  // Written at the same moment, with no votes, so ties decide. A vote then moves the lower one up.
  const lower = comments().last();
  const lowerText = (await lower.textContent())?.includes("Written first")
    ? "Written first"
    : "Written second";
  await lower.getByRole("button", { name: "Vote up" }).click();
  await expect(comments().first()).toContainText(lowerText);
  await participant.reload();
  await expect(participant.getByLabel("Sort comments")).toHaveValue("best");
  await expect(comments().first()).toContainText(lowerText);

  // A community's count goes up and down with this person.
  await participant
    .getByRole("article", { name: "Split" })
    .getByRole("link", { name: "Cooking" })
    .click();
  const community = participant.getByRole("region", { name: "Cooking" });
  await expect(community.getByTestId("member-count")).toHaveText("1,201 members");
  await expect(participant.getByText("Be kind.")).toBeVisible({ visible: project === "desktop" });
  await shot(participant, project, "7-community");
  await community.getByRole("button", { name: "Leave" }).click();
  await expect(community.getByTestId("member-count")).toHaveText("1,200 members");
  await community.getByRole("button", { name: "Join" }).click();
  await expect(community.getByTestId("member-count")).toHaveText("1,201 members");

  // Write something, for karma and a notification to be about.
  await participant.goto(`http://localhost:${APP_PORT}/`);
  await participant.getByRole("button", { name: /Create a post/ }).click();
  const dialog = participant.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Mine");
  await dialog.getByLabel("Write a post").fill("My post");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  const mine = participant.getByRole("article", { name: "Mine" });
  await expect(mine.getByTestId("karma")).toHaveText("0 karma");
  const agreed = participant.getByRole("article", { name: "Agreed" });
  await expect(agreed.getByTestId("karma")).toHaveText("1,500 karma");

  // An hour and more later, karma has moved for both, as the study scripted.
  const { db } = database;
  const [me] = await db
    .select({ id: schema.actors.id, worldId: schema.actors.worldId })
    .from(schema.actors)
    .where(eq(schema.actors.username, username));
  await db
    .update(schema.worlds)
    .set({ startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
    .where(eq(schema.worlds.id, me?.worldId as string));
  await participant.reload();
  await expect(mine.getByTestId("karma")).toHaveText("500 karma");
  await expect(agreed.getByTestId("karma")).toHaveText("1,300 karma");

  // A reply notification goes to that reply, on the post's own page.
  const [post] = await db
    .select({ id: schema.content.id, authorActorId: schema.content.authorActorId })
    .from(schema.content)
    .where(and(eq(schema.content.title, "Split"), eq(schema.content.kind, "post")))
    .orderBy(desc(schema.content.createdAt))
    .limit(1);
  const [reply] = await db
    .select({ id: schema.content.id })
    .from(schema.content)
    .where(eq(schema.content.parentId, post?.id as string))
    .limit(1);
  await db.insert(schema.notifications).values({
    worldId: me?.worldId as string,
    recipientActorId: me?.id as string,
    actorId: post?.authorActorId as string,
    type: "reply",
    targetContentId: post?.id as string,
    replyContentId: reply?.id as string,
    dueAt: new Date(Date.now() - 1000),
  });
  await participant.reload();
  await participant.getByRole("link", { name: /Notifications, 1 new/ }).click();
  await shot(participant, project, "8-notifications");
  await participant.getByRole("link", { name: /replied/ }).click();
  await expect(participant).toHaveURL(new RegExp(`/p/${post?.id}#comment-${reply?.id}`));
  await expect(participant.locator(`[id="comment-${reply?.id}"]`)).toBeInViewport();
  await shot(participant, project, "9-post-with-sidebar");

  // Each of those is in the data.
  const types = await db
    .select({ type: schema.events.type, payload: schema.events.payload })
    .from(schema.events)
    .where(eq(schema.events.worldId, me?.worldId as string))
    .orderBy(desc(schema.events.id));
  expect(types.find(({ type }) => type === "feed.sort_changed")?.payload).toMatchObject({
    sort: "controversial",
  });
  expect(types.find(({ type }) => type === "comments.sort_changed")?.payload).toMatchObject({
    sort: "best",
  });
  await expect
    .poll(async () => {
      const opened = await db
        .select({ payload: schema.events.payload })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.worldId, me?.worldId as string),
            eq(schema.events.type, "content.opened"),
          ),
        )
        .orderBy(desc(schema.events.id))
        .limit(1);
      return (opened[0]?.payload as { from?: string } | undefined)?.from;
    })
    .toBe("notifications");
  await context.close();
});
