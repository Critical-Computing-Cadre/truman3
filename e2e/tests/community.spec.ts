import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

// The Community page (ADR 99). This lab has no Claude key, so drafting is refused, with the reason;
// the drafting itself is tested with a stand-in model in community.itest.ts.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<
  string,
  string
>;

test("a researcher describes a community to draft", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  await page.goto(`http://localhost:${ADMIN_PORT}`);
  await page.getByLabel("Email").fill(otherLabEmail as string);
  await page.getByLabel("Password").fill(otherLabPassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(`Town ${stamp}`);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await page.getByRole("link", { name: "Community" }).click();
  await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();

  const draft = page.getByRole("button", { name: "Draft the community" });
  await expect(draft).toBeDisabled();
  await page
    .getByLabel("What is this community, and what's it like?")
    .fill("Neighbors in a small town, swapping news and recipes. Mostly friendly.");
  await page.getByLabel(/What people talk about/).fill("the farmers market\nroad work");
  await page.getByLabel("Days before they arrive").fill("1");
  // Everyone in the cast takes part unless they're left out.
  const people = page.getByRole("group", { name: "Who takes part" }).getByRole("checkbox");
  expect(await people.count()).toBeGreaterThan(2);
  await people.first().uncheck();
  await page.screenshot({ path: testInfo.outputPath("community.png"), fullPage: true });
  await draft.click();
  await expect(page.getByRole("alert")).toContainText("no Claude key");
});

// A live community (ADR 102). With no Claude key nothing is written, and the Monitor page says so;
// the writing is tested with a stand-in model in live-community.itest.ts.
test("a researcher turns on a live community, and watches it on the Monitor page", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const title = `Live town ${Date.now() % 1_000_000}`;
  await page.goto(`http://localhost:${ADMIN_PORT}`);
  await page.getByLabel("Email").fill(otherLabEmail as string);
  await page.getByLabel("Password").fill(otherLabPassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await page.getByRole("link", { name: "Community" }).click();

  await page
    .getByLabel("What is this community, and what's it like?")
    .fill("Neighbors in a small town, swapping news and recipes. Mostly friendly.");
  await page.getByLabel("Days while they're there").fill("3");
  await page.getByRole("radio", { name: /While the study runs/ }).check();
  // Unread AI text is said plainly, until each day is held for approval.
  await expect(page.getByText(/without anyone reading it\s+first/)).toBeVisible();
  await page.getByRole("checkbox", { name: /Hold each day/ }).check();
  await expect(page.getByText(/without anyone reading it\s+first/)).toBeHidden();
  // Each participant's own community, with what one can cost.
  await page.getByRole("checkbox", { name: /a community of their own/ }).check();
  await page.getByLabel(/The most one participant's community can cost/).fill("0.75");
  await page.getByRole("button", { name: "Turn on the live community" }).click();
  const on = page.getByRole("region", { name: "Live community" });
  await expect(on).toContainText("for 3 days while they're there");
  await expect(on).toContainText("waits on the Monitor page");
  await expect(on).toContainText("each participant's is their own");
  await page.screenshot({ path: testInfo.outputPath("live.png"), fullPage: true });

  // It's kept: the page comes back as it was left.
  await page.reload();
  await expect(page.getByRole("radio", { name: /While the study runs/ })).toBeChecked();
  await expect(page.getByLabel("Days while they're there")).toHaveValue("3");
  await expect(page.getByRole("checkbox", { name: /Hold each day/ })).toBeChecked();
  await expect(page.getByLabel(/The most one participant's community can cost/)).toHaveValue(
    "0.75",
  );

  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  await study.getByRole("button", { name: "Launch", exact: true }).click();
  const launching = page.getByRole("dialog", { name: /Launch version/ });
  await launching.getByLabel(/only a test/).check();
  await launching.getByRole("button", { name: "Launch it" }).click();
  await expect(study.getByText("Open to participants")).toBeVisible();
  await study.getByRole("link", { name: "Monitor and download" }).click();
  const card = page.getByRole("region", { name: "Live community" });
  await expect(card).toContainText("Each day waits here for you");
  await expect(card).toContainText("Each can cost up to $0.75");
  await expect(card.getByRole("status")).toContainText("Nothing more is being written.");
  await card.screenshot({ path: testInfo.outputPath("monitor.png") });
});

// Persona cards as a form on the Cast page, kept in beats.yaml.
test("a researcher fills in someone's persona card on the Cast page", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  await page.goto(`http://localhost:${ADMIN_PORT}`);
  await page.getByLabel("Email").fill(otherLabEmail as string);
  await page.getByLabel("Password").fill(otherLabPassword as string);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(`Cards ${Date.now() % 1_000_000}`);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();
  await page.getByRole("link", { name: "Cast", exact: true }).click();

  const person = page.getByRole("listitem", { name: "Maya Reyes" });
  await person.getByText("Persona card").click();
  await expect(person.getByText("(empty)")).toBeVisible();
  await person.getByLabel("How they write").fill("Short sentences, no emoji.");
  await person.getByLabel("Add someone Maya Reyes has feelings about").selectOption({
    label: "Whoever takes part",
  });
  await person.getByLabel("How Maya Reyes feels about participant").fill("Curious about them.");
  await person.getByLabel(/What they never say/).fill("Never gives medical advice.");
  await person.getByRole("button", { name: "Save Maya Reyes's card" }).click();
  await expect(person.getByRole("status")).toHaveText("Saved");
  await expect(person.getByText("(filled in)")).toBeVisible();
  await person.screenshot({ path: testInfo.outputPath("card.png") });

  // It's in beats.yaml, where the model reads it, and comes back after a reload.
  await page.getByRole("link", { name: "Beats", exact: true }).click();
  await expect(page.getByRole("textbox").first()).toHaveValue(/voice: Short sentences, no emoji\./);
  await page.getByRole("link", { name: "Cast", exact: true }).click();
  await page.reload();
  const again = page.getByRole("listitem", { name: "Maya Reyes" });
  await again.getByText("Persona card").click();
  await expect(again.getByLabel("How they write")).toHaveValue("Short sentences, no emoji.");
  await expect(again.getByLabel("How Maya Reyes feels about participant")).toHaveValue(
    "Curious about them.",
  );
});
