import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { ADMIN_PORT } from "../playwright.config.ts";

// A replication bundle (ADR 91): a researcher downloads a saved version as one zip file, and
// starts a new study from it, as someone at another lab would.

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { otherLabEmail, otherLabPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  otherLabEmail: string;
  otherLabPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test("a researcher downloads a study as a bundle, and starts a new study from it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once.");
  const stamp = Date.now() % 1_000_000;
  const title = `Bundled ${stamp}`;

  await page.goto(ADMIN);
  await page.getByLabel("Email").fill(otherLabEmail);
  await page.getByLabel("Password").fill(otherLabPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /Sample content/ }).check();
  await page.getByRole("radio", { name: /^Uniform/ }).check();
  await page.getByRole("button", { name: "Start the study" }).click();

  // Something of their own in it, to find again on the other side.
  const post = page.locator("article").first();
  await post.getByRole("button", { name: /Text of this post/ }).click();
  await post.getByLabel("Text of this post").fill(`Only in this study ${stamp}`);
  await post.getByLabel("Text of this post").blur();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  const flow = page.getByRole("region", { name: "Study flow" });
  await flow.getByLabel("Page text").first().fill(`The consent our board approved ${stamp}.`);
  await flow.getByRole("button", { name: "Save changes" }).first().click();
  await expect(flow.getByRole("button", { name: "Save changes" }).first()).toBeDisabled();
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await page.getByRole("button", { name: "Save as new version" }).click();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByRole("heading", { name: "Studies" })).toBeVisible();

  // The bundle, from the version's own row.
  const study = page.getByRole("listitem").filter({ hasText: title }).first();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    study.getByRole("button", { name: "Replication bundle" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`bundled-${stamp}-v1-replication.zip`);
  const file = testInfo.outputPath("bundle.zip");
  await download.saveAs(file);
  const inside = unzipSync(new Uint8Array(readFileSync(file)));
  expect(Object.keys(inside)).toEqual(
    expect.arrayContaining(["README.md", "study.json", "checksums.txt"]),
  );
  expect(Object.keys(inside).some((name) => name.startsWith("media/"))).toBe(true);
  const readme = new TextDecoder().decode(inside["README.md"]);
  expect(readme).toContain(`# ${title}, version 1`);
  // What participants agreed to is in it, as a record.
  expect(new TextDecoder().decode(inside["study.json"])).toContain(
    `The consent our board approved ${stamp}.`,
  );

  // Someone starts a study from it.
  const copy = `From the bundle ${stamp}`;
  await page.getByRole("link", { name: "New study" }).click();
  await page.getByLabel("Title").fill(copy);
  await page.getByRole("radio", { name: "From a replication bundle" }).check();
  // What a bundle already decides isn't asked.
  await expect(page.getByText("What kind of platform is it?")).toBeHidden();
  await expect(page.getByText("How are people assigned to conditions?")).toBeHidden();
  await expect(page.getByRole("button", { name: "Load the study" })).toBeDisabled();
  await page.getByLabel("The bundle's zip file").setInputFiles(file);
  await page.getByRole("button", { name: "Load the study" }).click();

  // It opens as a draft with the same feed, pictures and all.
  await expect(page.getByRole("button", { name: "Save as new version" })).toBeVisible();
  await expect(page.getByText(`Only in this study ${stamp}`).first()).toBeVisible();
  const picture = page.locator("article img").first();
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);

  // The other lab's consent isn't theirs to show. The page has the placeholder.
  await page.getByRole("link", { name: "Settings" }).click();
  const consent = page.getByRole("region", { name: "Study flow" }).getByLabel("Page text").first();
  await expect(consent).not.toHaveValue(new RegExp(`${stamp}`));
  await expect(consent).toHaveValue(/Replace this/);
});
