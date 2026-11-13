import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

/** Where to keep pictures of what this looks like, when someone asks for them. */
const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${project}-${name}.png`) });
  }
};

/** A picture made in the browser, so this test can use one that's a real size. */
async function picture(page: Page, name: string, width: number, height: number, hue: number) {
  const dataUrl = await page.evaluate(
    ([w, h, color]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w as number;
      canvas.height = h as number;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      const gradient = context.createLinearGradient(0, 0, w as number, h as number);
      gradient.addColorStop(0, `hsl(${color}, 70%, 45%)`);
      gradient.addColorStop(1, `hsl(${(color as number) + 40}, 70%, 70%)`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, w as number, h as number);
      return canvas.toDataURL("image/png");
    },
    [width, height, hue],
  );
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.split(",")[1] as string, "base64"),
  };
}

/** Builds and launches a whole study from the New Study page, always on a big screen. */
async function buildStudy(browser: Browser, title: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(ADMIN);
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
  await expect(space.getByLabel("Description")).toHaveValue("For people who like to cook.");
  await space
    .getByLabel("Banner of Cooking")
    .setInputFiles(await picture(page, "banner.png", 1200, 240, 15));
  await expect(space.getByRole("button", { name: "Remove banner" })).toBeVisible();
  await space.getByLabel("Color of Cooking").fill("#b45309");
  await space.getByLabel("Color of Cooking").blur();
  await expect(space.getByRole("button", { name: "Remove color" })).toBeVisible();
  await page.getByRole("link", { name: "Feed", exact: true }).click();

  // With no title yet, the builder says so, and doesn't stop anyone.
  await page.getByRole("button", { name: "New post here" }).click();
  await page.getByText(/to check$/).click();
  await expect(page.getByText(/Titles are on in "control", but 1 posts/)).toBeVisible();
  const post = page.locator("article").first();
  await post.getByRole("button", { name: /Title of this post/ }).click();
  await post.getByLabel("Title of this post").fill("What's the best way to sear a steak?");
  await post.getByLabel("Title of this post").blur();
  await expect(post.getByRole("button", { name: /Title of this post: What/ })).toBeVisible();
  await post.getByRole("button", { name: /Text of this post/ }).click();
  await post
    .getByLabel("Text of this post")
    .fill("I keep getting a gray band under the crust. Hotter pan? Longer rest?");
  await post.getByLabel("Text of this post").blur();
  await post.getByTestId("image-drop").hover();
  await post.getByLabel("Choose a photo").setInputFiles(await picture(page, "a.png", 800, 500, 30));
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await post.getByText("Details").first().click();
  await post.getByLabel("Space").first().selectOption({ label: "Cooking" });
  await post.getByLabel("Up votes").first().fill("42");
  await post.getByLabel("Up votes").first().blur();
  await expect(post.getByTestId("score").first()).toContainText("42");
  await post.getByLabel("Add a comment").fill("Dry it first, and don't crowd the pan.");
  await post.getByRole("button", { name: "Add", exact: true }).click();
  await expect(post.getByText("Dry it first")).toBeVisible();

  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();
  return { page, study, context };
}

test("a study is built as a forum, and a participant votes, opens a post, and replies", async ({
  page: participant,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name;
  const stamp = Date.now() % 1_000_000;
  const title = `Forum ${project} ${stamp}`;
  const slug = `forum-${project}-${stamp}`;
  const researcher = await buildStudy(browser, title);

  const problems: string[] = [];
  participant.on("pageerror", (error) => problems.push(error.message));

  await participant.goto(`http://localhost:${APP_PORT}/join/${slug}?PROLIFIC_PID=F-${stamp}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`forum_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Forum Person");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  // In the list: a card, with its title and a count, and no comments.
  const card = participant.getByRole("article", { name: /sear a steak/ });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("post-space")).toContainText("Cooking");
  await expect(card.getByTestId("karma")).toHaveText("1,500 karma");
  await expect(card.getByText("Dry it first")).toHaveCount(0);
  await expect(card.getByRole("link", { name: "1 comment" })).toBeVisible();
  await expect(card.getByRole("button", { name: /Like/ })).toHaveCount(0);
  await expect
    .poll(() =>
      card
        .locator("img")
        .evaluateAll((images) =>
          images.some((image) => (image as HTMLImageElement).naturalWidth > 100),
        ),
    )
    .toBe(true);
  await shot(participant, project, "1-feed");

  // Voting works from the list.
  await card.getByRole("button", { name: "Vote up" }).click();
  await expect(card.getByTestId("score")).toContainText("43");

  // Writing a post needs a title, and can go in a community.
  await participant.getByRole("button", { name: /Create a post/ }).click();
  const dialog = participant.getByRole("dialog");
  await dialog.getByLabel("Write a post").fill("Mine, with no title yet");
  await expect(dialog.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
  await dialog.getByLabel("Title").fill("My first post");
  await dialog.getByLabel("Community").selectOption({ label: "Cooking" });
  await shot(participant, project, "2-new-post");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  const mine = participant.getByRole("article", { name: "My first post" });
  await expect(mine).toBeVisible();
  await expect(mine.getByTestId("karma")).toHaveText("0 karma");

  // Opening the post shows its comments, and a box for writing one.
  await card.getByRole("link", { name: /sear a steak/ }).click();
  await expect(participant).toHaveURL(/\/p\//);
  const opened = participant.getByRole("article", { name: /sear a steak/ });
  await expect(opened.getByText("Dry it first")).toBeVisible();
  await shot(participant, project, "3-post");

  await opened.getByRole("button", { name: "Reply" }).last().click();
  await expect(opened.getByText(/Replying to Casey Jones/)).toBeVisible();
  await opened.getByLabel("Write a comment").fill("A reply from me");
  await opened.getByLabel("Write a comment").press("Enter");
  const reply = opened.locator("li").filter({ hasText: "A reply from me" });
  await expect(reply).toBeVisible();
  await expect(reply).toHaveCSS("margin-left", /[1-9]/);
  await shot(participant, project, "4-replied");

  // Its community has its own look, with its banner, and text that can be read.
  await opened.getByRole("link", { name: "Cooking" }).click();
  const community = participant.getByRole("region", { name: "Cooking" });
  await expect(community.locator("img").first()).toBeVisible();
  await expect
    .poll(() =>
      community
        .locator("img")
        .first()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(100);
  await shot(participant, project, "5-community");

  // Its color is on its Join button, with text chosen to be readable on it.
  await community.getByRole("button", { name: "Leave" }).click();
  const joining = community.getByRole("button", { name: "Join" });
  await expect(joining).toHaveCSS("background-color", "rgb(180, 83, 9)");
  await expect(joining).toHaveCSS("color", "rgb(255, 255, 255)");
  // Nothing has been cut off at this size.
  const overflow = await participant.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The team sees what happened.
  await researcher.study.getByRole("link", { name: "Monitor and download" }).click();
  await expect(
    researcher.page
      .getByRole("region", { name: "By condition" })
      .getByRole("row", { name: /control/ }),
  ).toContainText("1");
  await researcher.context.close();
  expect(problems).toEqual([]);
});
