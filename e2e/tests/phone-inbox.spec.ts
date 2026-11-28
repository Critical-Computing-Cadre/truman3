import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createDb } from "@truman3/db";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { APP_PORT } from "../playwright.config.ts";

/** Where to keep pictures of what this looks like, when someone asks for them. */
const SHOTS = process.env.FORUM_SHOTS;
const shot = async (page: Page, project: string, name: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `inbox-${project}-${name}.png`) });
  }
};
const app = `http://localhost:${APP_PORT}`;
const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");

/** A notification as the API sends one, of a kind, from someone. */
const notification = (type: string, name: string, extra: Record<string, unknown> = {}) => ({
  key: `${type}-${name}`,
  type,
  actors: [{ username: name.toLowerCase(), name, pictureUrl: null }],
  targetKind: "post",
  targetName: "",
  targetIsTheirs: true,
  postId: null,
  commentId: null,
  targetBody: "My first post",
  targetImageUrl: null,
  replyBody: null,
  reason: null,
  at: new Date().toISOString(),
  unread: false,
  ...extra,
});

test("chips above notifications narrow them to one kind", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await page.goto(`${app}/join/messages-e2e?PROLIFIC_PID=CHIPS-${project}-${Date.now()}`);
  await expect(page.getByText("Morning everyone")).toBeVisible();
  // Three kinds at once, which this study's script doesn't send by itself.
  await page.route("**/api/notifications", (route) =>
    route.fulfill({
      json: {
        notifications: [
          notification("like", "Ann"),
          notification("reply", "Bob", { replyBody: "Welcome!" }),
          notification("follow", "Cara"),
        ],
      },
    }),
  );
  await page.goto(`${app}/notifications`);
  const chips = page.getByRole("group", { name: "Show" });
  await expect(chips.getByRole("button")).toHaveText(["All", "Replies", "Reactions", "Follows"]);
  await expect(chips.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  const list = page.getByRole("main").getByRole("list").last();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await shot(page, project, "1-chips");

  await chips.getByRole("button", { name: "Replies" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("Bob replied: Welcome!");
  await chips.getByRole("button", { name: "All" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(3);
});

test("On a phone, a conversation keeps the box to write in at the bottom of the screen", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "phone", "A wide screen has the box under the messages.");
  await page.goto(`${app}/join/messages-e2e?PROLIFIC_PID=MSGBAR-${Date.now()}`);
  await expect(page.getByText("Morning everyone")).toBeVisible();
  await page.goto(`${app}/u/ann`);
  await page.getByRole("link", { name: "Message", exact: true }).click();

  const bar = page.getByTestId("message-bar");
  await expect(bar.getByLabel("Message Ann")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sections on a phone" })).toBeHidden();
  const box = await bar.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(page.viewportSize()?.height);
  await bar.getByLabel("Message Ann").fill("Hello from the bottom of the screen");
  await shot(page, project, "2-conversation");
  await bar.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByTestId("messages").getByText("Hello from the bottom of the screen"),
  ).toBeInViewport();

  // Back at the list, the sections are along the bottom again.
  await page.getByRole("link", { name: "Back to messages" }).click();
  await expect(page.getByRole("navigation", { name: "Sections on a phone" })).toBeVisible();
});

test("On a phone, a forum has one Inbox tab for notifications and messages", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "phone", "A wide screen has room for both in its top bar.");
  const { databaseUrl } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { databaseUrl: string };
  const imported = await importStudyFolder(
    createDb(databaseUrl).db,
    createStorage(storageConfigFromEnv()),
    path.resolve(import.meta.dirname, "../../studies/starters/forum"),
    { launch: true },
  );
  expect(imported.status).not.toBe("failed");

  const stamp = Date.now() % 100000;
  await page.goto(`${app}/join/forum-starter?PROLIFIC_PID=INBOX-${stamp}`);
  await page.getByRole("button", { name: "I agree" }).click();
  await page.getByLabel("Username").fill(`inbox_${stamp}`);
  await page.getByLabel("Name", { exact: true }).fill("Inbox Person");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // Five tabs and Create, none cut short for room, with Inbox where two used to be.
  const tabs = page.getByRole("navigation", { name: "Sections" });
  await expect(tabs.getByText("Inbox")).toBeVisible();
  await expect(tabs.getByRole("link", { name: /^Messages/ })).toHaveCount(0);
  await expect(tabs.getByRole("link")).toHaveCount(4);
  await expect(tabs.getByRole("button", { name: "Compose" })).toBeVisible();
  await shot(page, project, "3-forum-tabs");

  // It opens notifications, with a pair of tabs at the top to reach messages.
  await tabs.getByRole("link", { name: /^Notifications/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  const inbox = page.getByRole("navigation", { name: "Inbox" });
  await expect(inbox.getByRole("link", { name: /^Notifications/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await inbox.getByRole("link", { name: /^Messages/ }).click();
  await expect(page.getByRole("heading", { name: "Messages" })).toBeVisible();
  // The welcome message that this study sends is waiting there.
  await expect(page.getByTestId("conversations").getByRole("link")).toHaveCount(1);
  await shot(page, project, "4-forum-messages");
});
