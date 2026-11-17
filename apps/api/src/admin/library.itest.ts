import { randomUUID } from "node:crypto";
import path from "node:path";
import { addResearcherToTeam, makeOperator, setUpTeam } from "@truman3/accounts";
import { STARTING_CONSENT } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

// The library (ADR 92): a lab publishes a saved version, and other labs on this Truman copy it.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
/** A Truman someone runs for themselves, and a hosted one, on the same database. */
let own: ReturnType<typeof createApp>;
let hosted: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const BYSTANDER = path.resolve(import.meta.dirname, "../../../../studies/examples/bystander");

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  const shared = {
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  };
  own = createApp(shared);
  hosted = createApp({ ...shared, hosted: true });
});

afterAll(async () => {
  storage.close();
  await database.destroy();
});

type App = ReturnType<typeof createApp>;

async function signIn(app: App, email: string, password: string) {
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function lab(app: App) {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  // On a hosted Truman a new lab waits for approval. These are past that.
  await database.db
    .update(schema.teams)
    .set({ status: "approved" })
    .where(eq(schema.teams.id, teamId));
  const cookie = await signIn(app, email, password as string);
  const call = (method: string, url: string, body?: object) =>
    app.request(url, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { id, email, teamId, teamSlug: `lab-${id}`, call };
}
type Lab = Awaited<ReturnType<typeof lab>>;

async function bystanderIn(team: Lab) {
  const slug = `bystander-${randomUUID().slice(0, 8)}`;
  const imported = await importStudyFolder(database.db, storage, BYSTANDER, {
    teamId: team.teamId,
    change: (study) => ({ ...study, settings: { ...study.settings, slug } }),
  });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map(({ message }) => message).join("\n"));
  }
  return imported.studyVersionId as string;
}

const details = {
  summary:
    "Someone mocks a painting. In one condition a bystander steps in, in the other nobody does.",
  paper: "Example et al. (2026). Bystanders online.",
  license: "CC BY 4.0",
  mayShare: true,
};
const publish = (team: Lab, versionId: string, fields: object = details) =>
  team.call("POST", `/admin/versions/${versionId}/publish`, fields);

interface Listed {
  id: string;
  title: string;
  lab: string;
  status: string;
  mine: boolean;
  license: string;
  about: { conditions: string[]; cast: number; posts: number; pictures: string[]; kind: string };
}
const listFor = async (team: Lab) =>
  (await (await team.call("GET", "/admin/library")).json()) as {
    studies: Listed[];
    decides: boolean;
    licenses: string[];
  };
const find = async (team: Lab, id: string) =>
  (await listFor(team)).studies.find((study) => study.id === id);

describe("the library, on your own Truman", () => {
  it("lists a published study at once, for every lab, with what it's about", async () => {
    const author = await lab(own);
    const reader = await lab(own);
    const published = await publish(author, await bystanderIn(author));
    expect(published.status).toBe(200);
    const { id, status } = (await published.json()) as { id: string; status: string };
    expect(status).toBe("listed");

    const seen = await find(reader, id);
    expect(seen).toMatchObject({
      title: "Bystander (reference study)",
      lab: `lab-${author.id}`,
      status: "listed",
      license: "CC BY 4.0",
      mine: false,
    });
    expect(seen?.about).toMatchObject({
      kind: "classic",
      conditions: ["defended", "silent"],
      cast: 5,
      posts: 3,
    });
    expect(seen?.about.pictures[0]).toMatch(/^http:\/\/media\.test\/media\/[0-9a-f]{64}\.png$/);
    expect((await find(author, id))?.mine).toBe(true);
    expect((await listFor(reader)).licenses).toContain("CC0 1.0");
  });

  it("copies into another lab as a draft of the same study, with placeholder consent", async () => {
    const author = await lab(own);
    const reader = await lab(own);
    const { id } = (await (await publish(author, await bystanderIn(author))).json()) as {
      id: string;
    };
    const copied = await reader.call("POST", `/admin/library/${id}/copy`, {
      teamId: reader.teamId,
      title: "Our replication",
      slug: `copy-${randomUUID().slice(0, 8)}`,
    });
    expect(copied.status).toBe(200);
    const { draftId, studyId } = (await copied.json()) as { draftId: string; studyId: string };
    const [study] = await database.db
      .select()
      .from(schema.studies)
      .where(eq(schema.studies.id, studyId));
    expect(study?.teamId).toBe(reader.teamId);
    const [draft] = await database.db
      .select()
      .from(schema.studyDrafts)
      .where(eq(schema.studyDrafts.id, draftId));
    const pages = draft?.pages as Record<string, string>;
    expect(pages["pages/consent.md"]).toBe(STARTING_CONSENT);
    expect(pages["beats.yaml"]).toContain("jake-mocks");
    const items = await database.db
      .select()
      .from(schema.draftItems)
      .where(eq(schema.draftItems.draftId, draftId));
    expect(items.filter(({ kind }) => kind === "actor")).toHaveLength(5);
    expect(items.filter(({ kind }) => kind === "post")).toHaveLength(3);
    // And it can be saved as a version of their own.
    expect((await reader.call("POST", `/admin/drafts/${draftId}/freeze`)).status).toBe(200);

    // Into a lab they're not on, no.
    const elsewhere = await reader.call("POST", `/admin/library/${id}/copy`, {
      teamId: author.teamId,
      title: "Theirs",
      slug: `copy-${randomUUID().slice(0, 8)}`,
    });
    expect(elsewhere.status).toBe(403);
  });

  it("gives anyone signed in its replication bundle, as published", async () => {
    const author = await lab(own);
    const reader = await lab(own);
    const { id } = (await (await publish(author, await bystanderIn(author))).json()) as {
      id: string;
    };
    const response = await reader.call("POST", `/admin/library/${id}/bundle`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="bystander-reference-study-replication.zip"',
    );
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["README.md", "study.json", "checksums.txt"]),
    );
    expect((await own.request(`/admin/library/${id}/bundle`, { method: "POST" })).status).toBe(401);
  });

  it("needs a summary, a license, and their word that they may share it", async () => {
    const author = await lab(own);
    const versionId = await bystanderIn(author);
    for (const wrong of [
      { ...details, summary: "Too short." },
      { ...details, license: "All rights reserved" },
      { ...details, mayShare: false },
    ]) {
      expect((await publish(author, versionId, wrong)).status).toBe(400);
    }
    expect((await publish(author, versionId)).status).toBe(200);
    // The same version, once.
    expect((await publish(author, versionId)).status).toBe(409);
  });

  it("is the lab's own to publish and take down, and not a viewer's or another lab's", async () => {
    const author = await lab(own);
    const other = await lab(own);
    const versionId = await bystanderIn(author);
    expect((await publish(other, versionId)).status).toBe(404);
    const email = `viewer-${randomUUID().slice(0, 8)}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: author.teamSlug,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(own, email, added.password as string);
    const asViewer = await own.request(`/admin/versions/${versionId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewer },
      body: JSON.stringify(details),
    });
    expect(asViewer.status).toBe(403);

    const { id } = (await (await publish(author, versionId)).json()) as { id: string };
    const takeDown = (team: Lab) =>
      team.call("PUT", `/admin/library/${id}/status`, { status: "removed" });
    expect((await takeDown(other)).status).toBe(404);
    expect((await takeDown(author)).status).toBe(200);
    expect(await find(other, id)).toBeUndefined();
    expect((await other.call("POST", `/admin/library/${id}/bundle`)).status).toBe(404);
    // Taken down, it can be published again.
    expect((await publish(author, versionId)).status).toBe(200);
  });
});

describe("the library, on a hosted Truman", () => {
  it("waits for whoever runs it before other labs see a study", async () => {
    const author = await lab(hosted);
    const reader = await lab(hosted);
    const operator = await lab(hosted);
    await makeOperator(database.db, operator.email);

    const published = await publish(author, await bystanderIn(author));
    const { id, status } = (await published.json()) as { id: string; status: string };
    expect(status).toBe("waiting");

    // Its own lab sees it waiting. Another lab doesn't see it at all, and can't copy it.
    expect(await find(author, id)).toMatchObject({ status: "waiting", mine: true });
    expect(await find(reader, id)).toBeUndefined();
    const early = await reader.call("POST", `/admin/library/${id}/copy`, {
      teamId: reader.teamId,
      title: "Too soon",
      slug: `copy-${randomUUID().slice(0, 8)}`,
    });
    expect(early.status).toBe(404);
    expect((await listFor(reader)).decides).toBe(false);

    // Its lab can't list it themselves.
    const list = (team: Lab) =>
      team.call("PUT", `/admin/library/${id}/status`, { status: "listed" });
    expect((await list(author)).status).toBe(403);
    expect((await list(reader)).status).toBe(404);

    // Whoever runs it sees it, can look at the bundle, and lists it.
    expect((await listFor(operator)).decides).toBe(true);
    expect(await find(operator, id)).toMatchObject({ status: "waiting" });
    expect((await operator.call("POST", `/admin/library/${id}/bundle`)).status).toBe(200);
    expect((await list(operator)).status).toBe(200);
    expect(await find(reader, id)).toMatchObject({ status: "listed" });

    // And can take down any study.
    expect(
      (await operator.call("PUT", `/admin/library/${id}/status`, { status: "removed" })).status,
    ).toBe(200);
    expect(await find(reader, id)).toBeUndefined();
  });

  it("lists what the person who runs it publishes without waiting", async () => {
    const operator = await lab(hosted);
    await makeOperator(database.db, operator.email);
    const published = await publish(operator, await bystanderIn(operator));
    expect(((await published.json()) as { status: string }).status).toBe("listed");
  });
});
