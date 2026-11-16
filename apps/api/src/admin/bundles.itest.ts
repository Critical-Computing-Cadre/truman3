import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { STARTING_CONSENT } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import type { Bundle } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

// A replication bundle (ADR 91): a saved version, whole, in one zip. The test that matters is the
// round trip: bundle a study, load the bundle in another lab, save it, bundle that, and compare.

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const BYSTANDER = path.resolve(import.meta.dirname, "../../../../studies/examples/bystander");

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
  storage.close();
  await database.destroy();
});

async function signIn(email: string, password: string) {
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function lab() {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  return { id, teamId, teamSlug: `lab-${id}`, cookie: await signIn(email, password as string) };
}
type Lab = Awaited<ReturnType<typeof lab>>;

/** The bystander example, saved as a version in a lab, under a name of its own. */
async function bystanderIn(team: Lab) {
  const slug = `bystander-${randomUUID().slice(0, 8)}`;
  const imported = await importStudyFolder(database.db, storage, BYSTANDER, {
    teamId: team.teamId,
    change: (study) => ({ ...study, settings: { ...study.settings, slug } }),
  });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map(({ message }) => message).join("\n"));
  }
  return { slug, versionId: imported.studyVersionId as string };
}

const download = (cookie: string, versionId: string) =>
  app.request(`/admin/versions/${versionId}/bundle`, { method: "POST", headers: { cookie } });

async function bundleOf(cookie: string, versionId: string) {
  const response = await download(cookie, versionId);
  expect(response.status).toBe(200);
  const zip = new Uint8Array(await response.arrayBuffer());
  const files = unzipSync(zip);
  return {
    zip,
    files,
    disposition: response.headers.get("content-disposition"),
    study: JSON.parse(strFromU8(files["study.json"] as Uint8Array)) as Bundle,
  };
}

function load(
  cookie: string,
  teamId: string,
  zip: Uint8Array,
  slug = `loaded-${randomUUID().slice(0, 8)}`,
) {
  const form = new FormData();
  form.set("file", new File([zip as Uint8Array<ArrayBuffer>], "bundle.zip"));
  form.set("teamId", teamId);
  form.set("title", "A replication");
  form.set("slug", slug);
  return app.request("/admin/bundles", { method: "POST", headers: { cookie }, body: form });
}

/**
 * A bundle's study with everything that's bound to differ between two Trumans taken out: item IDs,
 * which are replaced by what kind of thing each is and where it comes in order.
 */
function comparable(bundle: Bundle) {
  const names = new Map(bundle.items.map(({ id, kind, position }) => [id, `${kind}#${position}`]));
  const rename = (value: unknown): unknown => {
    if (typeof value === "string") {
      return names.get(value) ?? value;
    }
    if (Array.isArray(value)) {
      return value.map(rename);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .map(([key, inner]) => [names.get(key) ?? key, rename(inner)] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return value;
  };
  return bundle.items
    .map(({ kind, position, data }) => ({ kind, position, data: rename(data) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.position - b.position);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("a replication bundle", () => {
  it("holds the study, its pages, its pictures, a README, and a checksum of each", async () => {
    const team = await lab();
    const { slug, versionId } = await bystanderIn(team);
    const { files, study, disposition } = await bundleOf(team.cookie, versionId);
    expect(disposition).toBe(`attachment; filename="${slug}-v1-replication.zip"`);

    expect(study).toMatchObject({
      format: "truman-study-bundle",
      formatVersion: 1,
      slug,
      version: 1,
    });
    expect(study.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(study.launches).toEqual([]);
    const kinds = new Set(study.items.map(({ kind }) => kind));
    expect([...kinds].sort()).toEqual(expect.arrayContaining(["actor", "comment", "post"]));
    // What participants agreed to is part of the record of what ran.
    expect(study.pages["pages/consent.md"]).toContain("Consent");
    expect(study.pages["pages/consent.md"]).not.toBe(STARTING_CONSENT);
    expect(study.pages["beats.yaml"]).toContain("jake-mocks");

    // Every picture the study names is in it, and is what its name says.
    expect(study.media.length).toBeGreaterThan(1);
    expect(study.missingMedia).toEqual([]);
    for (const { key, bytes } of study.media) {
      const file = files[key] as Uint8Array;
      expect(file.length).toBe(bytes);
      expect(key).toBe(`media/${sha256(file)}${path.extname(key)}`);
    }

    const readme = strFromU8(files["README.md"] as Uint8Array);
    expect(readme).toContain("Bystander (reference study), version 1");
    expect(readme).toContain("It has no participants and no data.");
    expect(readme).toContain("defended, silent");
    expect(readme).toContain("It was never opened to participants.");
    expect(readme).toContain(study.contentHash);

    const checksums = strFromU8(files["checksums.txt"] as Uint8Array)
      .trim()
      .split("\n");
    expect(checksums).toHaveLength(Object.keys(files).length - 1);
    for (const line of checksums) {
      const [sum, name] = line.split(/\s+/) as [string, string];
      expect(sha256(files[name] as Uint8Array), name).toBe(sum);
    }
  });

  it("says when the version was open to participants", async () => {
    const team = await lab();
    const { versionId } = await bystanderIn(team);
    const act = (url: string) =>
      app.request(url, { method: "POST", headers: { cookie: team.cookie } });
    expect((await act(`/admin/versions/${versionId}/launch`)).status).toBe(200);
    const [version] = await database.db
      .select()
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    expect((await act(`/admin/studies/${version?.studyId}/stop`)).status).toBe(200);
    const { study, files } = await bundleOf(team.cookie, versionId);
    expect(study.launches).toHaveLength(1);
    expect(study.launches[0]?.until).not.toBeNull();
    expect(strFromU8(files["README.md"] as Uint8Array)).not.toContain("never opened");
  });

  it("loads in another lab as the same study, which bundles the same again", async () => {
    const first = await lab();
    const { versionId } = await bystanderIn(first);
    const original = await bundleOf(first.cookie, versionId);

    const second = await lab();
    const loaded = await load(second.cookie, second.teamId, original.zip);
    expect(loaded.status).toBe(200);
    const { draftId, from } = (await loaded.json()) as { draftId: string; from: string };
    expect(from).toBe("Bystander (reference study), version 1");

    // Saved as a version there, and bundled, it's the same study.
    const frozen = await app.request(`/admin/drafts/${draftId}/freeze`, {
      method: "POST",
      headers: { cookie: second.cookie },
    });
    expect(frozen.status).toBe(200);
    const [draft] = await database.db
      .select()
      .from(schema.studyDrafts)
      .where(eq(schema.studyDrafts.id, draftId));
    const [version] = await database.db
      .select()
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.studyId, draft?.studyId as string));
    const again = await bundleOf(second.cookie, version?.id as string);

    expect(comparable(again.study)).toEqual(comparable(original.study));
    expect(again.study.media).toEqual(original.study.media);
    // Its pages are the same but for consent, which is theirs to write.
    const { "pages/consent.md": theirs, ...pages } = again.study.pages;
    const { "pages/consent.md": _, ...originalPages } = original.study.pages;
    expect(pages).toEqual(originalPages);
    expect(theirs).toBe(STARTING_CONSENT);
    // And so are its settings, but for the name and link it was given.
    const settings = (bundle: Bundle) => {
      const { slug: __, title: ___, ...rest } = bundle.settings as Record<string, unknown>;
      return rest;
    };
    expect(settings(again.study)).toEqual(settings(original.study));
    expect(again.study.title).toBe("A replication");
  });

  it("can be loaded twice, as two studies", async () => {
    const team = await lab();
    const { zip } = await bundleOf(team.cookie, (await bystanderIn(team)).versionId);
    expect((await load(team.cookie, team.teamId, zip)).status).toBe(200);
    expect((await load(team.cookie, team.teamId, zip)).status).toBe(200);
  });

  it("marks what it brought as coming from the bundle", async () => {
    const team = await lab();
    const { zip, study } = await bundleOf(team.cookie, (await bystanderIn(team)).versionId);
    const { draftId } = (await (await load(team.cookie, team.teamId, zip)).json()) as {
      draftId: string;
    };
    const items = await database.db
      .select()
      .from(schema.draftItems)
      .where(eq(schema.draftItems.draftId, draftId));
    expect(items.length).toBe(study.items.length);
    for (const item of items) {
      expect(item.provenance).toMatchObject({
        origin: "pack",
        pack: { id: study.contentHash, name: "Bystander (reference study), version 1" },
      });
    }
  });

  it("refuses a bundle that's been changed, and a zip that isn't one", async () => {
    const team = await lab();
    const { files } = await bundleOf(team.cookie, (await bystanderIn(team)).versionId);
    const why = async (changed: Record<string, Uint8Array>) => {
      const response = await load(team.cookie, team.teamId, zipSync(changed));
      expect(response.status).toBe(400);
      return ((await response.json()) as { error: string }).error;
    };

    // The study edited after the bundle was made.
    const edited = strFromU8(files["study.json"] as Uint8Array).replace("Bystander", "Bystanders");
    expect(await why({ ...files, "study.json": strToU8(edited) })).toBe(
      "study.json has changed since the bundle was made.",
    );
    // A picture swapped for another, with the checksums redone to match.
    const [picture, other] = Object.keys(files).filter((name) => name.startsWith("media/"));
    const swapped = { ...files, [picture as string]: files[other as string] as Uint8Array };
    const redone = Object.entries(swapped)
      .filter(([name]) => name !== "checksums.txt")
      .map(([name, bytes]) => `${sha256(bytes)}  ${name}`)
      .join("\n");
    expect(await why({ ...swapped, "checksums.txt": strToU8(redone) })).toContain(
      "isn't what its name says",
    );
    // A picture left out.
    const { [picture as string]: __, ...without } = files;
    expect(await why(without)).toContain("which isn't in it");
    expect(await why({ "notes.txt": strToU8("hello") })).toBe(
      "This isn't a replication bundle: it has no study.json.",
    );
    expect(await why({ "study.json": strToU8('{"format":"something else"}') })).toBe(
      "This isn't a replication bundle.",
    );
    const response = await load(team.cookie, team.teamId, strToU8("not a zip"));
    expect(response.status).toBe(400);
  });

  it("is only for people on the study's team to download, and not viewers to load", async () => {
    const team = await lab();
    const stranger = await lab();
    const { versionId } = await bystanderIn(team);
    expect((await download(stranger.cookie, versionId)).status).toBe(404);
    expect((await download("", versionId)).status).toBe(401);

    const { zip } = await bundleOf(team.cookie, versionId);
    // Into a lab they're not on.
    expect((await load(stranger.cookie, team.teamId, zip)).status).toBe(403);
    const email = `viewer-${randomUUID().slice(0, 8)}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: team.teamSlug,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(email, added.password as string);
    // A viewer can read the study, so can take a bundle of it, but can't start a study.
    expect((await download(viewer, versionId)).status).toBe(200);
    expect((await load(viewer, team.teamId, zip)).status).toBe(403);
  });

  it("says so when the link name is taken", async () => {
    const team = await lab();
    const { slug, versionId } = await bystanderIn(team);
    const { zip } = await bundleOf(team.cookie, versionId);
    const taken = await load(team.cookie, team.teamId, zip, slug);
    expect(taken.status).toBe(409);
  });
});
