import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createFakeProlific } from "@truman3/recruit/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { createReminders, DEFAULT_MESSAGE } from "./reminders.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const fake = createFakeProlific({ tokens: ["good-token", "other-token"] });
/** How far the server's clock is ahead of the real one. */
let hoursOn = 0;
let reminding: Parameters<typeof createReminders>[0];
const dirs: string[] = [];
const TOKEN = "good-token";

async function signIn(email: string, password: string) {
  const response = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const draftBody = {
  project: "project-ws-1",
  name: "A study",
  description: "What it is",
  minutes: 10,
  reward: 250,
  places: 5,
  reviewMode: "manual",
  rules: {},
};

/** A lab with an owner, a launched study, and a choice of what its exit step does. */
async function lab({ exit = "{ step: exit }" } = {}) {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-prolific-"));
  dirs.push(dir);
  const slug = `prolific-${id}`;
  writeFileSync(
    path.join(dir, "study.yaml"),
    `
schemaVersion: 1
slug: ${slug}
title: Prolific test
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PROLIFIC_PID, idLabel: Prolific ID, source: prolific }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
media: { baseUrl: "https://cdn.example.com/m" }
flow:
  - { step: consent, page: pages/consent.md }
  - { step: feed, finishAfterMinutes: 0 }
  - ${exit}
`,
  );
  mkdirSync(path.join(dir, "pages"));
  writeFileSync(path.join(dir, "pages/consent.md"), "Consent text");
  writeFileSync(path.join(dir, "actors.csv"), "username,name\nsam,Sam\n");
  writeFileSync(path.join(dir, "posts.csv"), "id,body,actor,likes,time\np1,Hello,sam,0,-1:00\n");
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true, teamId });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  const [study] = await database.db
    .select()
    .from(schema.studies)
    .where(eq(schema.studies.slug, slug));
  if (!study) {
    throw new Error("No study.");
  }
  return {
    id,
    slug,
    email,
    teamSlug: `lab-${id}`,
    versionId: imported.studyVersionId,
    cookie: await signIn(email, password as string),
    study,
  };
}

async function connected(options?: Parameters<typeof lab>[0]) {
  const made = await lab(options);
  expect((await call(made.cookie, "PUT", "/admin/prolific", { token: TOKEN })).status).toBe(200);
  return made;
}

async function linked(options?: Parameters<typeof lab>[0], body: object = draftBody) {
  const made = await connected(options);
  const response = await call(
    made.cookie,
    "POST",
    `/admin/studies/${made.study.id}/prolific`,
    body,
  );
  expect(response.status).toBe(200);
  const { prolificStudyId } = (await response.json()) as { prolificStudyId: string };
  return { ...made, prolificStudyId };
}

async function colleague(teamSlug: string, role: "viewer" | "editor") {
  const email = `${role}-${randomUUID().slice(0, 8)}@example.edu`;
  const added = await addResearcherToTeam(database.db, { teamSlug, email, name: role, role });
  return signIn(email, added.password as string);
}

/** Someone arrives from Prolific and moves through the flow, returning their session cookie. */
async function join(slug: string, pid: string) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: pid }),
  });
  expect(response.status).toBeLessThan(300);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const flowAction = (cookie: string, url: string, position: number) =>
  call(cookie, "POST", url, {
    position,
    clientEventId: randomUUID(),
    occurredAt: new Date().toISOString(),
  });

async function finish(cookie: string) {
  await flowAction(cookie, "/me/flow/advance", 0);
  await flowAction(cookie, "/me/flow/advance", 1);
  const response = await flowAction(cookie, "/me/flow/advance", 2);
  return (await response.json()) as { finished: boolean; redirectUrl: string | null };
}

const stateOf = async (cookie: string, studyId: string) =>
  (await (await call(cookie, "GET", `/admin/studies/${studyId}/prolific`)).json()) as {
    link: { finishedUrl: string; rules: object; prolificStatus: string } | null;
    surveyAfter: boolean;
    submissions: {
      id: string;
      prolificId: string;
      inStudy: string | null;
      problems: string[];
      code: string;
    }[];
    submissionsProblem: string | null;
    actions: { action: string; by: string; people: number | null }[];
  };

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  reminding = {
    db: database.db,
    participantDomains: ["eatsnap.test"],
    prolific: {
      secretKey: randomBytes(32).toString("base64"),
      apiUrl: "https://prolific.test",
      participantAppUrl: "https://truman.test",
      fetch: fake.fetch,
    },
    // Time can be moved on, to see who's due a reminder after a day away.
    clock: () => new Date(Date.now() + hoursOn * 60 * 60 * 1000),
  };
  app = createApp({
    pingDatabase: database.ping,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
    ...reminding,
  });
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

describe("connecting an account", () => {
  it("checks the token, stores it encrypted, and never gives it back", async () => {
    const { cookie } = await lab();
    const before = await (await call(cookie, "GET", "/admin/prolific")).json();
    expect(before).toEqual({ available: true, connected: false, name: null });

    const response = await call(cookie, "PUT", "/admin/prolific", { token: TOKEN });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toEqual({ available: true, connected: true, name: "Pat Researcher" });

    const rows = await database.db.select().from(schema.prolificConnections);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tokenEncrypted).not.toContain(TOKEN);
    }
  });

  it("refuses a token Prolific doesn't accept", async () => {
    const { cookie } = await lab();
    const response = await call(cookie, "PUT", "/admin/prolific", { token: "nope" });
    expect(response.status).toBe(400);
    expect((await call(cookie, "GET", "/admin/prolific")).status).toBe(200);
    const state = (await (await call(cookie, "GET", "/admin/prolific")).json()) as {
      connected: boolean;
    };
    expect(state.connected).toBe(false);
  });

  it("forgets the token when someone disconnects", async () => {
    const { cookie } = await connected();
    await call(cookie, "DELETE", "/admin/prolific");
    const state = (await (await call(cookie, "GET", "/admin/prolific")).json()) as {
      connected: boolean;
    };
    expect(state.connected).toBe(false);
  });

  it("is turned off without a secret key", async () => {
    const plain = createApp({
      pingDatabase: database.ping,
      db: database.db,
      storage,
      mediaPublicUrl: "http://media.test",
      getClientIp: () => undefined,
      secureCookies: false,
    });
    const { cookie } = await lab();
    const state = await (await plain.request("/admin/prolific", { headers: { cookie } })).json();
    expect(state).toEqual({ available: false, connected: false, name: null });
    const refused = await plain.request("/admin/prolific", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(refused.status).toBe(503);
  });
});

describe("creating a draft", () => {
  it("sends people to the study's own participant domain, if it has one (ADR 74)", async () => {
    const made = await connected();
    const chosen = await call(made.cookie, "PUT", `/admin/studies/${made.study.id}/address`, {
      domain: "eatsnap.test",
    });
    expect(chosen.status).toBe(200);
    const response = await call(
      made.cookie,
      "POST",
      `/admin/studies/${made.study.id}/prolific`,
      draftBody,
    );
    const { prolificStudyId } = (await response.json()) as { prolificStudyId: string };
    expect(fake.studies.get(prolificStudyId)?.body.external_study_url).toMatch(
      new RegExp(`^https://eatsnap\\.test/join/${made.slug}\\?`),
    );
  });

  it("makes an unpublished draft with the study's link and its codes", async () => {
    const { slug, prolificStudyId, cookie, study } = await linked();
    const created = fake.studies.get(prolificStudyId);
    expect(created?.body.external_study_url).toBe(
      `https://truman.test/join/${slug}?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`,
    );
    expect(created?.body.prolific_id_option).toBe("url_parameters");
    const codes = created?.body.completion_codes as {
      code_type: string;
      actions: { action: string }[];
    }[];
    expect(codes.map(({ code_type }) => code_type)).toEqual(["COMPLETED", "NO_CONSENT"]);
    expect(codes[0]?.actions[0]?.action).toBe("MANUALLY_REVIEW");
    expect(codes[1]?.actions[0]?.action).toBe("REQUEST_RETURN");

    // Truman has no way to publish, so nothing asked Prolific to.
    expect(fake.requests.some(({ path }) => path.includes("/transition"))).toBe(false);

    const state = await stateOf(cookie, study.id);
    expect(state.link?.prolificStatus).toBe("UNPUBLISHED");
    expect(state.actions[0]?.action).toBe("created draft");
  });

  it("only links a study once, and shows Prolific's own errors", async () => {
    const { cookie, study } = await linked();
    const again = await call(cookie, "POST", `/admin/studies/${study.id}/prolific`, draftBody);
    expect(again.status).toBe(409);

    const other = await connected();
    const bad = await call(other.cookie, "POST", `/admin/studies/${other.study.id}/prolific`, {
      ...draftBody,
      reward: 1,
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Prolific said: The reward is too low." });
    expect((await stateOf(other.cookie, other.study.id)).link).toBeNull();
  });

  it("refuses automatic approval when a survey comes before Prolific", async () => {
    const { cookie, study } = await connected({
      exit: '{ step: exit, redirect: "https://survey.example.com/s?id={participantId}" }',
    });
    const response = await call(cookie, "POST", `/admin/studies/${study.id}/prolific`, {
      ...draftBody,
      reviewMode: "automatic",
    });
    expect(response.status).toBe(400);
  });

  it("keeps viewers out, and other labs' researchers", async () => {
    const { study, teamSlug } = await linked();
    const viewerCookie = await colleague(teamSlug, "viewer");
    expect((await call(viewerCookie, "GET", `/admin/studies/${study.id}/prolific`)).status).toBe(
      403,
    );
    const stranger = await lab();
    expect((await call(stranger.cookie, "GET", `/admin/studies/${study.id}/prolific`)).status).toBe(
      404,
    );
  });
});

describe("leaving the study", () => {
  it("sends someone who finishes back to Prolific with the finished code", async () => {
    const { slug, cookie, study } = await linked();
    const state = await stateOf(cookie, study.id);
    const participant = await join(slug, `pid-${randomUUID()}`);
    const result = await finish(participant);
    expect(result.finished).toBe(true);
    expect(result.redirectUrl).toBe(state.link?.finishedUrl);
  });

  it("leaves a study's survey link alone", async () => {
    const { slug } = await linked({
      exit: '{ step: exit, redirect: "https://survey.example.com/s?id={participantId}" }',
    });
    const participant = await join(slug, `pid-${randomUUID()}`);
    const { redirectUrl } = await finish(participant);
    expect(redirectUrl).toContain("survey.example.com");
  });

  it("sends someone who declines back with the code asking them to return", async () => {
    const { slug, prolificStudyId } = await linked();
    const participant = await join(slug, `pid-${randomUUID()}`);
    const response = await call(participant, "POST", "/me/flow/decline", {
      position: 0,
      clientEventId: randomUUID(),
      occurredAt: new Date().toISOString(),
    });
    const { redirectUrl } = (await response.json()) as { redirectUrl: string };
    const codes = fake.studies.get(prolificStudyId)?.body.completion_codes as {
      code: string;
      code_type: string;
    }[];
    expect(redirectUrl).toContain(codes.find(({ code_type }) => code_type === "NO_CONSENT")?.code);
  });

  it("with automatic approval, only pays straight away if the rules are met", async () => {
    const { slug, prolificStudyId } = await linked(undefined, {
      ...draftBody,
      reviewMode: "automatic",
      rules: { minPostsSeen: 1 },
    });
    const codes = fake.studies.get(prolificStudyId)?.body.completion_codes as {
      code: string;
      code_type: string;
      actions: { action: string }[];
    }[];
    const paysNow = codes.find(({ code_type }) => code_type === "COMPLETED");
    const review = codes.find(({ code_type }) => code_type === "OTHER");
    expect(paysNow?.actions[0]?.action).toBe("AUTOMATICALLY_APPROVE");
    expect(review?.actions[0]?.action).toBe("MANUALLY_REVIEW");

    const participant = await join(slug, `pid-${randomUUID()}`);
    const { redirectUrl } = await finish(participant);
    expect(redirectUrl).toContain(review?.code);
    expect(redirectUrl).not.toContain(paysNow?.code);
  });

  it("doesn't send test participants to Prolific", async () => {
    const { cookie, versionId } = await linked();
    const started = await call(cookie, "POST", `/admin/versions/${versionId}/pilot`, {
      condition: "a",
    });
    expect(started.status).toBe(200);
    const { token } = (await started.json()) as { token: string };
    const entered = await app.request("/pilot-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const participant = (entered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const { finished, redirectUrl } = await finish(participant);
    expect(finished).toBe(true);
    expect(redirectUrl).toBeNull();
  });
});

describe("submissions", () => {
  it("matches them to people here, and says who can't be matched", async () => {
    const { slug, cookie, study, prolificStudyId } = await linked();
    const pid = `pid-${randomUUID()}`;
    await finish(await join(slug, pid));
    fake.addSubmission(prolificStudyId, { participant_id: pid });
    fake.addSubmission(prolificStudyId, { participant_id: "someone-who-withdrew" });
    // More than one page, so following pages gets tested too.
    fake.addSubmission(prolificStudyId, { participant_id: "another-person", status: "ACTIVE" });

    const { submissions } = await stateOf(cookie, study.id);
    expect(submissions).toHaveLength(3);
    const here = submissions.find(({ prolificId }) => prolificId === pid);
    expect(here?.inStudy).toBe("finished");
    expect(here?.problems).toEqual([]);
    const gone = submissions.find(({ prolificId }) => prolificId === "someone-who-withdrew");
    expect(gone?.inStudy).toBeNull();
    expect(gone?.problems[0]).toContain("Nobody here");
  });

  it("flags who didn't meet the rules, and rules can change", async () => {
    const { slug, cookie, study, prolificStudyId } = await linked();
    const pid = `pid-${randomUUID()}`;
    await finish(await join(slug, pid));
    fake.addSubmission(prolificStudyId, { participant_id: pid });
    const saved = await call(cookie, "PUT", `/admin/studies/${study.id}/prolific/rules`, {
      rules: { minActions: 2 },
    });
    expect(saved.status).toBe(200);
    const { submissions } = await stateOf(cookie, study.id);
    expect(submissions[0]?.problems).toEqual(["Did 0 of 2 actions"]);
  });

  it("uses each person's own access on Prolific", async () => {
    const { cookie, study, teamSlug } = await linked();
    const editorCookie = await colleague(teamSlug, "editor");

    // Not connected yet.
    let state = await stateOf(editorCookie, study.id);
    expect(state.submissionsProblem).toContain("Connect your Prolific account");

    // Connected, but their Prolific account can't reach this study.
    await call(editorCookie, "PUT", "/admin/prolific", { token: "other-token" });
    state = await stateOf(editorCookie, study.id);
    expect(state.submissionsProblem).toContain("can't do this");
    const refused = await call(
      editorCookie,
      "POST",
      `/admin/studies/${study.id}/prolific/approve`,
      {
        submissionIds: ["sub-x"],
      },
    );
    expect(refused.status).toBe(403);

    expect((await stateOf(cookie, study.id)).submissionsProblem).toBeNull();
  });
});

describe("approving and paying", () => {
  it("approves people waiting for review, and records who did it", async () => {
    const { cookie, study, prolificStudyId, email } = await linked();
    const waiting = fake.addSubmission(prolificStudyId);
    const response = await call(cookie, "POST", `/admin/studies/${study.id}/prolific/approve`, {
      submissionIds: [waiting.id],
    });
    expect(response.status).toBe(200);
    expect(fake.approved).toContain(waiting.id);
    const { actions } = await stateOf(cookie, study.id);
    expect(actions[0]).toMatchObject({ action: "approved", by: email, people: 1 });
  });

  it("approves nothing if any of them isn't waiting in this study", async () => {
    const { cookie, study, prolificStudyId } = await linked();
    const waiting = fake.addSubmission(prolificStudyId);
    const active = fake.addSubmission(prolificStudyId, { status: "ACTIVE" });
    const response = await call(cookie, "POST", `/admin/studies/${study.id}/prolific/approve`, {
      submissionIds: [waiting.id, active.id],
    });
    expect(response.status).toBe(409);
    expect(fake.approved).not.toContain(waiting.id);
  });

  it("setting up a bonus pays nobody, and paying only works once", async () => {
    const { cookie, study, prolificStudyId } = await linked();
    const person = fake.addSubmission(prolificStudyId);
    const setup = await call(cookie, "POST", `/admin/studies/${study.id}/prolific/bonuses`, {
      submissionIds: [person.id],
      amount: 1.5,
    });
    expect(setup.status).toBe(200);
    const bonus = (await setup.json()) as { id: string; totalAmount: number; people: number };
    expect(bonus).toMatchObject({ people: 1, totalAmount: 160 });
    expect(fake.bonuses.get(bonus.id)).toMatchObject({ csv: `${person.id},1.50`, paid: 0 });

    const url = `/admin/studies/${study.id}/prolific/bonuses/${bonus.id}/pay`;
    const [first, second] = await Promise.all([
      call(cookie, "POST", url),
      call(cookie, "POST", url),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(fake.bonuses.get(bonus.id)?.paid).toBe(1);
    const third = await call(cookie, "POST", url);
    expect(third.status).toBe(409);
    expect(fake.bonuses.get(bonus.id)?.paid).toBe(1);

    const { actions } = await stateOf(cookie, study.id);
    expect(actions[0]).toMatchObject({ action: "paid bonus", people: 1 });
  });

  it("won't set up a bonus for someone outside the study", async () => {
    const { cookie, study } = await linked();
    const response = await call(cookie, "POST", `/admin/studies/${study.id}/prolific/bonuses`, {
      submissionIds: ["someone-else"],
      amount: 1,
    });
    expect(response.status).toBe(409);
  });

  it("won't pay a bonus belonging to another study", async () => {
    const one = await linked();
    const two = await linked();
    const person = fake.addSubmission(one.prolificStudyId);
    const setup = await call(
      one.cookie,
      "POST",
      `/admin/studies/${one.study.id}/prolific/bonuses`,
      {
        submissionIds: [person.id],
        amount: 1,
      },
    );
    const { id } = (await setup.json()) as { id: string };
    const response = await call(
      two.cookie,
      "POST",
      `/admin/studies/${two.study.id}/prolific/bonuses/${id}/pay`,
    );
    expect(response.status).toBe(409);
    expect(fake.bonuses.get(id)?.paid).toBe(0);
  });
});

describe("unlinking", () => {
  it("stops sending people to Prolific, and records it", async () => {
    const { slug, cookie, study } = await linked();
    expect((await call(cookie, "DELETE", `/admin/studies/${study.id}/prolific`)).status).toBe(200);
    const { redirectUrl } = await finish(await join(slug, `pid-${randomUUID()}`));
    expect(redirectUrl).toBeNull();
    const state = await stateOf(cookie, study.id);
    expect(state.link).toBeNull();
    expect(state.actions[0]?.action).toBe("unlinked");
  });
});

describe("reminders to come back (ADR 90)", () => {
  const remindersOf = async (cookie: string, studyId: string) =>
    (await (await call(cookie, "GET", `/admin/studies/${studyId}/prolific/reminders`)).json()) as {
      on: boolean;
      afterHours: number;
      message: string;
      by: string | null;
      due: number | null;
      problem: string | null;
      sent: { day: string; people: number }[];
    };
  const save = (cookie: string, studyId: string, body: object) =>
    call(cookie, "PUT", `/admin/studies/${studyId}/prolific/reminders`, body);
  const sendNow = async (cookie: string, studyId: string) =>
    (await (
      await call(cookie, "POST", `/admin/studies/${studyId}/prolific/reminders/send`)
    ).json()) as { sent: number; failed: number };
  const to = (studyId: string) =>
    fake.messages.filter((message) => message.studyId === studyId).map((message) => message);

  /** A study with three people from Prolific: one part way, one finished, one who never arrived. */
  async function underWay() {
    hoursOn = 0;
    const made = await linked();
    const away = fake.addSubmission(made.prolificStudyId, { status: "ACTIVE" });
    const done = fake.addSubmission(made.prolificStudyId);
    fake.addSubmission(made.prolificStudyId, { status: "ACTIVE" });
    const returned = fake.addSubmission(made.prolificStudyId, { status: "RETURNED" });
    await join(made.slug, away.participant_id);
    await join(made.slug, returned.participant_id);
    await finish(await join(made.slug, done.participant_id));
    return { ...made, away: away.participant_id };
  }

  afterAll(() => {
    hoursOn = 0;
  });

  it("starts off, with a message that has their link in it, and nobody due yet", async () => {
    const made = await underWay();
    const state = await remindersOf(made.cookie, made.study.id);
    expect(state).toMatchObject({ on: false, afterHours: 20, by: null, due: 0, problem: null });
    expect(state.message).toBe(DEFAULT_MESSAGE);
    expect(state.message).toContain("{link}");
  });

  it("is due for someone part way through who's been away, and nobody else", async () => {
    const made = await underWay();
    hoursOn = 21;
    // Not the one who finished, the one who returned it on Prolific, or the one who never came.
    expect((await remindersOf(made.cookie, made.study.id)).due).toBe(1);
    expect(await sendNow(made.cookie, made.study.id)).toEqual({ sent: 1, failed: 0 });
    expect(to(made.prolificStudyId)).toEqual([
      {
        studyId: made.prolificStudyId,
        recipientId: made.away,
        body: `You're part way through Demo, and there's more to see. Pick up where you left off: https://truman.test/join/${made.slug}?PROLIFIC_PID=${made.away}`,
      },
    ]);
    const state = await stateOf(made.cookie, made.study.id);
    expect(state.actions[0]).toMatchObject({ action: "sent reminders", people: 1 });
  });

  it("sends nobody two in a day, however many times it's asked", async () => {
    const made = await underWay();
    hoursOn = 21;
    await sendNow(made.cookie, made.study.id);
    expect(await sendNow(made.cookie, made.study.id)).toEqual({ sent: 0, failed: 0 });
    expect((await remindersOf(made.cookie, made.study.id)).due).toBe(0);
    expect(to(made.prolificStudyId)).toHaveLength(1);
    // The next day they're due again, having still not come back.
    hoursOn = 46;
    expect((await remindersOf(made.cookie, made.study.id)).due).toBe(1);
    expect((await remindersOf(made.cookie, made.study.id)).sent).toHaveLength(1);
  });

  it("stops once the study's days are up for them", async () => {
    const made = await underWay();
    // The study lasts two days.
    hoursOn = 49;
    expect((await remindersOf(made.cookie, made.study.id)).due).toBe(0);
    expect(await sendNow(made.cookie, made.study.id)).toEqual({ sent: 0, failed: 0 });
  });

  it("the link in it gets them back in as the same person", async () => {
    const made = await underWay();
    hoursOn = 21;
    await sendNow(made.cookie, made.study.id);
    const link = /https:\/\/truman\.test(\/join\/\S+)/.exec(
      to(made.prolificStudyId)[0]?.body ?? "",
    )?.[1] as string;
    const url = new URL(link, "https://truman.test");
    expect(url.pathname).toBe(`/join/${made.slug}`);
    const before = await database.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.studyId, made.study.id));
    await join(made.slug, url.searchParams.get("PROLIFIC_PID") as string);
    const after = await database.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.studyId, made.study.id));
    expect(after).toHaveLength(before.length);
  });

  it("goes out by itself once turned on, as whoever turned it on", async () => {
    const made = await underWay();
    const saved = await save(made.cookie, made.study.id, {
      on: true,
      afterHours: 6,
      message: "Day two is open. {link}",
    });
    expect(saved.status).toBe(200);
    expect(await remindersOf(made.cookie, made.study.id)).toMatchObject({
      on: true,
      afterHours: 6,
      by: "Owner",
    });
    const { sendAllDue } = createReminders(reminding);
    hoursOn = 5;
    await sendAllDue(reminding.clock?.());
    expect(to(made.prolificStudyId)).toEqual([]);
    hoursOn = 7;
    await sendAllDue(reminding.clock?.());
    await sendAllDue(reminding.clock?.());
    expect(to(made.prolificStudyId).map(({ body }) => body)).toEqual([
      `Day two is open. https://truman.test/join/${made.slug}?PROLIFIC_PID=${made.away}`,
    ]);
    const state = await stateOf(made.cookie, made.study.id);
    expect(state.actions.map(({ action, by }) => [action, by]).slice(0, 2)).toEqual([
      ["sent reminders", "the schedule"],
      ["turned reminders on", made.email],
    ]);

    // Turned off, nothing more goes.
    await save(made.cookie, made.study.id, { on: false, afterHours: 6, message: "x {link}" });
    hoursOn = 31;
    await sendAllDue(reminding.clock?.());
    expect(to(made.prolificStudyId)).toHaveLength(1);
  });

  it("needs {link} in the message, and a connected account to turn it on", async () => {
    const made = await underWay();
    const noLink = await save(made.cookie, made.study.id, {
      on: true,
      afterHours: 20,
      message: "Come back!",
    });
    expect(noLink.status).toBe(400);
    expect(((await noLink.json()) as { error: string }).error).toContain("{link}");

    const editor = await colleague(made.teamSlug, "editor");
    const notConnected = await save(editor, made.study.id, {
      on: true,
      afterHours: 20,
      message: "Back: {link}",
    });
    expect(notConnected.status).toBe(400);
    const viewer = await colleague(made.teamSlug, "viewer");
    expect(
      (await call(viewer, "GET", `/admin/studies/${made.study.id}/prolific/reminders`)).status,
    ).toBe(403);
  });

  it("gives back someone's turn when Prolific refuses their message", async () => {
    const made = await underWay();
    hoursOn = 21;
    fake.unreachable.add(made.away);
    expect(await sendNow(made.cookie, made.study.id)).toEqual({ sent: 0, failed: 1 });
    fake.unreachable.delete(made.away);
    expect(await sendNow(made.cookie, made.study.id)).toEqual({ sent: 1, failed: 0 });
  });

  it("isn't there for a study that doesn't recruit through Prolific", async () => {
    const made = await connected();
    expect(
      (await call(made.cookie, "GET", `/admin/studies/${made.study.id}/prolific/reminders`)).status,
    ).toBe(409);
  });
});
