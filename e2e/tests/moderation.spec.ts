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
    await page.screenshot({ path: path.join(SHOTS, `moderation-${project}-${name}.png`) });
  }
};

test("a moderator's removals show in place of what was removed", async ({ page }, testInfo) => {
  const id = `MOD-${testInfo.project.name}-${Date.now()}`;
  await page.goto(`http://localhost:${APP_PORT}/join/moderation-e2e?PROLIFIC_PID=${id}`);

  // Someone else's post: the note is there, and what it said isn't, even in the page's text.
  await expect(page.getByRole("article", { name: "A post that stays" })).toBeVisible();
  const note = page.getByTestId("removed-note").first();
  await expect(note).toContainText("Removed by Sam the Mod.");
  await expect(note).toContainText("Reason: Rule 2: be kind");
  await expect(note).not.toContainText("Nobody else");
  await expect(page.getByText("A post that breaks a rule")).toHaveCount(0);
  await expect(page.getByText("Words nobody should read")).toHaveCount(0);
  await shot(page, testInfo.project.name, "1-list");

  // A comment, on its post's own page. The thread stays, and only that comment goes.
  await page
    .getByRole("article", { name: "A post that stays" })
    .getByRole("link", { name: "A post that stays" })
    .click();
  await expect(page.getByText("A comment that stays")).toBeVisible();
  await expect(page.getByText("A comment nobody should read")).toHaveCount(0);
  await expect(page.getByTestId("removed-note")).toContainText("Removed by Sam the Mod.");
  await shot(page, testInfo.project.name, "2-comment");
  await page.goBack();

  // Their own post: they keep what they wrote, and are told about it.
  await page.getByRole("button", { name: /Create a post/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("My own post");
  await dialog.getByLabel("Write a post").fill("Something I wrote");
  await dialog.getByLabel("Community").selectOption({ label: "Cooking" });
  await dialog.getByRole("button", { name: "Post", exact: true }).click();

  const own = page.getByRole("article", { name: "My own post" });
  await expect(own.getByText("Something I wrote")).toBeVisible();
  const ownNote = own.getByTestId("removed-note");
  await expect(ownNote).toContainText("Nobody else can see this now.");
  await expect(ownNote).toContainText("Reason: Rule 3: no spam");
  await expect(own.getByRole("button", { name: "Vote up" })).toBeDisabled();
  await shot(page, testInfo.project.name, "3-own");

  // The notification says the same, and the bell has it.
  await page
    .getByRole("link", { name: /notifications/i })
    .first()
    .click();
  await expect(page.getByText("Sam the Mod removed your post")).toBeVisible();
  await expect(page.getByText("Reason: Rule 3: no spam")).toBeVisible();
  await shot(page, testInfo.project.name, "4-notification");

  // The mod log lists what was removed, without what it said.
  await page.goto(`http://localhost:${APP_PORT}/spaces`);
  await page.getByRole("link", { name: "Mod log" }).click();
  await expect(page.getByTestId("mod-log-entry")).toHaveCount(4);
  await expect(page.getByText("Sam the Mod banned Ben")).toBeVisible();
  await expect(page.getByText("Sam the Mod removed your post")).toBeVisible();
  await expect(page.getByText("Sam the Mod removed a comment by Ann")).toBeVisible();
  await expect(page.getByText("Words nobody should read")).toHaveCount(0);
  await shot(page, testInfo.project.name, "5-mod-log");

  // Writing a comment brings a warning, which stays until they press its button.
  await page.goto(`http://localhost:${APP_PORT}/`);
  await page
    .getByRole("article", { name: "A post that stays" })
    .getByRole("link", { name: "A post that stays" })
    .click();
  await page.getByPlaceholder("Write a comment...").fill("Something rude");
  await page.getByPlaceholder("Write a comment...").press("Enter");
  await expect(page.getByText("Something rude")).toBeVisible();
  await page.reload();
  const warning = page.getByTestId("warning-notice");
  await expect(warning).toContainText("A warning from Sam the Mod about your comment");
  await expect(warning).toContainText("Please keep it civil");
  await shot(page, testInfo.project.name, "6-warning");
  await page.goto(`http://localhost:${APP_PORT}/`);
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "I understand" }).click();
  await expect(warning).toHaveCount(0);
});

test("a flag brings a moderator's answer, and what's named can be removed", async ({
  page,
}, testInfo) => {
  const id = `FLAG-${testInfo.project.name}-${Date.now()}`;
  const app = `http://localhost:${APP_PORT}`;
  await page.goto(`${app}/join/moderation-e2e?PROLIFIC_PID=${id}`);

  const flag = async (name: string) => {
    const card = page.getByRole("article", { name });
    await expect(card).toBeVisible();
    const more = card.getByRole("button", { name: "More" });
    if (await more.isVisible()) {
      await more.click();
    }
    await card.getByRole("button", { name: "Flag" }).click();
  };

  // This answer has no delay, so the note comes straight away, with no cover in between.
  await flag("A post someone flags");
  await expect(page.getByText("Reason: Thanks for flagging this")).toBeVisible();
  await expect(page.getByText("Words to flag")).toHaveCount(0);

  await flag("A different post");
  await expect(page.getByText("You've flagged this!")).toBeVisible();

  await page.goto(`${app}/notifications`);
  await expect(page.getByText("Sam the Mod removed Ann's post, which you flagged")).toBeVisible();
  await expect(page.getByText("Sam the Mod looked at Ann's post, which you flagged")).toBeVisible();
  await expect(page.getByText("We looked at this and no rule was broken")).toBeVisible();
  await expect(page.getByText("Words to flag")).toHaveCount(0);
  await shot(page, testInfo.project.name, "8-flag-answers");
});

test("someone banned stops posting, and a report brings an answer or a ban", async ({
  page,
}, testInfo) => {
  const id = `BAN-${testInfo.project.name}-${Date.now()}`;
  const app = `http://localhost:${APP_PORT}`;
  await page.goto(`${app}/join/moderation-e2e?PROLIFIC_PID=${id}`);

  // What Ben wrote before his ban stays, tagged, and what he's written to post after doesn't appear.
  const before = page.getByRole("article", { name: "Ben before his ban" });
  await expect(before).toBeVisible();
  await expect(before.getByText("Banned", { exact: true })).toBeVisible();
  await expect(page.getByText("Ben after his ban")).toHaveCount(0);
  await shot(page, testInfo.project.name, "9-banned-tag");

  await page.goto(`${app}/u/ben`);
  await expect(page.getByTestId("banned-note")).toContainText(
    "Banned by Sam the Mod. Reason: Rule 5: no harassment",
  );
  await expect(page.getByText("Ben after his ban")).toHaveCount(0);

  const report = async (username: string) => {
    await page.goto(`${app}/u/${username}`);
    await page.getByRole("button", { name: "Report", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio").first().check();
    await dialog.getByRole("button", { name: /Report|Submit|Send/ }).click();
    await expect(page.getByRole("button", { name: "Reported" })).toBeVisible();
  };
  await report("ben");
  await report("ann");

  await page.goto(`${app}/notifications`);
  await expect(page.getByText("Sam the Mod looked at your report of Ben")).toBeVisible();
  await expect(page.getByText("We looked and no rule was broken")).toBeVisible();
  await expect(page.getByText("Sam the Mod banned Ann, whom you reported")).toBeVisible();
  await expect(page.getByText("Reason: Thanks for reporting this")).toBeVisible();
  await shot(page, testInfo.project.name, "10-report-answers");

  await page.goto(`${app}/u/ann`);
  await expect(page.getByTestId("banned-note")).toContainText("Banned by Sam the Mod.");
});

test("a rule asks if they're sure, a post waits for approval, and an appeal puts one back", async ({
  page,
}, testInfo) => {
  const id = `RULE-${testInfo.project.name}-${Date.now()}`;
  const app = `http://localhost:${APP_PORT}`;
  await page.goto(`${app}/join/moderation-e2e?PROLIFIC_PID=${id}`);

  const write = async (title: string) => {
    await page.getByRole("button", { name: /Create a post/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Write a post").fill("Some words");
    await dialog.getByLabel("Community").selectOption({ label: "Cooking" });
    await dialog.getByRole("button", { name: "Post", exact: true }).click();
    return dialog;
  };

  // The first post of theirs is removed in this study, so it can be appealed.
  await write("My first post");
  const first = page.getByRole("article", { name: "My first post" });
  await expect(first.getByTestId("removed-note")).toContainText("Removed by Sam the Mod.");
  await first.getByRole("button", { name: "Appeal" }).click();
  await first.getByLabel("Why should this go back up?").fill("It didn't break anything");
  await shot(page, testInfo.project.name, "11-appeal");
  await first.getByRole("button", { name: "Send appeal" }).click();
  await expect(first.getByTestId("removed-note")).toHaveCount(0);

  // Going back leaves it unposted. Going ahead posts it.
  const dialog = await write("A badword in here");
  const asking = dialog.getByTestId("are-you-sure");
  await expect(asking).toContainText("This might break a rule. Are you sure?");
  await shot(page, testInfo.project.name, "12-are-you-sure");
  await asking.getByRole("button", { name: "Go back and edit" }).click();
  await expect(asking).toHaveCount(0);
  await expect(page.getByRole("article", { name: "A badword in here" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await asking.getByRole("button", { name: "Post anyway" }).click();
  await expect(page.getByRole("article", { name: "A badword in here" })).toBeVisible();

  await write("Please holdme for a while");
  const held = page.getByRole("article", { name: "Please holdme for a while" });
  await expect(held.getByTestId("held-note")).toContainText("Waiting for a moderator's approval");
  await shot(page, testInfo.project.name, "13-held");

  await page.goto(`${app}/notifications`);
  await expect(
    page.getByText("Sam the Mod looked at your appeal, and put your post back"),
  ).toBeVisible();
  await expect(page.getByText("You're right. We put it back.")).toBeVisible();
});

test("a researcher writes a moderator's decisions in the builder, and a participant gets them", async ({
  page: participant,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const project = testInfo.project.name;
  const stamp = Date.now() % 1_000_000;
  const title = `Moderated ${project} ${stamp}`;
  const slug = `moderated-${project}-${stamp}`;

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
  await added.getByLabel("Name", { exact: true }).fill("Sam the Mod");
  await added.getByLabel("Name", { exact: true }).blur();
  await expect(page.getByRole("listitem", { name: "Sam the Mod" })).toBeVisible();
  await page.getByRole("link", { name: "Back to the feed" }).click();

  await page.getByRole("button", { name: "New post here" }).click();
  const empty = page.getByRole("article", { name: /^Post by/ });
  await empty.getByRole("button", { name: /Title of this post/ }).click();
  await empty.getByLabel("Title of this post").fill("Breaks a rule");
  await empty.getByLabel("Title of this post").blur();
  await expect(page.getByRole("article", { name: "Breaks a rule" })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  await page.getByRole("link", { name: "Moderation" }).click();
  await page.getByRole("button", { name: "Add a removal" }).click();
  const removal = page.getByRole("listitem", { name: "Removal" });
  await expect(removal.getByLabel("What it removes")).toContainText("Breaks a rule");
  await removal.getByLabel("Reason shown (optional)").fill("Rule 2: be kind");
  await removal.getByLabel("Reason shown (optional)").blur();
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");

  await page.getByRole("button", { name: "Add a response" }).click();
  const response = page.getByRole("listitem", { name: "Response" });
  await response.getByLabel("What happens").selectOption({ label: "Warn them" });
  await expect(response.getByLabel("What the warning says")).toBeVisible();
  await response.getByLabel("What the warning says").fill("Please keep it civil");
  await response.getByLabel("What the warning says").blur();
  await expect(page.getByTestId("save-status")).toHaveText("All changes saved");
  await shot(page, project, "7-builder");

  await page.getByRole("link", { name: "Back to the feed" }).click();
  await expect(page.getByText(/A moderator removes this at/)).toBeVisible();
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
  await participant.goto(`${app}/join/${slug}?PROLIFIC_PID=MODERATED-${project}-${stamp}`);
  await participant.getByRole("button", { name: "I agree" }).click();
  await participant.getByLabel("Username").fill(`moderated_${project}_${stamp}`);
  await participant.getByLabel("Name", { exact: true }).fill("Someone");
  await participant.getByRole("button", { name: "Save and continue" }).click();

  const note = participant.getByTestId("removed-note");
  await expect(note).toContainText("Removed by Sam the Mod.");
  await expect(note).toContainText("Reason: Rule 2: be kind");
  await expect(participant.getByText("Breaks a rule")).toHaveCount(0);

  await participant.getByRole("button", { name: /Create a post/ }).click();
  const dialog = participant.getByRole("dialog");
  await dialog.getByLabel("Title").fill("My post");
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(participant.getByRole("article", { name: "My post" })).toBeVisible();
  await participant.reload();
  await expect(participant.getByTestId("warning-notice")).toContainText("Please keep it civil");
});
