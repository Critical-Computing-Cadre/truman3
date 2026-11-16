import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// A beat asks a participant a question in the feed, right after they post (ADR 89). A researcher
// writes the beat, a test participant gets the question, answers it, and it goes away.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

const BEATS = `beats:
  - id: after-posting
    note: Ask how it felt, each time they post, up to twice.
    when: { participant: post }
    max: 2
    do:
      action: ask
      title: About your post
      questions:
        - id: felt
          text: How did posting that feel?
          type: scale
          max: 7
          minLabel: Uneasy
          maxLabel: Good
        - id: why
          text: What was it for?
          type: choice
          choices: [To share something, To get a reaction, No reason]
`;

/** Gets a test participant from the link to the feed, through whatever steps the study has. */
async function reachFeed(page: Page) {
  const agree = page.getByRole("button", { name: "I agree" });
  const username = page.getByLabel("Username");
  const next = page.getByRole("button", { name: "Continue" });
  for (let step = 0; step < 6; step++) {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    if (await agree.isVisible()) {
      await agree.click();
      await agree.waitFor({ state: "hidden" });
    } else if (await username.isVisible()) {
      await username.fill(`asked${Date.now() % 100000}`);
      await page.getByLabel("Name", { exact: true }).fill("Asked Person");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await username.waitFor({ state: "hidden" });
    } else if (await next.isVisible()) {
      await next.click();
    } else {
      break;
    }
  }
}

async function writePost(page: Page, text: string) {
  await page.getByRole("button", { name: "Create a post" }).click();
  const newPost = page.getByRole("dialog");
  await newPost.getByLabel("Write a post").fill(text);
  await newPost.getByRole("button", { name: "Post", exact: true }).click();
  await expect(newPost).toBeHidden();
}

test("a beat asks a participant a question after they post, and they answer it", async ({
  page,
}, testInfo) => {
  const stamp = Date.now() % 1_000_000;
  const title = `Asking ${testInfo.project.name} ${stamp}`;

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await expect(page.getByRole("button", { name: "Save as new version" })).toBeVisible();

  // The researcher writes the question as a beat.
  await page.getByRole("link", { name: "Beats", exact: true }).click();
  await expect(page.getByText("do: ask")).toBeVisible();
  await page.getByRole("textbox", { name: "Beats" }).fill(BEATS);
  await page.getByRole("button", { name: "Save beats" }).click();
  await expect(page.getByText("No problems found.")).toBeVisible();
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();

  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Try as a participant" }).click();
  const [participant] = await Promise.all([
    page.waitForEvent("popup"),
    study.getByRole("link", { name: "Open as a test participant" }).click(),
  ]);
  await reachFeed(participant);

  // Nothing is asked until they post.
  const card = participant.getByRole("region", { name: "About your post" });
  await expect(participant.locator("article").first()).toBeVisible();
  await expect(card).toHaveCount(0);
  await writePost(participant, `First post ${stamp}`);

  // Then it's there, over the feed, and can't be sent half answered.
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("How did posting that feel?")).toBeVisible();
  await expect(card.getByText("Uneasy")).toBeVisible();
  const send = card.getByRole("button", { name: "Send" });
  await expect(send).toBeDisabled();
  await card.getByText("6", { exact: true }).click();
  await expect(send).toBeDisabled();
  await card.getByLabel("To get a reaction").check();
  await participant.screenshot({ path: testInfo.outputPath("question.png") });
  await send.click();
  await expect(card).toHaveCount(0);
  // It stays gone on another page, and after a reload.
  await participant.reload();
  await expect(participant.locator("article").first()).toBeVisible();
  await expect(card).toHaveCount(0);

  // Posting again asks again, and this time they put it aside.
  await writePost(participant, `Second post ${stamp}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "Not now" }).click();
  await expect(card).toHaveCount(0);

  // A third post asks nothing: the beat's limit is two.
  await writePost(participant, `Third post ${stamp}`);
  await participant.reload();
  await expect(participant.locator("article").first()).toBeVisible();
  await participant.waitForTimeout(1500);
  await expect(card).toHaveCount(0);
});
