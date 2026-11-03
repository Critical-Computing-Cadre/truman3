import type { Database } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { describeError } from "./errors.ts";

const RECRUITMENT_ID = "PROLIFIC-ID-123";

/** Built the way Drizzle and Postgres build them: the values are in the messages. */
function queryError() {
  const fromPostgres = Object.assign(
    new Error(`duplicate key: Key (recruitment_id)=(${RECRUITMENT_ID})`),
    { name: "PostgresError", code: "23505", constraint_name: "participants_unique" },
  );
  return new DrizzleQueryError(
    "select * from participants where id = $1",
    [RECRUITMENT_ID],
    fromPostgres,
  );
}

/** A database that fails on whatever a route asks of it. */
function failingDb() {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw queryError();
      },
    },
  ) as Database;
}

function appWith(logFullErrors?: boolean) {
  return createApp({
    pingDatabase: async () => {},
    db: failingDb(),
    storage: {} as Storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => "203.0.113.9",
    secureCookies: true,
    ...(logFullErrors === undefined ? {} : { logFullErrors }),
  });
}

const enter = (app: ReturnType<typeof appWith>) =>
  app.request("/api/studies/some-study/enter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: RECRUITMENT_ID }),
  });

describe("describeError", () => {
  it("keeps the kind of error and where it happened, and leaves out the values", () => {
    const described = describeError(queryError());

    expect(described.name).toBe("Error");
    expect(described.cause).toMatchObject({
      name: "PostgresError",
      code: "23505",
      constraint: "participants_unique",
    });
    expect(described.frames?.length).toBeGreaterThan(0);
    expect(JSON.stringify(described)).not.toContain(RECRUITMENT_ID);
  });

  it("describes something thrown that isn't an error", () => {
    expect(describeError(RECRUITMENT_ID)).toEqual({ name: "string" });
  });
});

describe("what a failed request logs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const everythingLogged = (spy: ReturnType<typeof vi.spyOn>) =>
    JSON.stringify(spy.mock.calls, (_key, value) =>
      value instanceof Error ? `${value.message} ${value.stack}` : value,
    );

  it("answers plainly, and keeps recruitment IDs out of the logs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await enter(appWith());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong." });
    expect(logged).toHaveBeenCalled();
    expect(everythingLogged(logged)).not.toContain(RECRUITMENT_ID);
  });

  it("logs everything during local development", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await enter(appWith(true));

    expect(everythingLogged(logged)).toContain(RECRUITMENT_ID);
  });
});
