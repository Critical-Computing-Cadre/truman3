import { randomUUID } from "node:crypto";
import { makeOperator, setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { memoryMailer } from "../mail.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const mailer = memoryMailer();
const ADMIN = "https://truman.test/admin/";
const PASSWORD = "a long enough password";

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
    hosted: true,
    mailer,
    adminAppUrl: ADMIN,
  });
});

beforeEach(() => {
  mailer.sent.length = 0;
});

afterAll(async () => {
  storage.close();
  await database.destroy();
});

const json = async <T = Record<string, unknown>>(response: Response) =>
  (await response.json()) as T;
const cookieOf = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
const send = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const signIn = async (email: string, password: string) =>
  cookieOf(await send("", "POST", "/admin/login", { email, password }));
/** The token in the link of the last email sent to someone. */
function tokenFor(email: string) {
  const mail = mailer.sent.filter(({ to }) => to === email).at(-1);
  const match = /\?token=([\w-]+)/.exec(mail?.text ?? "");
  return match?.[1] ?? "";
}

async function lab() {
  const id = randomUUID().slice(0, 8);
  const email = `owner-${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `Lab ${id}`,
    slug: `lab-${id}`,
    email,
    name: "Olive Owner",
  });
  return { id, teamId, email, cookie: await signIn(email, password as string) };
}

describe("resetting a forgotten password (ADR 72)", () => {
  it("emails a link that works once, signs them in, and signs them out elsewhere", async () => {
    const owner = await lab();
    expect((await send("", "POST", "/admin/password-reset", { email: owner.email })).status).toBe(
      200,
    );
    const [mail] = mailer.sent;
    expect(mail?.to).toBe(owner.email);
    expect(mail?.text).toContain(`${ADMIN}reset?token=`);
    const token = tokenFor(owner.email);

    const done = await send("", "POST", "/admin/password-reset/complete", {
      token,
      password: "a brand new password",
    });
    expect(done.status).toBe(200);
    expect((await send(cookieOf(done), "GET", "/admin/me")).status).toBe(200);
    // The old session is gone, and the new password works.
    expect((await send(owner.cookie, "GET", "/admin/me")).status).toBe(401);
    expect(await signIn(owner.email, "a brand new password")).not.toBe("");

    const again = await send("", "POST", "/admin/password-reset/complete", {
      token,
      password: "yet another password",
    });
    expect(again.status).toBe(400);
  });

  it("answers the same for an email with no account, and sends nothing", async () => {
    const response = await send("", "POST", "/admin/password-reset", {
      email: "nobody@example.edu",
    });
    expect(response.status).toBe(200);
    expect(mailer.sent).toEqual([]);
  });

  it("refuses a link that's run out", async () => {
    const owner = await lab();
    await send("", "POST", "/admin/password-reset", { email: owner.email });
    await database.db
      .update(schema.researcherLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.researcherLinks.email, owner.email));
    const late = await send("", "POST", "/admin/password-reset/complete", {
      token: tokenFor(owner.email),
      password: "a brand new password",
    });
    expect(late.status).toBe(400);
  });
});

describe("inviting someone to a team (ADR 72)", () => {
  it("emails someone new a link, where they make an account and join", async () => {
    const owner = await lab();
    const email = `new-${owner.id}@example.edu`;
    const invited = await send(owner.cookie, "POST", `/admin/teams/${owner.teamId}/invites`, {
      email,
      role: "editor",
    });
    expect(invited.status).toBe(200);
    expect(mailer.sent[0]).toMatchObject({
      to: email,
      subject: `Olive Owner invited you to Lab ${owner.id} on Truman`,
    });
    const token = tokenFor(email);

    const members = await json<{ invites: { email: string }[] }>(
      await send(owner.cookie, "GET", `/admin/teams/${owner.teamId}/members`),
    );
    expect(members.invites.map((invite) => invite.email)).toEqual([email]);

    expect(await json(await send("", "GET", `/admin/invites/${token}`))).toMatchObject({
      team: `Lab ${owner.id}`,
      role: "editor",
      email,
      hasAccount: false,
      invitedBy: "Olive Owner",
    });
    expect((await send("", "POST", `/admin/invites/${token}/accept`, {})).status).toBe(400);
    const accepted = await send("", "POST", `/admin/invites/${token}/accept`, {
      name: "Ned New",
      password: PASSWORD,
    });
    expect(accepted.status).toBe(200);
    const me = await json<{ teams: { name: string; role: string }[] }>(
      await send(cookieOf(accepted), "GET", "/admin/me"),
    );
    expect(me.teams).toEqual([
      expect.objectContaining({ name: `Lab ${owner.id}`, role: "editor" }),
    ]);
    expect((await send("", "GET", `/admin/invites/${token}`)).status).toBe(404);
  });

  it("asks someone with an account to sign in as them, and no one else", async () => {
    const owner = await lab();
    const other = await lab();
    await send(owner.cookie, "POST", `/admin/teams/${owner.teamId}/invites`, {
      email: other.email,
      role: "viewer",
    });
    const token = tokenFor(other.email);
    expect(await json(await send("", "GET", `/admin/invites/${token}`))).toMatchObject({
      hasAccount: true,
    });
    expect((await send("", "POST", `/admin/invites/${token}/accept`, {})).status).toBe(401);
    expect((await send(owner.cookie, "POST", `/admin/invites/${token}/accept`, {})).status).toBe(
      403,
    );
    expect((await send(other.cookie, "POST", `/admin/invites/${token}/accept`, {})).status).toBe(
      200,
    );
  });

  it("lets only owners invite, change roles, and take people off, and keeps an owner", async () => {
    const owner = await lab();
    const email = `editor-${owner.id}@example.edu`;
    await send(owner.cookie, "POST", `/admin/teams/${owner.teamId}/invites`, {
      email,
      role: "editor",
    });
    const joined = await send("", "POST", `/admin/invites/${tokenFor(email)}/accept`, {
      name: "Eda Editor",
      password: PASSWORD,
    });
    const editor = cookieOf(joined);
    const { members } = await json<{ members: { id: string; email: string }[] }>(
      await send(owner.cookie, "GET", `/admin/teams/${owner.teamId}/members`),
    );
    const editorId = members.find((member) => member.email === email)?.id as string;
    const ownerId = members.find((member) => member.email === owner.email)?.id as string;

    const byEditor = await send(editor, "POST", `/admin/teams/${owner.teamId}/invites`, {
      email: "someone@example.edu",
      role: "viewer",
    });
    expect(byEditor.status).toBe(403);
    expect(
      (
        await send(owner.cookie, "POST", `/admin/teams/${owner.teamId}/invites`, {
          email,
          role: "viewer",
        })
      ).status,
    ).toBe(409);

    // The only owner can't step down or leave.
    expect(
      (
        await send(owner.cookie, "PATCH", `/admin/teams/${owner.teamId}/members/${ownerId}`, {
          role: "editor",
        })
      ).status,
    ).toBe(409);
    expect(
      (await send(owner.cookie, "DELETE", `/admin/teams/${owner.teamId}/members/${ownerId}`))
        .status,
    ).toBe(409);

    expect(
      (
        await send(owner.cookie, "PATCH", `/admin/teams/${owner.teamId}/members/${editorId}`, {
          role: "viewer",
        })
      ).status,
    ).toBe(200);
    // Anyone can leave.
    expect(
      (await send(editor, "DELETE", `/admin/teams/${owner.teamId}/members/${editorId}`)).status,
    ).toBe(200);
    expect((await send(editor, "GET", `/admin/teams/${owner.teamId}/members`)).status).toBe(404);
  });
});

describe("news about a lab's application, on a hosted Truman (ADR 72)", () => {
  it("tells the applicant and the operators, then the owners when it's approved", async () => {
    const id = randomUUID().slice(0, 8);
    const operatorEmail = `op-${id}@example.org`;
    const { password } = await setUpTeam(database.db, {
      teamName: `Ops ${id}`,
      slug: `ops-${id}`,
      email: operatorEmail,
      name: "Op",
    });
    await makeOperator(database.db, operatorEmail);
    const operator = await signIn(operatorEmail, password as string);
    mailer.sent.length = 0;

    const email = `applicant-${id}@example.edu`;
    await send("", "POST", "/admin/apply", {
      lab: `Applied ${id}`,
      name: "Pat",
      email,
      password: PASSWORD,
      institution: "State University",
      purpose: "Labels and sharing.",
    });
    expect(mailer.sent.find(({ to }) => to === email)?.subject).toBe(
      `We've got Applied ${id}'s application to use Truman`,
    );
    const notice = mailer.sent.find(({ to }) => to === operatorEmail);
    expect(notice?.text).toContain("Labels and sharing.");
    expect(notice?.text).toContain(`${ADMIN}operator`);

    const [team] = await database.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.name, `Applied ${id}`));
    mailer.sent.length = 0;
    await send(operator, "PATCH", `/admin/operator/teams/${team?.id}`, { status: "approved" });
    expect(mailer.sent).toEqual([
      expect.objectContaining({
        to: email,
        subject: `Applied ${id} is approved to use Truman`,
        text: expect.stringContaining("10 studies open at once"),
      }),
    ]);
  });
});
