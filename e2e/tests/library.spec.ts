import { readFileSync } from "node:fs";
import path from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// The library (ADR 92): one lab publishes a study, whoever runs this Truman lists it, and another
// lab copies it into theirs.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const accounts = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, string>;
const ADMIN = `http://localhost:${ADMIN_PORT}`;

async function signedIn(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();
  return page;
}

test("a lab publishes a study, it's listed, and another lab copies it", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `Published ${stamp}`;

  // The author makes a study, with something of their own in it, and saves a version.
  const author = await signedIn(
    browser,
    accounts.otherLabEmail as string,
    accounts.otherLabPassword as string,
  );
  await author.getByRole("link", { name: "New study" }).click();
  await author.getByLabel("Title").fill(title);
  await author.getByRole("radio", { name: /Sample content/ }).check();
  await author.getByRole("radio", { name: /^Uniform/ }).check();
  await author.getByRole("button", { name: "Start the study" }).click();
  const post = author.locator("article").first();
  await post.getByRole("button", { name: /Text of this post/ }).click();
  await post.getByLabel("Text of this post").fill(`Written by the author ${stamp}`);
  await post.getByLabel("Text of this post").blur();
  await expect(author.getByText("All changes saved")).toBeVisible();
  await author.getByRole("button", { name: "Save as new version" }).click();
  await author.getByRole("button", { name: "Save version" }).click();
  await expect(author.getByRole("heading", { name: "Studies" })).toBeVisible();

  // They publish it, saying what it is and that it's theirs to share.
  const study = author.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Publish", exact: true }).click();
  const publishing = author.getByRole("dialog", { name: "Publish version 1" });
  const publishIt = publishing.getByRole("button", { name: "Publish it" });
  await expect(publishIt).toBeDisabled();
  await publishing
    .getByLabel("What the study tests")
    .fill(`Whether a friendly feed changes how much people post. Study ${stamp}.`);
  await publishing.getByLabel("The paper it's from (optional)").fill("Author (2026). A feed.");
  await publishing.getByLabel("What others may do with it").selectOption("CC BY-NC 4.0");
  await expect(publishIt).toBeDisabled();
  await publishing.getByLabel(/I may share everything in this study/).check();
  await publishIt.click();
  // This Truman is a hosted one, so it waits for whoever runs it.
  await expect(publishing.getByRole("heading", { name: "Sent to be listed" })).toBeVisible();
  await publishing.getByRole("button", { name: "Close" }).click();
  await author.getByRole("link", { name: "Library" }).click();
  const theirs = author.getByRole("listitem", { name: title });
  await expect(theirs.getByText("Waiting to be listed")).toBeVisible();
  await expect(theirs.getByText("From your lab")).toBeVisible();

  // Another lab doesn't see it yet.
  const reader = await signedIn(browser, accounts.email as string, accounts.password as string);
  await reader.getByRole("link", { name: "Library" }).click();
  await expect(reader.getByRole("heading", { name: /^Library/ })).toBeVisible();
  await expect(reader.getByRole("listitem", { name: title })).toHaveCount(0);

  // Whoever runs this Truman lists it.
  const operator = await signedIn(
    browser,
    accounts.operatorEmail as string,
    accounts.operatorPassword as string,
  );
  await operator.getByRole("link", { name: "Library" }).click();
  await operator
    .getByRole("listitem", { name: title })
    .getByRole("button", { name: "List it" })
    .click();
  await expect(
    operator.getByRole("listitem", { name: title }).getByText("Waiting to be listed"),
  ).toHaveCount(0);

  // Now the other lab sees what it is, and copies it.
  await reader.reload();
  const listed = reader.getByRole("listitem", { name: title });
  await expect(listed.getByText(`Study ${stamp}.`)).toBeVisible();
  await expect(listed.getByText("CC BY-NC 4.0")).toBeVisible();
  await expect(listed.getByText("Author (2026). A feed.")).toBeVisible();
  await expect(listed.getByText("Classic", { exact: true })).toBeVisible();
  await reader.screenshot({ path: testInfo.outputPath("library.png"), fullPage: true });
  await listed.getByRole("button", { name: "Copy into my lab" }).click();
  const copying = reader.getByRole("dialog", { name: `Copy ${title}` });
  await copying.getByLabel("Title").fill(`Our copy ${stamp}`);
  await expect(copying.getByLabel("Link name")).toHaveValue(`our-copy-${stamp}`);
  await copying.getByRole("button", { name: "Copy it" }).click();

  // It opens in the builder, as their own draft, with the author's post in it.
  await expect(reader.getByRole("button", { name: "Save as new version" })).toBeVisible();
  await expect(reader.getByText(`Written by the author ${stamp}`).first()).toBeVisible();

  // The author can take theirs down, and it's gone for everyone.
  await author.reload();
  await author
    .getByRole("listitem", { name: title })
    .getByRole("button", { name: "Take down" })
    .click();
  await expect(author.getByRole("listitem", { name: title })).toHaveCount(0);
  for (const page of [author, reader, operator]) {
    await page.context().close();
  }
});
