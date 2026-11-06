import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ADMIN_PORT, APP_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

async function signIn(page: Page) {
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
}

async function startStudy(page: Page, title: string, chooseStart: () => Promise<void>) {
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await chooseStart();
  // There's no default for how people are assigned.
  await expect(page.getByRole("button", { name: "Start the study" })).toBeDisabled();
  await page.getByRole("radio", { name: /^Blocked/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await expect(page.getByRole("button", { name: "Save as new version" })).toBeVisible();
}

async function saveAndLaunch(page: Page) {
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
}

test("someone builds a study from nothing, with no terminal, and a participant joins it", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `From nothing ${stamp}`;
  const slug = `from-nothing-${stamp}`;

  await signIn(page);
  await startStudy(page, title, async () => {
    await expect(page.getByLabel("Link name")).toHaveValue(slug);
    await page.getByRole("radio", { name: /Start with nothing/ }).check();
  });

  // There's nobody to write a post yet, so it says so.
  await page.getByRole("link", { name: "Add someone to the cast first" }).click();
  await expect(page.getByText("Nobody yet")).toBeVisible();

  await page.getByRole("button", { name: "Add a person" }).click();
  const person = page.getByRole("listitem", { name: "New person" });
  await person.getByLabel("Name", { exact: true }).fill("Casey Jones");
  await person.getByLabel("Name", { exact: true }).blur();
  const casey = page.getByRole("listitem", { name: "Casey Jones" });
  await casey.getByLabel("Username").fill("casey");
  await casey.getByLabel("Bio").click();
  await expect(casey.getByLabel("Username")).toHaveValue("casey");
  await casey.getByLabel("Bio").fill("Likes the outdoors");
  await casey.getByLabel("Location").click();
  await expect(casey.getByLabel("Bio")).toHaveValue("Likes the outdoors");

  // A username has to be unique, and it says so instead of breaking at the end.
  await page.getByRole("button", { name: "Add a person" }).click();
  const second = page.getByRole("listitem", { name: "New person" });
  await second.getByLabel("Username").fill("casey");
  await second.getByLabel("Name", { exact: true }).click();
  await expect(second.getByRole("alert")).toContainText("already has that username");
  await page.reload();
  await expect(page.getByRole("heading", { name: /Cast of/ })).toBeVisible();

  // Removing someone who hasn't written anything works.
  await page
    .getByRole("listitem", { name: "New person" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByRole("listitem", { name: "New person" })).toHaveCount(0);

  // Write a post.
  await page.getByRole("link", { name: "Back to the feed" }).click();
  await page.getByRole("button", { name: "New post here" }).click();
  const post = page.locator("article").first();
  const body = `Hello from nothing ${stamp}`;
  await post.getByRole("button", { name: /Text of this post/ }).click();
  await post.getByLabel("Text of this post").fill(body);
  await post.getByLabel("Text of this post").blur();
  await expect(post.getByText(body)).toBeVisible();

  // The cast screen now won't let them go, since they have a post.
  await page.getByRole("link", { name: "Cast", exact: true }).click();
  await expect(
    page.getByRole("listitem", { name: "Casey Jones" }).getByRole("button", { name: "Remove" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Back to the feed" }).click();

  // It shows in the list before it has any versions.
  await saveAndLaunch(page);
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();

  // The consent page was never changed, so launching takes an extra step.
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await expect(launching.getByText(/still has the placeholder text/)).toBeVisible();
  await expect(launching.getByRole("button", { name: "Launch it" })).toBeDisabled();
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();

  const context = await browser.newContext();
  const participant = await context.newPage();
  await participant.goto(`http://localhost:${APP_PORT}/join/${slug}?PROLIFIC_PID=NEW-${stamp}`);
  await expect(participant.getByRole("heading", { name: "Consent" })).toBeVisible();
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`joiner_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Joiner");
  await participant.getByRole("button", { name: "Save and continue" }).click();
  await expect(participant.getByText(body)).toBeVisible();
  await participant.getByRole("button", { name: "Reply" }).click();
  await participant.getByLabel("Write a comment").fill("Hello");
  await participant.getByLabel("Write a comment").press("Enter");
  // In the comment list, since the box they typed it in has the same words until it clears.
  await expect(participant.locator("article li").filter({ hasText: "Hello" })).toBeVisible();

  // The team can watch it without a terminal.
  await study.getByRole("link", { name: "Monitor and download" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const conditions = page.getByRole("region", { name: "By condition" });
  await expect(conditions.getByRole("row", { name: /control/ })).toContainText("1");
  await expect(page.getByText("Active in the last 15 minutes")).toBeVisible();
  await expect(page.getByRole("region", { name: /Where people/ })).toContainText("In the feed");
  await page.screenshot({ path: testInfo.outputPath("monitor.png"), fullPage: true });

  // Download the data, as a real file.
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download", exact: true }).click(),
  ]);
  expect(file.suggestedFilename().startsWith(`${slug}-`)).toBe(true);
  await page.getByText("Who has downloaded it").click();
  await expect(page.getByText(/other-lab@example\.edu/)).toBeVisible();

  // Someone asks to withdraw, and they're gone.
  const withdraw = page.getByRole("region", { name: "Withdraw a participant" });
  await withdraw.getByLabel("Their recruitment ID").fill(`NEW-${stamp}`);
  await withdraw.getByRole("button", { name: "Withdraw" }).click();
  await page
    .getByRole("dialog", { name: "Confirm withdrawal" })
    .getByRole("button", { name: "Delete their data" })
    .click();
  await expect(withdraw.getByRole("status")).toContainText("Withdrawn");
  await expect(page.getByText(/1 withdrew/)).toBeVisible();

  await context.close();
});

test("a study starts from a pack, and can be saved as a new pack", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;

  await signIn(page);
  await startStudy(page, `From a pack ${stamp}`, async () => {
    await page.getByRole("radio", { name: /EatSnap pack/ }).check();
    await expect(page.getByText(/A food photo community/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("new-study.png"), fullPage: true });
    await page.getByRole("radio", { name: /Just the background/ }).check();
  });

  // Just the background means one condition, and the same feed as the pack.
  await expect(page.getByRole("combobox", { name: "Condition" }).first()).toHaveValue("control");
  await expect(page.locator("article").first()).toBeVisible();

  // Consent doesn't come from the pack.
  await page.getByRole("link", { name: "Settings" }).click();
  const consent = page.getByRole("listitem").filter({ hasText: "1. Consent" });
  await expect(consent.getByLabel("Page text")).toHaveValue(/consent text your IRB approved/);
  await page.getByRole("link", { name: "Back to the feed" }).click();

  // It's copied, so changing it here doesn't change the pack, and it can be saved as a new one.
  const name = `Our lab pack ${stamp}`;
  await page.getByRole("button", { name: "Save as a pack" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as a pack" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Save the pack" }).click();
  await expect(dialog.getByText(/Your team can start new studies from it/)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.goto(`${ADMIN}/admin/studies/new`);
  await expect(page.getByRole("radio", { name: new RegExp(name) })).toBeVisible();
});

test("choosing a kind of platform, with a look at each and help deciding", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The page is the same on a phone.");
  await signIn(page);
  await page.getByRole("link", { name: "New study" }).click();

  // A card for each, Classic unless someone chooses another.
  for (const name of ["Classic", "Forum", "Short posts", "Photo"]) {
    await expect(page.getByRole("radio", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("radio", { name: "Classic", exact: true })).toBeChecked();
  if (process.env.FORUM_SHOTS) {
    await page.screenshot({
      path: path.join(process.env.FORUM_SHOTS, "new-study-cards.png"),
      fullPage: true,
    });
  }

  // More about one, about how it looks and works.
  await page.getByText("Read more about Photo").click();
  await expect(page.getByText(/Looks like a photo app in a browser/)).toBeVisible();

  // Help deciding asks how the platform works, and only picks a card.
  await page.getByText("Help me decide").click();
  const communities = page.getByRole("group", { name: /Do people belong to communities/ });
  await communities.getByRole("radio", { name: "Yes" }).check();
  await expect(page.getByText("Forum sounds closest.")).toBeVisible();
  await page.getByRole("button", { name: "Use Forum" }).click();
  await expect(page.getByRole("radio", { name: "Forum", exact: true })).toBeChecked();
});

test("a researcher fills in sheets for a whole feed, and uploads them with their pictures", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;

  await signIn(page);
  await startStudy(page, `From sheets ${stamp}`, async () => {
    await page.getByRole("radio", { name: "Photo", exact: true }).check();
    await page.getByRole("radio", { name: /Start with nothing/ }).check();
  });

  await page.getByRole("button", { name: "Add from sheets" }).click();
  const dialog = page.getByRole("dialog", { name: "Add from sheets" });

  // The sheets are made for this kind of platform.
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Download the sheets" }).click();
  const sheets = unzipSync(readFileSync(await (await downloading).path()));
  expect(strFromU8(sheets["posts.csv"] as Uint8Array)).toMatch(/^id,actor,time,body,picture,place/);

  const zipOf = (files: Record<string, string | Uint8Array>) => ({
    name: "feed.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([name, file]) => [
            name,
            typeof file === "string" ? strToU8(file) : file,
          ]),
        ),
      ),
    ),
  });
  const actors = "username,name,picture\nann,Ann Lee,\nbob,Bob,\n";

  // A mistake says which row, and nothing is added.
  await dialog
    .getByLabel("The zip")
    .setInputFiles(
      zipOf({ "actors.csv": actors, "posts.csv": "id,actor,time,body\np1,nobody,-1:00,Hi\n" }),
    );
  await dialog.getByRole("button", { name: "Add to the draft" }).click();
  await expect(dialog.getByRole("alert")).toContainText("posts.csv, row 2");

  const photo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await dialog.getByLabel("The zip").setInputFiles(
    zipOf({
      "actors.csv": actors,
      "posts.csv":
        "id,actor,time,body,picture,place\np1,ann,-1:00,Sunrise at the lake,lake.png,Ithaca\n",
      "comments.csv": "id,postID,actor,time,body\nc1,p1,bob,-0:30,Which trail?\n",
      "media/posts/lake.png": photo,
    }),
  );
  await dialog.getByRole("button", { name: "Add to the draft" }).click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Added 2 people, 1 post, and 1 comment. You can undo it from Recent changes.",
  );
  await dialog.getByRole("button", { name: "Done" }).click();

  await expect(page.locator("article").getByText("Sunrise at the lake")).toBeVisible();
  await page.locator("summary", { hasText: "Recent changes" }).click();
  await expect(page.getByText(/added .* and 3 more/)).toBeVisible();
});

test("a study can start with sample content for its kind of platform", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  await signIn(page);
  await startStudy(page, `Sample forum ${Date.now() % 1_000_000}`, async () => {
    await page.getByRole("radio", { name: "Forum", exact: true }).check();
    await page.getByRole("radio", { name: /Sample content for Forum/ }).check();
  });
  await expect(page.getByText("My sourdough finally has an open crumb").first()).toBeVisible();
  await page.getByText("1 thing to check").click();
  await page.screenshot({ path: testInfo.outputPath("sample-forum.png"), fullPage: true });
});

test("a researcher writes beats in the builder, and sees what's wrong with them", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  await signIn(page);
  await startStudy(page, `Beats ${Date.now() % 1_000_000}`, async () => {
    await page.getByRole("radio", { name: "Forum", exact: true }).check();
    await page.getByRole("radio", { name: /Sample content for Forum/ }).check();
  });
  await page.getByRole("link", { name: "Beats" }).click();
  await expect(page.getByText("This study has no beats yet.")).toBeVisible();

  const beats = page.getByLabel("Beats", { exact: true });
  const beat = (actor: string) => `beats:
  - id: welcome
    when: { participant: post, nth: 0 }
    delay: "0:01"
    do: { action: comment, actor: ${actor}, on: trigger, text: Welcome! }
`;
  await beats.fill(beat("nobody"));
  await page.getByRole("button", { name: "Save beats" }).click();
  await expect(page.getByTestId("beat-problems")).toContainText(
    'The beat "welcome" is done by "nobody", who isn\'t in the list of actors.',
  );

  await beats.fill(beat("trailhead"));
  await page.getByRole("button", { name: "Save beats" }).click();
  await expect(page.getByRole("status").filter({ hasText: "No problems found." })).toBeVisible();
  await page.reload();
  await expect(beats).toHaveValue(/actor: trailhead/);
});
