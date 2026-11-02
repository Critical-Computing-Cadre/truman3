import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

const DAY = 24 * 3_600_000;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const folders: string[] = [];
let counter = 0;

const FULL_FLOW = `
flow:
  - { step: consent, page: pages/consent.md }
  - { step: account }
  - { step: page, page: pages/rules.md }
  - { step: feed, finishAfterMinutes: 10 }
  - { step: exit, redirect: "https://survey.example.com/s?id={participantId}" }
`;

async function importStudy(flow = FULL_FLOW) {
  counter += 1;
  const slug = `flow-${counter}`;
  const dir = mkdtempSync(path.join(tmpdir(), "truman-flow-"));
  folders.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Internal title
site: { name: PhotoApp }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
feed: { ranker: chronological }
media: { baseUrl: "https://cdn.example.com/m" }
${flow}
`,
    "pages/consent.md": "# Consent text",
    "pages/rules.md": "# The rules",
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": "id,body,actor,time\np1,hello,ann,0:00\n",
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const result = await importStudyFolder(database.db, storage, dir);
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return slug;
}

async function enter(slug: string, externalId = `person-${++counter}`) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const [row] = await database.db
    .select({
      participantId: schema.participants.id,
      worldId: schema.worldMemberships.worldId,
    })
    .from(schema.participants)
    .innerJoin(
      schema.worldMemberships,
      eq(schema.worldMemberships.participantId, schema.participants.id),
    )
    .where(eq(schema.participants.externalId, externalId));
  return { slug, externalId, cookie, ...row! };
}

type Person = Awaited<ReturnType<typeof enter>>;

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });

async function flowOf(person: Person) {
  const response = await app.request("/me/flow", { headers: { cookie: person.cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    step: string;
    position: number;
    pageText: string | null;
    canFinish: boolean;
    site: { name: string };
  };
}

function advance(person: Person, position: number, extra: object = {}) {
  return app.request("/me/flow/advance", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: person.cookie },
    body: JSON.stringify({ ...meta(), position, ...extra }),
  });
}

const startedAgo = (person: Person, ms: number) =>
  database.db
    .update(schema.worlds)
    .set({ startedAt: new Date(Date.now() - ms) })
    .where(eq(schema.worlds.id, person.worldId));

const eventsOf = (person: Person) =>
  database.db.select().from(schema.events).where(eq(schema.events.worldId, person.worldId));

const statusOf = async (person: Person) =>
  (
    await database.db
      .select({ status: schema.participants.status })
      .from(schema.participants)
      .where(eq(schema.participants.id, person.participantId))
  )[0]?.status;

async function goToFeed(person: Person) {
  for (const position of [0, 1, 2]) {
    expect((await advance(person, position)).status).toBe(200);
  }
}

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: true,
  });
});

afterAll(async () => {
  storage.close();
  await database.destroy();
  for (const dir of folders) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("moving through the study", () => {
  it("goes through each step in order, with its page text", async () => {
    const person = await enter(await importStudy());

    expect(await flowOf(person)).toMatchObject({
      step: "consent",
      position: 0,
      pageText: "# Consent text",
      site: { name: "PhotoApp" },
    });

    await advance(person, 0);
    expect(await flowOf(person)).toMatchObject({ step: "account", position: 1, pageText: null });

    await advance(person, 1);
    expect(await flowOf(person)).toMatchObject({ step: "page", pageText: "# The rules" });

    await advance(person, 2);
    expect(await flowOf(person)).toMatchObject({ step: "feed", position: 3 });

    const completed = (await eventsOf(person)).filter((e) => e.type === "flow.step_completed");
    expect(completed.map((event) => event.payload)).toEqual([
      { step: "consent" },
      { step: "account" },
      { step: "page" },
    ]);
  });

  it("doesn't skip a step on a double click", async () => {
    const person = await enter(await importStudy());

    expect((await advance(person, 0)).status).toBe(200);
    expect((await advance(person, 0)).status).toBe(409);
    expect((await flowOf(person)).position).toBe(1);
  });

  it("picks up where they left off when they return", async () => {
    const slug = await importStudy();
    const person = await enter(slug);
    await advance(person, 0);
    await advance(person, 1);

    const back = await enter(slug, person.externalId);

    expect((await flowOf(back)).step).toBe("page");
  });

  it("requires signing in", async () => {
    expect((await app.request("/me/flow")).status).toBe(401);
  });
});

describe("leaving the feed", () => {
  it("isn't allowed until the time the study sets", async () => {
    const person = await enter(await importStudy());
    await goToFeed(person);

    expect((await flowOf(person)).canFinish).toBe(false);
    expect((await advance(person, 3)).status).toBe(409);
    expect((await flowOf(person)).step).toBe("feed");

    await startedAgo(person, 11 * 60_000);
    expect((await flowOf(person)).canFinish).toBe(true);
    expect((await advance(person, 3)).status).toBe(200);
    expect((await flowOf(person)).step).toBe("exit");
  });

  it("isn't allowed at all when the study doesn't set a time", async () => {
    const slug = await importStudy(`
flow:
  - { step: feed }
  - { step: exit }
`);
    const person = await enter(slug);
    await startedAgo(person, DAY);

    expect((await flowOf(person)).canFinish).toBe(false);
    expect((await advance(person, 0)).status).toBe(409);
  });

  it("happens by itself when the study's time is up, keeping the exit step", async () => {
    const person = await enter(await importStudy());
    await goToFeed(person);

    await startedAgo(person, 2 * DAY);

    expect(await flowOf(person)).toMatchObject({ step: "exit", position: 4 });
    expect(await statusOf(person)).toBe("active");
  });
});

describe("finishing", () => {
  async function atExit() {
    const slug = await importStudy();
    const person = await enter(slug);
    await goToFeed(person);
    await startedAgo(person, 2 * DAY);
    return person;
  }

  it("sends them to the survey, with their study ID rather than their recruitment ID", async () => {
    const person = await atExit();

    const response = await advance(person, 4);

    expect(await response.json()).toEqual({
      finished: true,
      redirectUrl: `https://survey.example.com/s?id=${person.participantId}`,
    });
    expect(await statusOf(person)).toBe("completed");
    expect((await eventsOf(person)).at(-1)).toMatchObject({
      type: "flow.exited",
      payload: { outcome: "completed" },
    });
  });

  it("puts them out for good: no session, and no way back in", async () => {
    const person = await atExit();
    await advance(person, 4);

    expect((await app.request("/me/flow", { headers: { cookie: person.cookie } })).status).toBe(
      401,
    );
    expect((await app.request("/feed", { headers: { cookie: person.cookie } })).status).toBe(401);
    const again = await app.request(`/studies/${person.slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: person.externalId }),
    });
    expect(again.status).toBe(403);
  });

  it("also ends a study with no exit step when the time's up", async () => {
    const slug = await importStudy("flow: [{ step: feed }]");
    const person = await enter(slug);
    await startedAgo(person, 2 * DAY);

    expect(await flowOf(person)).toMatchObject({ step: "done", position: 1 });
    expect(await (await advance(person, 1)).json()).toEqual({
      finished: true,
      redirectUrl: null,
    });
    expect(await statusOf(person)).toBe("completed");
  });
});

describe("the exit link", () => {
  const studyWithExit = (redirect: string) =>
    importStudy(`
flow:
  - { step: feed }
  - { step: exit, redirect: "${redirect}" }
`);

  it("passes the recruitment ID, so a participant never has to type it", async () => {
    const slug = await studyWithExit(
      "https://survey.example.com/s?PROLIFIC_PID={externalId}&USER_ID={participantId}",
    );
    const person = await enter(slug, `P&${counter} x`);
    await startedAgo(person, 2 * DAY);

    const { redirectUrl } = (await (await advance(person, 1)).json()) as { redirectUrl: string };
    const params = new URL(redirectUrl).searchParams;

    expect(params.get("PROLIFIC_PID")).toBe(person.externalId);
    expect(params.get("USER_ID")).toBe(person.participantId);
  });

  it("isn't shown to the browser until they finish", async () => {
    const slug = await studyWithExit("https://survey.example.com/s?PROLIFIC_PID={externalId}");
    const person = await enter(slug);

    const flow = await app.request("/me/flow", { headers: { cookie: person.cookie } });

    expect(await flow.text()).not.toContain(person.externalId);
  });
});

describe("declining consent", () => {
  const CONSENT = `
flow:
  - { step: consent, page: pages/consent.md, declineMessage: "Please return your submission." }
  - { step: feed }
`;
  const decline = (person: Person, position = 0) =>
    app.request("/me/flow/decline", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: person.cookie },
      body: JSON.stringify({ position }),
    });

  it("works like a withdrawal: their data is gone, and they can't come back", async () => {
    const slug = await importStudy(CONSENT);
    const person = await enter(slug);

    const response = await decline(person);

    expect(await response.json()).toEqual({
      message: "Please return your submission.",
      redirectUrl: null,
    });
    expect(await eventsOf(person)).toEqual([]);
    expect(
      await database.db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.id, person.participantId)),
    ).toEqual([]);
    expect((await app.request("/me/flow", { headers: { cookie: person.cookie } })).status).toBe(
      401,
    );

    const again = await app.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: person.externalId }),
    });
    expect(again.status).toBe(403);
  });

  it("leaves a record that says why, for counting in reports", async () => {
    const person = await enter(await importStudy(CONSENT));
    await decline(person);

    const [record] = await database.db
      .select()
      .from(schema.dataDeletions)
      .where(eq(schema.dataDeletions.participantId, person.participantId));
    expect(record).toMatchObject({ reason: "declined consent", requestedBy: "participant" });
    expect(record?.studyId).toBeTruthy();
  });

  it("has a default message, and can send them to a link instead", async () => {
    const plain = await enter(
      await importStudy("flow: [{ step: consent, page: pages/consent.md }, { step: feed }]"),
    );
    expect(await (await decline(plain)).json()).toMatchObject({
      message: expect.stringContaining("chosen not to take part"),
    });

    const linked = await enter(
      await importStudy(
        'flow: [{ step: consent, page: pages/consent.md, declineRedirect: "https://x.example/r?id={externalId}" }, { step: feed }]',
      ),
    );
    expect(await (await decline(linked)).json()).toMatchObject({
      redirectUrl: `https://x.example/r?id=${linked.externalId}`,
    });
  });

  it("can't be used after they've moved past consent", async () => {
    const person = await enter(await importStudy(CONSENT));
    await advance(person, 0);

    expect((await decline(person, 1)).status).toBe(409);
    expect(await statusOf(person)).toBe("active");
  });
});

describe("timing reports", () => {
  const report = (person: Person, events: object[]) =>
    app.request("/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: person.cookie },
      body: JSON.stringify({ events }),
    });

  const firstPost = async (person: Person) => {
    const response = await app.request("/feed", { headers: { cookie: person.cookie } });
    return ((await response.json()) as FeedResponse).posts[0]!;
  };

  it("records raw time on scripted content, even very short views", async () => {
    const person = await enter(await importStudy());
    const post = await firstPost(person);

    const response = await report(person, [
      {
        ...meta(),
        type: "content.viewed",
        targetContentId: post.id,
        payload: { dwellMs: 120, surface: "feed" },
      },
      { ...meta(), type: "page.viewed", payload: { page: "/feed" } },
      { ...meta(), type: "session.heartbeat", payload: { activeMs: 15000, page: "/feed" } },
    ]);

    expect(await response.json()).toEqual({ recorded: 3 });
    const viewed = (await eventsOf(person)).find((event) => event.type === "content.viewed");
    expect(viewed).toMatchObject({
      targetContentId: post.id,
      payload: { dwellMs: 120, surface: "feed" },
    });
  });

  it("counts a retried report once", async () => {
    const person = await enter(await importStudy());
    const event = { ...meta(), type: "page.viewed", payload: { page: "/feed" } };

    await report(person, [event]);
    expect(await (await report(person, [event])).json()).toEqual({ recorded: 0 });
  });

  it("ignores content this participant can't see", async () => {
    const person = await enter(await importStudy());

    const response = await report(person, [
      {
        ...meta(),
        type: "content.viewed",
        targetContentId: randomUUID(),
        payload: { dwellMs: 1, surface: "feed" },
      },
    ]);

    expect(await response.json()).toEqual({ recorded: 0 });
  });

  it("can't be used to fake other kinds of events", async () => {
    const person = await enter(await importStudy());

    const response = await report(person, [{ ...meta(), type: "flow.exited", payload: {} }]);

    expect(response.status).toBe(400);
    expect((await eventsOf(person)).map((event) => event.type)).toEqual(["session.started"]);
  });
});
