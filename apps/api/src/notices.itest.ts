import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

/**
 * What reference studies #3 and #4 need (ADR 63): a moderator's notice that doesn't say who, a
 * question on it, community rules to open, and a picture that differs by condition.
 */

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const ACTORS = path.resolve(import.meta.dirname, "../../../studies/examples/eatsnap/media/actors");

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  });
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });
const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

let slug = "";
beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-notices-"));
  dirs.push(dir);
  slug = `notices-${randomUUID().slice(0, 8)}`;
  mkdirSync(path.join(dir, "pages"));
  mkdirSync(path.join(dir, "media/actors"), { recursive: true });
  copyFileSync(path.join(ACTORS, "aleeboi.jpg"), path.join(dir, "media/actors/ann.jpg"));
  copyFileSync(path.join(ACTORS, "_aikira_.jpg"), path.join(dir, "media/actors/ann-framed.jpg"));
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Notices
site: { name: Demo, rules: pages/rules.md }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: [{ key: plain }, { key: framed }]
platform: { style: mixed, template: classic, features: { labels: true } }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
    "pages/rules.md": "# Community rules\n\nNo bullying.",
    "actors.csv": [
      "username,name,picture,pictures",
      "ann,Ann,ann.jpg,framed=ann-framed.jpg",
      "bob,Bob,,",
      "system,Our automated system,,",
    ].join("\n"),
    "posts.csv": "id,body,actor,time\np1,My dinner,ann,-1:00\n",
    "comments.csv": "id,body,actor,postID,likes,time\nc1,gross,bob,p1,0,-0:30\n",
    "labels.csv": [
      "on,target,actor,time,label,reason,by,ask",
      'comment,c1,system,-0:20,Flagged as harassment,This goes against our rules.,hidden,"Do you agree with this flag?"',
    ].join("\n"),
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
});

async function join() {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: randomUUID() }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const { posts } = (await (await call(cookie, "GET", "/feed")).json()) as FeedResponse;
  return { cookie, post: posts[0] as FeedResponse["posts"][number] };
}

describe("a moderator's notice", () => {
  it("can leave out who gave it, and asks its question until it's answered", async () => {
    const { cookie, post } = await join();
    const comment = post.comments[0];
    expect(comment?.labels).toEqual([
      {
        text: "Flagged as harassment",
        by: "",
        hides: false,
        reason: "This goes against our rules.",
        ask: "Do you agree with this flag?",
      },
    ]);

    const answer = (agree: boolean) =>
      call(cookie, "POST", `/content/${comment?.id}/label-answer`, {
        ...meta(),
        label: "Flagged as harassment",
        agree,
      });
    expect((await answer(false)).status).toBe(200);
    // Once answered, it isn't asked again.
    expect((await answer(true)).status).toBe(404);
    const { posts } = (await (await call(cookie, "GET", "/feed")).json()) as FeedResponse;
    expect(posts[0]?.comments[0]?.labels?.[0]?.ask).toBeUndefined();

    const [event] = await database.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.targetContentId, comment?.id as string),
          eq(schema.events.type, "content.label_answered"),
        ),
      );
    expect(event?.payload).toEqual({ label: "Flagged as harassment", agree: false });
  });
});

describe("community rules", () => {
  it("open from a label's offer or the menu, and that's recorded", async () => {
    const { cookie } = await join();
    const flow = (await (await call(cookie, "GET", "/me/flow")).json()) as {
      site: { hasRules: boolean };
    };
    expect(flow.site.hasRules).toBe(true);
    const opened = await call(cookie, "GET", "/rules?from=label");
    expect(((await opened.json()) as { text: string }).text).toContain("No bullying.");
    await call(cookie, "GET", "/rules");

    const folder = mkdtempSync(path.join(tmpdir(), "truman-notices-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const events = parse(readFileSync(path.join(folder, "events.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    expect(
      events.filter(({ type }) => type === "rules.opened").map(({ payload }) => payload),
    ).toEqual(expect.arrayContaining(['{"from":"label"}', '{"from":"menu"}']));
  });
});

describe("a picture by condition", () => {
  it("shows a different picture of someone in the conditions that say so", async () => {
    // Blocks of two, so the next two people are one in each condition.
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      urls.push((await join()).post.author.pictureUrl ?? "");
    }
    expect(new Set(urls).size).toBe(2);
    expect(urls.every((url) => url.startsWith("http://media.test/"))).toBe(true);
  });
});
