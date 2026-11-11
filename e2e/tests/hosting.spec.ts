import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PORT } from "../playwright.config.ts";

const STATE_FILE = path.resolve(import.meta.dirname, "../.e2e-state.json");
const { operatorEmail, operatorPassword } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
  operatorEmail: string;
  operatorPassword: string;
};
const ADMIN = `http://localhost:${ADMIN_PORT}`;

test("a lab applies, builds while it waits, and an operator approves it (ADR 70)", async ({
  page,
  browser,
}, testInfo) => {
  const lab = `Hosted Lab ${testInfo.project.name}`;
  const email = `applicant-${testInfo.project.name}-${Date.now()}@example.edu`;

  await page.goto(ADMIN);
  await page.getByRole("button", { name: "Apply for your lab" }).click();
  await page.getByLabel("Lab or group").fill(lab);
  await page.getByLabel("University or institution").fill("State University");
  await page.getByLabel("What you'd like to study with Truman").fill("How labels change sharing.");
  await page.getByLabel("Your name").fill("Pat Applicant");
  await page.getByLabel("Your email").fill(email);
  await page.getByLabel("Choose a password").fill("a long enough password");
  await page.getByRole("button", { name: "Apply" }).click();

  // Signed in at once, and told what they can do while they wait.
  await expect(page.getByRole("status")).toContainText(`${lab} is waiting to be approved`);
  await page.screenshot({ path: testInfo.outputPath("waiting.png"), fullPage: true });

  // The operator sees the lab, by counts, and approves it.
  const context = await browser.newContext();
  const operator = await context.newPage();
  await operator.goto(ADMIN);
  await operator.getByLabel("Email").fill(operatorEmail);
  await operator.getByLabel("Password").fill(operatorPassword);
  await operator.getByRole("button", { name: "Sign in" }).click();
  await operator.getByRole("link", { name: "Labs" }).click();
  const card = operator.getByRole("region", { name: lab });
  await expect(card).toContainText("Waiting for approval");
  await expect(card).toContainText("How labels change sharing.");
  await expect(card).toContainText("0 studies, 0 open");
  await operator.screenshot({ path: testInfo.outputPath("labs.png"), fullPage: true });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toContainText("Approved");
  await expect(card.getByLabel("New participants a month")).toHaveValue("1000");
  await expect(card).toContainText("of a $5 starter budget");
  await context.close();

  await page.reload();
  await expect(page.getByRole("status")).toHaveCount(0);

  // The lab starts on the starter budget, then adds its own Claude key (ADR 71).
  await page.getByRole("link", { name: "Your lab" }).click();
  const mine = page.getByRole("region", { name: lab });
  await expect(mine).toContainText("$0.00 of $5.00 spent");
  await mine.getByLabel("Add your lab's Claude key").fill("sk-ant-e2e-test-key-wxyz");
  await mine.getByRole("button", { name: "Save key" }).click();
  await expect(mine).toContainText("ending …wxyz");
  await expect(mine.getByLabel("Replace your lab's Claude key")).toHaveValue("");
});
