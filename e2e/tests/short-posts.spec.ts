import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

const { otherLabEmail, otherLabPassword } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../.e2e-state.json"), "utf8"),
) as { otherLabEmail: string; otherLabPassword: string };

const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `short-${project}-${name}.png`) });
  }
};

test("tabs, following, reposts, quotes, a limit, and badges", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const app = `http://localhost:${APP_PORT}`;
  await page.goto(`${app}/join/short-posts-e2e?PROLIFIC_PID=SHORT-${project}-${Date.now()}`);

  // The study renamed its main tab, and a chain of reposts shows who passed it on.
  const tabs = page.getByRole("tablist", { name: "Feeds" });
  await expect(tabs.getByRole("tab", { name: "Everything" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("reposted-by").first()).toContainText("Ann reposted, via Cleo");
  await expect(page.getByTestId("quoted-post").first()).toContainText("The story that spreads");
  await expect(page.getByTestId("author-badge").first()).toHaveText("Journalist");
  await expect(page.getByText("A post by someone unfollowed")).toBeVisible();
  await shot(page, project, "1-feed");

  // The following tab only has those they start out following.
  await tabs.getByRole("tab", { name: "Following" }).click();
  await expect(page.getByText("My own take on it")).toBeVisible();
  await expect(page.getByText("A post by someone unfollowed")).toHaveCount(0);

  // Following someone changes it.
  await page.goto(`${app}/u/bob`);
  const counts = page.getByTestId("follow-counts");
  await expect(counts).toContainText("12 following");
  await expect(counts).toContainText("40 followers");
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(counts).toContainText("41 followers");
  await page.goto(app);
  await page
    .getByRole("tablist", { name: "Feeds" })
    .getByRole("tab", { name: "Following" })
    .click();
  await expect(page.getByText("A post by someone unfollowed")).toBeVisible();

  // Passing something along, on the post rather than whoever's repost it was seen through.
  const repostOfStory = page
    .getByRole("article")
    .filter({ has: page.getByTestId("reposted-by") })
    .first();
  await expect(repostOfStory.getByRole("button", { name: /Repost/ })).toContainText("(9)");
  await repostOfStory.getByRole("button", { name: /Repost/ }).click();
  await expect(page.getByRole("button", { name: /Reposted/ }).first()).toContainText("(10)");

  // Quoting, within the limit the study set.
  const open = page.getByRole("article").filter({ hasText: "A post by someone unfollowed" });
  const more = open.getByRole("button", { name: "More" });
  if (await more.isVisible()) {
    await more.click();
  }
  await open.getByRole("button", { name: /^Quote/ }).click();
  const quoting = page.getByRole("dialog", { name: "Quote this post" });
  await quoting.getByLabel("What do you want to say?").fill("x".repeat(50));
  await expect(quoting.getByTestId("length-left")).toContainText("-10 characters left");
  await expect(quoting.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  await quoting.getByLabel("What do you want to say?").fill("Agreed");
  await shot(page, project, "2-quote");
  await quoting.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("Agreed")).toBeVisible();

  // Writing a post brings the scripted repost and follow.
  await page.getByRole("button", { name: /Create a post/ }).click();
  const dialog = page.getByRole("dialog", { name: "Add a New Post" });
  await dialog.getByLabel("Write a post").fill("My first short post");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("My first short post").first()).toBeVisible();
  await page.goto(`${app}/notifications`);
  await expect(page.getByText("Ann reposted your post")).toBeVisible();
  await expect(page.getByText("Cleo followed you")).toBeVisible();
  await shot(page, project, "3-notifications");
});

test("a researcher builds a short posts study, with a repost and a badge", async ({
  page: participant,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const project = testInfo.project.name;
  const stamp = Date.now() % 1_000_000;
  const title = `Short ${project} ${stamp}`;
  const slug = `short-${project}-${stamp}`;

  const researcher = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await researcher.newPage();
  const saved = () => expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await page.goto(`http://localhost:${ADMIN_PORT}`);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /^Short posts/ }).check();
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
  await casey.getByLabel("Badge (a label you write)").fill("Verified expert");
  await casey.getByLabel("Followers").click();
  await casey.getByLabel("Followers").fill("500");
  await casey.getByLabel("Followers").blur();
  await casey.getByLabel("Participants start out following them").check();
  await saved();
  await page.getByRole("link", { name: "Back to the feed" }).click();

  const feed = page.getByRole("main").or(page.locator("body")).first();
  await page.getByRole("button", { name: "New post here" }).click();
  await expect(feed.locator("article")).toHaveCount(1);
  const firstPost = feed.locator("article").first();
  await firstPost.getByRole("button", { name: /Text of this post/ }).click();
  await firstPost.getByLabel("Text of this post").fill("The first thing Casey said");
  await firstPost.getByLabel("Text of this post").blur();
  await saved();

  await page.getByRole("button", { name: "New post here" }).click();
  await expect(feed.locator("article")).toHaveCount(2);
  await saved();
  const second = page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: /Text of this post/ }) })
    .filter({ hasText: "Click to write something" })
    .first();
  await second.getByText("Details").first().click();
  await second.getByRole("combobox", { name: "Repost of" }).selectOption({ index: 1 });
  await saved();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("The most a participant can write in a post or comment").fill("100");
  const platform = page.getByRole("region", { name: "Study and platform" });
  await platform.getByRole("button", { name: "Save changes" }).click();
  await expect(platform.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.getByRole("link", { name: "Back to the feed" }).click();

  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const listed = page.getByRole("listitem").filter({ hasText: title }).first();
  await listed.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(listed.getByText("Open to participants")).toBeVisible();
  await researcher.close();

  await participant.goto(
    `http://localhost:${APP_PORT}/join/${slug}?PROLIFIC_PID=B-${project}-${stamp}`,
  );
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`short_${project}_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Someone");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  await expect(participant.getByTestId("reposted-by").first()).toContainText(
    "Casey Jones reposted",
  );
  await expect(participant.getByTestId("author-badge").first()).toHaveText("Verified expert");
  await participant.getByRole("tab", { name: "Following" }).click();
  await expect(participant.getByText("The first thing Casey said").first()).toBeVisible();
  await participant.goto(`http://localhost:${APP_PORT}/u/casey`);
  await expect(participant.getByTestId("follow-counts")).toContainText("501 followers");
});
