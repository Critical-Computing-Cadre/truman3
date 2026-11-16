import { createHash } from "node:crypto";
import { STARTING_CONSENT, type StudySettings, studySettingsSchema } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { draftToDefinition } from "./definition.ts";
import { type EditProblem, versionItems } from "./drafts.ts";
import { type DraftItem, itemDataSchemas, type Provenance } from "./items.ts";

/**
 * A replication bundle (ADR 91): one saved version of a study, whole, as files. It's for depositing
 * with a paper, so someone else can load the study as it ran. It has the settings, every page, the
 * cast, posts, comments, beats and tests, and the pictures themselves, with a checksum for each
 * file.
 *
 * This makes the files and reads them back. Putting them in a zip, and taking one apart, is done
 * by whoever calls it.
 */

export const BUNDLE_FORMAT = "truman-study-bundle";
export const BUNDLE_FORMAT_VERSION = 1;
export const BUNDLE_STUDY_FILE = "study.json";
export const BUNDLE_CHECKSUMS_FILE = "checksums.txt";
export const BUNDLE_README_FILE = "README.md";

/** A picture Truman stores: named by the checksum of what's in it, so it's the same key anywhere. */
const STORED_KEY = /^media\/([0-9a-f]{64})\.[a-z0-9]+$/;
const ITEM_KINDS = Object.keys(itemDataSchemas) as [DraftItem["kind"], ...DraftItem["kind"][]];

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const text = (value: string) => new TextEncoder().encode(value);

const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  formatVersion: z.literal(BUNDLE_FORMAT_VERSION),
  /** What it was called where it ran. A study loaded from this gets its own title and link name. */
  title: z.string(),
  slug: z.string(),
  version: z.number().int(),
  /** Identifies this exact content where it ran, and seeded everything random about it. */
  contentHash: z.string(),
  seed: z.string(),
  frozenAt: z.string().nullable(),
  bundledAt: z.string(),
  /** When this version was open to participants, if it was. */
  launches: z.array(z.object({ from: z.string(), until: z.string().nullable() })),
  settings: z.unknown(),
  pages: z.record(z.string(), z.string()),
  items: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(ITEM_KINDS),
      position: z.number().int(),
      data: z.unknown(),
      provenance: z.unknown(),
    }),
  ),
  /** The pictures in the bundle, by the key the study names them by. */
  media: z.array(z.object({ key: z.string(), bytes: z.number().int() })),
  /** Pictures the study names that couldn't be read when the bundle was made. */
  missingMedia: z.array(z.string()),
});
export type Bundle = z.infer<typeof bundleSchema>;

/** Every stored picture named anywhere in a value. */
export function storedKeysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (STORED_KEY.test(value)) {
      found.add(value);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      storedKeysIn(item, found);
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      storedKeysIn(item, found);
    }
  }
  return found;
}

async function read(storage: Storage, key: string): Promise<Uint8Array | null> {
  const stream = await storage.get(key);
  return stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : null;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "an unknown date");

/** What the bundle says about itself, to someone who opens it without Truman. */
export function bundleReadme(bundle: Bundle): string {
  const settings = bundle.settings as StudySettings;
  const count = (kind: DraftItem["kind"]) =>
    bundle.items.filter((item) => item.kind === kind).length;
  const open = bundle.launches.length
    ? bundle.launches
        .map(
          ({ from, until }) =>
            `- ${day(from)} to ${until ? day(until) : "still open when this was made"}`,
        )
        .join("\n")
    : "- It was never opened to participants.";
  return `# ${bundle.title}, version ${bundle.version}

This is a replication bundle from Truman, a platform for running social media studies. It holds one
saved version of a study, whole: the simulated site's settings, every page a participant was shown,
the cast and everything they posted, what happened and when, and the pictures.

It has no participants and no data. It's the stimulus, not the results.

## What's in it

| | |
|---|---|
| Study | ${bundle.title} |
| Version | ${bundle.version}, saved ${day(bundle.frozenAt)} |
| Kind of site | ${settings.platform?.template ?? "classic"} |
| Length | ${settings.length.days} ${settings.length.days === 1 ? "day" : "days"} |
| Conditions | ${settings.conditions.arms.map(({ key }) => key).join(", ")} |
| Cast | ${count("actor")} |
| Posts | ${count("post")} |
| Comments | ${count("comment")} |
| Pictures | ${bundle.media.length} |
| Content hash | \`${bundle.contentHash}\` |
| Bundle made | ${day(bundle.bundledAt)} |

When this version was open to participants:

${open}

## The files

- \`${BUNDLE_STUDY_FILE}\`: the study. \`settings\` is how the site was set up, including its conditions
  and the steps participants went through. \`pages\` has the text of each page, and \`beats.yaml\`,
  which says what the cast did and when. \`items\` is the cast, their posts and comments, and
  everything else that was written ahead of time.
- \`media/\`: the pictures. Each is named by the SHA-256 checksum of its contents.
- \`${BUNDLE_CHECKSUMS_FILE}\`: the SHA-256 checksum of every file, to confirm nothing changed. With the
  files unzipped, \`shasum -a 256 -c ${BUNDLE_CHECKSUMS_FILE}\` checks them all.
${bundle.missingMedia.length ? `\n${bundle.missingMedia.length} pictures the study names couldn't be read when this was made, and aren't here:\n\n${bundle.missingMedia.map((key) => `- \`${key}\``).join("\n")}\n` : ""}
## Loading it

In a Truman's admin app, press **New study**, choose **From a replication bundle**, and pick this
file. You get a new study with everything in it, as a draft you can look through, change, and save
as a version of your own.

Two things are not carried over, on purpose:

- **The consent page has placeholder text.** The original is in \`${BUNDLE_STUDY_FILE}\`, under
  \`pages\`, as a record of what participants agreed to. Your study needs the wording your own
  ethics board approved.
- **Its link name and title are yours to choose.**

A study loaded from this is the same site with the same content. Anything drawn at random, such as
which of two delays a reply waits for, is drawn again, since it depends on the version it's saved
as.

## Citing it

If you use this, cite the paper it came with. To describe it:

> The study ran on Truman 3 (https://truman-research.org). The study as participants saw it,
> version ${bundle.version} (content hash ${bundle.contentHash.slice(0, 12)}), is in the accompanying replication bundle.
`;
}

/**
 * One saved version as a bundle's files, by path. Null if there's no such version.
 */
export async function bundleVersion(
  db: Database,
  storage: Storage,
  versionId: string,
  now = new Date(),
): Promise<{ files: Map<string, Uint8Array>; bundle: Bundle } | null> {
  const [found] = await db
    .select({ version: schema.studyVersions, slug: schema.studies.slug })
    .from(schema.studyVersions)
    .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
    .where(eq(schema.studyVersions.id, versionId));
  if (!found) {
    return null;
  }
  const { version, slug } = found;
  const settings = version.settings as StudySettings;
  const pages = version.pages as Record<string, string>;
  const items = await versionItems(db, versionId);
  // The study's record of launches and stops, turned into when this version was the open one.
  const log = await db
    .select({
      versionId: schema.studyLaunches.versionId,
      action: schema.studyLaunches.action,
      at: schema.studyLaunches.at,
    })
    .from(schema.studyLaunches)
    .where(eq(schema.studyLaunches.studyId, version.studyId))
    .orderBy(schema.studyLaunches.id);
  const launches: Bundle["launches"] = [];
  for (const { versionId: launched, action, at } of log) {
    const open = launches.at(-1);
    if (open && open.until === null) {
      // Anything after it, a stop or another version's launch, closed it.
      if (action === "launch" && launched === versionId) {
        continue;
      }
      open.until = at.toISOString();
    }
    if (action === "launch" && launched === versionId) {
      launches.push({ from: at.toISOString(), until: null });
    }
  }

  const files = new Map<string, Uint8Array>();
  const media: Bundle["media"] = [];
  const missingMedia: string[] = [];
  for (const key of [...storedKeysIn([settings, items])].sort()) {
    const bytes = await read(storage, key);
    if (bytes) {
      files.set(key, bytes);
      media.push({ key, bytes: bytes.length });
    } else {
      missingMedia.push(key);
    }
  }

  const bundle: Bundle = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    title: settings.title,
    slug,
    version: version.version,
    contentHash: version.contentHash,
    seed: String(version.seed),
    frozenAt: version.frozenAt?.toISOString() ?? null,
    bundledAt: now.toISOString(),
    launches,
    settings,
    pages,
    items: items.map((item) => ({ ...item, position: item.position ?? 0 })),
    media,
    missingMedia,
  };
  files.set(BUNDLE_STUDY_FILE, text(`${JSON.stringify(bundle, null, 2)}\n`));
  files.set(BUNDLE_README_FILE, text(bundleReadme(bundle)));
  files.set(
    BUNDLE_CHECKSUMS_FILE,
    text(
      `${[...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, bytes]) => `${sha256(bytes)}  ${name}`)
        .join("\n")}\n`,
    ),
  );
  return { files, bundle };
}

/** The newest saved version of a study, for a bundle of "the study" with no version named. */
export async function latestVersionId(db: Database, studyId: string) {
  const [version] = await db
    .select({ id: schema.studyVersions.id })
    .from(schema.studyVersions)
    .where(eq(schema.studyVersions.studyId, studyId))
    .orderBy(desc(schema.studyVersions.version))
    .limit(1);
  return version?.id ?? null;
}

export type BundleProblem = { problem: "not-a-bundle"; message: string };

/**
 * Reads a bundle's files and checks them: that it's a bundle, that nothing in it has changed since
 * it was made, and that what it holds is a study this Truman understands. It trusts nothing in it,
 * since a bundle is a file from somewhere else.
 */
export function readBundle(files: ReadonlyMap<string, Uint8Array>): Bundle | BundleProblem {
  const no = (message: string): BundleProblem => ({ problem: "not-a-bundle", message });
  const study = files.get(BUNDLE_STUDY_FILE);
  if (!study) {
    return no(`This isn't a replication bundle: it has no ${BUNDLE_STUDY_FILE}.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(study));
  } catch {
    return no(`${BUNDLE_STUDY_FILE} couldn't be read.`);
  }
  if ((raw as { format?: unknown })?.format !== BUNDLE_FORMAT) {
    return no("This isn't a replication bundle.");
  }
  if ((raw as { formatVersion?: unknown }).formatVersion !== BUNDLE_FORMAT_VERSION) {
    return no("This bundle was made by a newer Truman than this one, which can't read it.");
  }
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) {
    return no(`${BUNDLE_STUDY_FILE} isn't as a bundle should be.`);
  }
  const bundle = parsed.data;

  // Nothing changed since it was made.
  const checksums = files.get(BUNDLE_CHECKSUMS_FILE);
  if (!checksums) {
    return no(`The bundle has no ${BUNDLE_CHECKSUMS_FILE}, so it can't be checked.`);
  }
  for (const line of new TextDecoder().decode(checksums).split("\n").filter(Boolean)) {
    const [sum, name] = line.split(/\s+/, 2) as [string, string | undefined];
    const bytes = name ? files.get(name) : undefined;
    if (!name || !bytes) {
      return no(`The bundle lists ${name ?? "a file"}, which isn't in it.`);
    }
    if (sha256(bytes) !== sum) {
      return no(`${name} has changed since the bundle was made.`);
    }
  }
  // And each picture is what its name says it is.
  for (const { key } of bundle.media) {
    const bytes = files.get(key);
    const named = STORED_KEY.exec(key)?.[1];
    if (!bytes || !named || sha256(bytes) !== named) {
      return no(`The picture ${key} is missing, or isn't what its name says.`);
    }
  }

  const settings = studySettingsSchema.safeParse(bundle.settings);
  if (!settings.success) {
    return no("The bundle's settings aren't ones this Truman understands.");
  }
  for (const item of bundle.items) {
    if (!itemDataSchemas[item.kind].safeParse(item.data).success) {
      return no(`Something in the bundle (${item.kind}) isn't as this Truman expects.`);
    }
  }
  return { ...bundle, settings: settings.data };
}

/** Gives every item a new ID, wherever the old one appears, so a bundle can be loaded twice. */
function withNewIds(items: Bundle["items"]): Bundle["items"] {
  const fresh = new Map(items.map(({ id }) => [id, crypto.randomUUID()]));
  const renew = (value: unknown): unknown => {
    if (typeof value === "string") {
      return fresh.get(value) ?? value;
    }
    if (Array.isArray(value)) {
      return value.map(renew);
    }
    if (value && typeof value === "object") {
      // Some things are kept by ID, like someone's flair in each space.
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [fresh.get(key) ?? key, renew(inner)]),
      );
    }
    return value;
  };
  return items.map((item) => ({
    ...item,
    id: fresh.get(item.id) as string,
    data: renew(item.data),
  }));
}

export interface LoadBundle {
  teamId: string;
  researcherId: string;
  slug: string;
  title: string;
  /** The pictures that are in this Truman's storage. Anything else the bundle names is dropped. */
  stored: ReadonlySet<string>;
}

/**
 * Starts a new study from a bundle, as a draft: everything the version had, with a link name and
 * title of its own, and placeholder text where the consent page was. The consent a study shows has
 * to be what its own ethics board approved, never another lab's (ADR 15).
 */
export async function loadBundle(
  db: Database,
  bundle: Bundle,
  { teamId, researcherId, slug, title, stored }: LoadBundle,
): Promise<{ studyId: string; draftId: string } | EditProblem | BundleProblem> {
  const original = bundle.settings as StudySettings;
  // The site's own images, such as its logo, are left off if they couldn't be brought.
  const site = Object.fromEntries(
    Object.entries(original.site).filter(
      ([, value]) => typeof value !== "string" || !STORED_KEY.test(value) || stored.has(value),
    ),
  ) as StudySettings["site"];
  const settings = studySettingsSchema.parse({ ...original, slug, title, site });
  const consentPages = new Set(
    settings.flow.flatMap((step) => (step.step === "consent" ? [step.page] : [])),
  );
  const pages = Object.fromEntries(
    Object.entries(bundle.pages).map(([name, page]) => [
      name,
      consentPages.has(name) ? STARTING_CONSENT : page,
    ]),
  );
  const items = withNewIds(bundle.items);
  const lost = [...storedKeysIn(items)].filter((key) => !stored.has(key));
  if (lost.length > 0) {
    return {
      problem: "not-a-bundle",
      message: `The bundle doesn't have a picture the study uses (${lost[0]}), or it's a kind of file this Truman doesn't take.`,
    };
  }
  // It has to be a study, by the same rules as one written here.
  draftToDefinition(settings, pages, items as DraftItem[]);

  const from = { id: bundle.contentHash, name: `${bundle.title}, version ${bundle.version}` };
  return db.transaction(async (tx) => {
    const [study] = await tx
      .insert(schema.studies)
      .values({ teamId, slug })
      .onConflictDoNothing()
      .returning({ id: schema.studies.id });
    if (!study) {
      return {
        problem: "in-use" as const,
        message: `The link name "${slug}" is already used by another study.`,
      };
    }
    const [draft] = await tx
      .insert(schema.studyDrafts)
      .values({ studyId: study.id, settings, pages, createdBy: researcherId })
      .returning({ id: schema.studyDrafts.id });
    if (!draft) {
      throw new Error("The draft wasn't created.");
    }
    const rows = items.map((item) => ({
      id: item.id,
      draftId: draft.id,
      kind: item.kind,
      position: item.position,
      // Where each thing came from before the bundle is kept, so generated content stays marked.
      provenance: {
        origin: "pack",
        pack: from,
        ...(item.provenance ? { before: item.provenance as Provenance } : {}),
      } satisfies Provenance,
      data: item.data,
    }));
    for (let start = 0; start < rows.length; start += 500) {
      await tx.insert(schema.draftItems).values(rows.slice(start, start + 500));
    }
    return { studyId: study.id, draftId: draft.id };
  });
}
