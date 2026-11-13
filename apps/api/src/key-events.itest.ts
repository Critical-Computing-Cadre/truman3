import { randomUUID } from "node:crypto";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Mail } from "./mail.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const sent: Mail[] = [];
const HOOK_KEY = "a-key-only-aws-and-this-server-know";
const SERVER = "arn:aws:iam::123456789012:role/truman3-test-api";
const EMERGENCY = "arn:aws:iam::123456789012:role/truman3-test-emergency";

async function lab() {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `Lab ${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  const keyId = `arn:aws:kms:us-east-1:123456789012:key/${randomUUID()}`;
  await database.db.update(schema.teams).set({ keyId }).where(eq(schema.teams.id, teamId));
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { teamId, keyId, email, cookie };
}

/** An event as AWS sends it: one call to its key service, from its own record of them. */
const event = (keyId: string, eventName = "Decrypt", by = EMERGENCY) => ({
  "detail-type": "AWS API Call via CloudTrail",
  source: "aws.kms",
  detail: {
    eventID: randomUUID(),
    eventTime: "2026-11-13T10:00:00Z",
    eventName,
    eventSource: "kms.amazonaws.com",
    userIdentity: {
      arn: `${by.replace(":iam:", ":sts:").replace(":role/", ":assumed-role/")}/someone`,
      sessionContext: { sessionIssuer: { arn: by } },
    },
    resources: [{ ARN: keyId, type: "AWS::KMS::Key" }],
  },
});
const report = (body: object, key = HOOK_KEY) =>
  app.request("/hooks/key-events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-truman-hook-key": key },
    body: JSON.stringify(body),
  });
const result = async (response: Response) => ((await response.json()) as { result: string }).result;
const recorded = (teamId: string) =>
  database.db.select().from(schema.keyEvents).where(eq(schema.keyEvents.teamId, teamId));

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mailer: { send: async (mail) => void sent.push(mail) },
    keyEventsHookKey: HOOK_KEY,
    ownRole: SERVER,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  });
});
beforeEach(() => {
  sent.length = 0;
});
afterAll(async () => {
  storage.close();
  await database.destroy();
});

describe("telling a lab when its key is used (ADR 83)", () => {
  it("records a use through the emergency role, and emails the lab's owners", async () => {
    const { teamId, keyId, email } = await lab();

    expect(await result(await report(event(keyId)))).toBe("recorded-and-told");

    expect(await recorded(teamId)).toMatchObject([
      { kind: "used", action: "Decrypt", by: EMERGENCY },
    ]);
    const toOwner = sent.find(({ to }) => to === email);
    expect(toOwner?.subject).toBe("Your lab's encryption key was used");
    expect(toOwner?.text).toContain(EMERGENCY);
    expect(toOwner?.text).toContain("2026-11-13T10:00:00.000Z");
  });

  it("records everything in the next hour, with one email for all of it", async () => {
    const { teamId, keyId, email } = await lab();
    await report(event(keyId));
    expect(await result(await report(event(keyId)))).toBe("recorded");
    expect(await result(await report(event(keyId, "GenerateDataKey")))).toBe("recorded");

    expect(await recorded(teamId)).toHaveLength(3);
    expect(sent.filter(({ to }) => to === email)).toHaveLength(1);
  });

  it("says so when the key itself, or who may use it, is changed, whoever did it", async () => {
    const { teamId, keyId, email } = await lab();
    const admin = "arn:aws:iam::123456789012:role/an-administrator";

    await report(event(keyId, "PutKeyPolicy", admin));

    expect(await recorded(teamId)).toMatchObject([
      { kind: "changed", action: "PutKeyPolicy", by: admin },
    ]);
    expect(sent.find(({ to }) => to === email)?.subject).toBe(
      "Your lab's encryption key was changed",
    );
  });

  it("takes the same event twice as one", async () => {
    const { teamId, keyId } = await lab();
    const once = event(keyId);
    await report(once);
    expect(await result(await report(once))).toBe("ignored");
    expect(await recorded(teamId)).toHaveLength(1);
  });

  it("ignores the server's own use, and keys that aren't a lab's", async () => {
    const { teamId, keyId } = await lab();
    expect(await result(await report(event(keyId, "Decrypt", SERVER)))).toBe("ignored");
    expect(
      await result(await report(event("arn:aws:kms:us-east-1:123456789012:key/some-other-key"))),
    ).toBe("ignored");
    expect(await recorded(teamId)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("takes nothing without the key it shares with AWS", async () => {
    const { teamId, keyId } = await lab();
    expect((await report(event(keyId), "a guess")).status).toBe(404);
    expect((await report(event(keyId), "")).status).toBe(404);
    expect(await recorded(teamId)).toHaveLength(0);
  });

  it("shows the lab its key's record, newest first", async () => {
    const { teamId, keyId, cookie } = await lab();
    await report(event(keyId));
    await report({
      ...event(keyId, "PutKeyPolicy"),
      detail: { ...event(keyId, "PutKeyPolicy").detail, eventTime: "2026-11-13T11:00:00Z" },
    });

    const usage = (await (
      await app.request(`/admin/teams/${teamId}/usage`, { headers: { cookie } })
    ).json()) as { key: { made: boolean; events: { kind: string; action: string }[] } };
    expect(usage.key.made).toBe(true);
    expect(usage.key.events.map(({ kind, action }) => `${kind} ${action}`)).toEqual([
      "changed PutKeyPolicy",
      "used Decrypt",
    ]);
  });
});

describe("a Truman that takes no such reports", () => {
  it("has nothing at that address", async () => {
    const without = createApp({
      pingDatabase: database.ping,
      db: database.db,
      storage,
      mediaPublicUrl: "http://media.test",
      getClientIp: () => undefined,
      secureCookies: false,
    });
    const response = await without.request("/hooks/key-events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-truman-hook-key": "" },
      body: "{}",
    });
    expect(response.status).toBe(404);
  });
});
