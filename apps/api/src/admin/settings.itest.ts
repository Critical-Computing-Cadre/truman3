import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

interface Settings {
  canEdit: boolean;
  sections: Record<string, { revision: number; value: Record<string, never> }>;
  pages: Record<string, { revision: number; text: string }>;
  issues: { severity: string; message: string }[];
}

async function lab() {
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-settings-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: settings-${id}
title: Settings test
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }, { key: b }]
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv":
      "id,body,actor,likes,time,condition\np1,for everyone,ann,0,-1:00,\np2,only a,ann,0,-0:30,a\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, {
    teamId,
    launch: true,
  });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${id}@example.edu`, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const call = (method: string, url: string, body?: object) =>
    app.request(url, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const opened = await call("POST", `/admin/versions/${imported.studyVersionId}/draft`);
  const { draftId } = (await opened.json()) as { draftId: string };
  const read = async () =>
    (await (await call("GET", `/admin/drafts/${draftId}/settings`)).json()) as Settings;
  const save = (section: string, value: unknown, baseRevision: number, renames?: object) =>
    call("PUT", `/admin/drafts/${draftId}/settings`, {
      section,
      value,
      baseRevision,
      ...(renames ? { renames } : {}),
    });
  return { call, draftId, read, save, slug: `settings-${id}` };
}

const conditions = (arms: object[]) => ({
  conditions: { assignment: { method: "uniform" }, arms },
});
const arm = (key: string) => ({ key, factors: {}, weight: 1 });

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
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
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("draft settings", () => {
  it("saves a section, shows it in the draft, and undoes it", async () => {
    const team = await lab();
    const before = await team.read();
    const study = before.sections.study?.value as object;

    const saved = await team.save(
      "study",
      { ...study, platform: { style: "text", commentBox: "onReply" } },
      0,
    );
    expect(saved.status).toBe(200);

    const after = await team.read();
    expect(after.sections.study?.revision).toBe(1);
    expect(after.sections.study?.value).toMatchObject({
      platform: { style: "text", commentBox: "onReply" },
    });

    const info = (await (await team.call("GET", `/admin/drafts/${team.draftId}`)).json()) as {
      conditions: { platformStyle: string; commentBox: string }[];
    };
    expect(info.conditions[0]).toMatchObject({ platformStyle: "text", commentBox: "onReply" });

    const changes = (await (
      await team.call("GET", `/admin/drafts/${team.draftId}/changes`)
    ).json()) as { changes: { changeId: string; summary: string }[] };
    expect(changes.changes[0]?.summary).toBe("changed the study and platform settings");

    const undo = await team.call(
      "POST",
      `/admin/drafts/${team.draftId}/changes/${changes.changes[0]?.changeId}/undo`,
    );
    expect(undo.status).toBe(200);
    expect((await team.read()).sections.study?.value).toEqual(study);
  });

  it("refuses to overwrite a change someone hasn't seen", async () => {
    const team = await lab();
    const { value } = (await team.read()).sections.feed as { value: object };
    const feed = value as { feed: object };

    expect(
      (await team.save("feed", { ...feed, feed: { ...feed.feed, windowHours: 24 } }, 0)).status,
    ).toBe(200);

    const late = await team.save(
      "feed",
      { ...feed, feed: { ...feed.feed, removeFlagged: true } },
      0,
    );
    expect(late.status).toBe(409);
    expect((await late.json()) as object).toMatchObject({
      error: expect.stringMatching(/Someone else/),
    });
    expect((await team.read()).sections.feed?.value).toMatchObject({ feed: { windowHours: 24 } });
  });

  it("explains what's wrong with a value, and doesn't save it", async () => {
    const team = await lab();
    const response = await team.save("feed", { feed: {}, likes: {}, length: { days: -1 } }, 0);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/length > days/);
    expect((await team.read()).sections.feed?.revision).toBe(0);
  });

  it("doesn't count saving the same thing as a change", async () => {
    const team = await lab();
    const { value } = (await team.read()).sections.study as { value: object };

    expect((await team.save("study", value, 0)).status).toBe(200);
    expect((await team.read()).sections.study?.revision).toBe(0);
  });

  it("renaming a condition carries what's limited to it, and undoes together", async () => {
    const team = await lab();
    const saved = await team.save("conditions", conditions([arm("first"), arm("b")]), 0, {
      a: "first",
    });
    expect(saved.status).toBe(200);

    const preview = (await (
      await team.call("GET", `/admin/drafts/${team.draftId}/preview?condition=first&elapsedMs=0`)
    ).json()) as { posts: { body: string }[] };
    expect(preview.posts.map(({ body }) => body)).toContain("only a");
    expect((await team.read()).issues.filter(({ severity }) => severity === "error")).toEqual([]);

    const changes = (await (
      await team.call("GET", `/admin/drafts/${team.draftId}/changes`)
    ).json()) as { changes: { changeId: string; summary: string }[] };
    expect(changes.changes[0]?.summary).toBe("changed the conditions");

    await team.call(
      "POST",
      `/admin/drafts/${team.draftId}/changes/${changes.changes[0]?.changeId}/undo`,
    );
    const undone = (await (
      await team.call("GET", `/admin/drafts/${team.draftId}/preview?condition=a&elapsedMs=0`)
    ).json()) as { posts: { body: string }[] };
    expect(undone.posts.map(({ body }) => body)).toContain("only a");
  });

  it("won't remove a condition that content is limited to", async () => {
    const team = await lab();

    const inUse = await team.save("conditions", conditions([arm("b")]), 0);
    expect(inUse.status).toBe(409);
    expect(((await inUse.json()) as { error: string }).error).toMatch(
      /1 item is only shown in "a"/,
    );

    expect((await team.save("conditions", conditions([arm("a")]), 0)).status).toBe(200);
  });

  it("warns when two conditions would look the same", async () => {
    const team = await lab();
    const same = "are identical, so nothing differs";

    await team.save("conditions", conditions([arm("a"), arm("b"), arm("c")]), 0);
    expect((await team.read()).issues.map(({ message }) => message).join()).toContain(same);

    await team.save(
      "conditions",
      conditions([arm("a"), arm("b"), { ...arm("c"), platform: { commentBox: "onReply" } }]),
      1,
    );
    expect((await team.read()).issues.map(({ message }) => message).join()).not.toContain(same);
  });

  it("saves page text, freezes pages in the flow, and leaves out ones that aren't", async () => {
    const team = await lab();
    const flow = (await team.read()).sections.flow?.value as unknown as {
      flow: object[];
      entry: object;
    };

    expect((await team.save("page:pages/kept.md", "# Kept", 0)).status).toBe(200);
    expect((await team.save("page:pages/spare.md", "# Spare", 0)).status).toBe(200);
    expect((await team.save("page:pages/empty.md", "   ", 0)).status).toBe(400);
    expect((await team.save("page:../bad name", "text", 0)).status).toBe(404);
    expect(
      (
        await team.save(
          "flow",
          { ...flow, flow: [{ step: "page", page: "pages/kept.md" }, ...flow.flow] },
          0,
        )
      ).status,
    ).toBe(200);

    expect((await team.read()).pages["pages/kept.md"]?.text).toBe("# Kept");

    const frozen = await team.call("POST", `/admin/drafts/${team.draftId}/freeze`);
    expect(frozen.status).toBe(200);
    expect(((await frozen.json()) as { status: string }).status).toBe("frozen");

    const [version] = await database.db
      .select({ pages: schema.studyVersions.pages })
      .from(schema.studyVersions)
      .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
      .where(eq(schema.studies.slug, team.slug))
      .orderBy(desc(schema.studyVersions.version))
      .limit(1);
    expect(Object.keys(version?.pages as object)).toEqual(["pages/kept.md"]);
  });

  it("a settings change alone is enough to save a new version", async () => {
    const team = await lab();
    const feed = (await team.read()).sections.feed?.value as unknown as { feed: object };

    const untouched = await team.call("POST", `/admin/drafts/${team.draftId}/freeze`);
    expect(((await untouched.json()) as { status: string }).status).toBe("unchanged");

    await team.save("feed", { ...feed, feed: { ...feed.feed, windowHours: 12 } }, 0);
    const frozen = await team.call("POST", `/admin/drafts/${team.draftId}/freeze`);
    expect(((await frozen.json()) as { status: string }).status).toBe("frozen");
  });

  it("can't reach a settings item through the routes for posts", async () => {
    const team = await lab();
    const study = (await team.read()).sections.study?.value as object;
    await team.save("study", { ...study, title: "New title" }, 0);

    const [item] = await database.db
      .select({ id: schema.draftItems.id })
      .from(schema.draftItems)
      .where(
        and(eq(schema.draftItems.draftId, team.draftId), eq(schema.draftItems.kind, "setting")),
      );

    const url = `/admin/drafts/${team.draftId}/items/${item?.id}`;
    expect((await team.call("PATCH", url, { changes: { body: "x" } })).status).toBe(404);
    expect((await team.call("DELETE", url)).status).toBe(404);
  });
});
