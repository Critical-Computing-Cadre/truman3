import { expect, test } from "@playwright/test";
import { APP_PORT } from "../playwright.config.ts";

test("a participant gets a message, and messages someone from their profile", async ({
  page,
}, testInfo) => {
  const app = `http://localhost:${APP_PORT}`;
  await page.goto(
    `${app}/join/messages-e2e?PROLIFIC_PID=MESSAGES-${testInfo.project.name}-${Date.now()}`,
  );
  await expect(page.getByText("Morning everyone")).toBeVisible();
  // Bob's welcome is sent as the first page loads, so the count it shows can be from just before.
  // The app checks again every 30 seconds; loading the page again is the same check, sooner.
  await page.reload();
  await expect(page.getByText("Morning everyone")).toBeVisible();

  // Bob's welcome waits, unread, and stays out of the feed.
  const messagesLink = page.getByRole("link", { name: /^Messages, \d+ new$/ }).first();
  await expect(messagesLink).toHaveAccessibleName("Messages, 1 new", { timeout: 15_000 });
  await expect(page.getByText("Hey, welcome!")).toHaveCount(0);
  await messagesLink.click();
  const conversations = page.getByTestId("conversations");
  await expect(conversations.getByText("Hey, welcome! Glad you're here.")).toBeVisible();
  await conversations.getByRole("link", { name: /Bob/ }).click();
  await expect(page.getByTestId("messages").getByText("Hey, welcome!")).toBeVisible();
  await expect(page.getByRole("link", { name: "Messages, 0 new" }).first()).toBeVisible();

  // From Ann's profile, a message, and her answer.
  await page.goto(`${app}/u/ann`);
  await page.getByRole("link", { name: "Message", exact: true }).click();
  await page.getByLabel("Message Ann").fill("Hi Ann, nice to meet you");
  await page.getByRole("button", { name: "Send" }).click();
  const thread = page.getByTestId("messages");
  await expect(thread.getByText("Hi Ann, nice to meet you")).toBeVisible();
  await expect(page.getByLabel("Message Ann")).toHaveValue("");
  await expect(thread.getByText("Hi! Thanks for writing 😊")).toBeVisible({ timeout: 15_000 });
});
