import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const MAIL_FILE = path.resolve(import.meta.dirname, "../.e2e-mail.jsonl");
const { operatorEmail, operatorPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  operatorEmail: string;
  operatorPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

/** The link in the newest email to someone, once it's arrived. */
async function linkFor(to: string) {
  let link = "";
  await expect(async () => {
    const mail = readFileSync(MAIL_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { to: string; text: string })
      .filter((item) => item.to === to)
      .at(-1);
    link = /https?:\/\/\S+\?token=[\w-]+/.exec(mail?.text ?? "")?.[0] ?? "";
    expect(link).not.toBe("");
  }).toPass();
  return link;
}

test("an owner invites someone by email, who joins, then resets a forgotten password (ADR 72)", async ({
  page,
  browser,
}, testInfo) => {
  const invited = `invited-${testInfo.project.name}-${Date.now()}@example.edu`;

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(operatorEmail);
  await page.getByLabel("Password").fill(operatorPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Your lab" }).click();
  const members = page.getByRole("region", { name: "Operators members" });
  await members.getByLabel("Invite by email").fill(invited);
  await members.getByRole("button", { name: "Send invitation" }).click();
  await expect(members).toContainText(`${invited} invited as editor`);
  await page.screenshot({ path: testInfo.outputPath("members.png"), fullPage: true });

  // They follow the emailed link, in a browser of their own, and make an account.
  const theirs = await (await browser.newContext()).newPage();
  await theirs.goto(await linkFor(invited));
  await expect(theirs.getByRole("heading", { name: "Join Operators" })).toBeVisible();
  await theirs.getByLabel("Your name").fill("Ivy Invited");
  await theirs.getByLabel("Choose a password").fill("a long enough password");
  await theirs.getByRole("button", { name: "Join Operators" }).click();
  await expect(theirs.getByRole("link", { name: "Your lab" })).toBeVisible();

  await page.reload();
  await expect(members).toContainText("Ivy Invited");

  // Later, they've forgotten their password.
  const later = await (await browser.newContext()).newPage();
  await later.goto(ADMIN);
  await later.getByRole("button", { name: "Forgot your password?" }).click();
  await later.getByLabel("Email").fill(invited);
  await later.getByRole("button", { name: "Send the link" }).click();
  await expect(later.getByRole("status")).toContainText("we've sent it a link");
  await later.goto(await linkFor(invited));
  await later.getByLabel("New password").fill("a different long password");
  await later.getByRole("button", { name: "Save and sign in" }).click();
  await expect(later.getByRole("link", { name: "Your lab" })).toBeVisible();

  // The invited editor leaves, so the next run's operator team is as it was.
  await later.getByRole("link", { name: "Your lab" }).click();
  await later
    .getByRole("region", { name: "Operators members" })
    .getByRole("button", { name: "Leave" })
    .click();
});
