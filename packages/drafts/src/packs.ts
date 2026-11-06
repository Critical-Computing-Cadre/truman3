import { createHash } from "node:crypto";
import path from "node:path";
import {
  createRandom,
  hasErrors,
  pickFrom,
  STARTING_CONSENT,
  type StudyDefinition,
  type StudyIssue,
  type StudySettings,
  studySettingsSchema,
  TEMPLATES,
  type TemplateDefinition,
  type TemplateKey,
} from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { loadStudyFolder, MEDIA_FOLDERS } from "@truman3/study-files";
import { storeMedia } from "@truman3/study-import";
import { and, eq, isNull } from "drizzle-orm";
import type { EditProblem } from "./drafts.ts";
import type { Provenance } from "./items.ts";

const INSERT_BATCH_SIZE = 500;

type Arm = StudySettings["conditions"]["arms"][number];
type Actor = StudyDefinition["actors"][number];
type Space = StudyDefinition["spaces"][number];
type Post = StudyDefinition["posts"][number];
type Comment = StudyDefinition["comments"][number];
type Reaction = StudyDefinition["reactions"][number];
type Removal = StudyDefinition["removals"][number];
type FlagAnswer = StudyDefinition["flagAnswers"][number];
type Ban = StudyDefinition["bans"][number];
type ContextNote = StudyDefinition["contextNotes"][number];
type Story = StudyDefinition["stories"][number];
type AutoRule = StudyDefinition["autoRules"][number];
type AppealAnswer = StudyDefinition["appealAnswers"][number];
type ReportAnswer = StudyDefinition["reportAnswers"][number];

/**
 * What a pack holds. Consent text and the study's flow aren't in it: those belong to one study and
 * its IRB approval, and shouldn't quietly travel to another.
 */
export interface PackContents {
  settings: Pick<StudySettings, "site" | "platform" | "feed" | "likes" | "length">;
  arms: Arm[];
  actors: Actor[];
  /** Packs saved before spaces don't have this. */
  spaces?: Space[];
  posts: Post[];
  comments: Comment[];
  reactions: Reaction[];
  /** Packs saved before removals don't have this. */
  removals?: Removal[];
  /** Packs saved before answers to flags don't have this. */
  flagAnswers?: FlagAnswer[];
  /** Packs saved before bans don't have these. */
  bans?: Ban[];
  reportAnswers?: ReportAnswer[];
  /** Packs saved before automatic rules don't have these. */
  autoRules?: AutoRule[];
  appealAnswers?: AppealAnswer[];
  /** Packs saved before context notes don't have this. */
  contextNotes?: ContextNote[];
  /** Packs saved before stories don't have this. */
  stories?: Story[];
  /** Each post and comment's history before the pack, by kind and reference. */
  provenance: Record<string, Provenance>;
}

export interface PackSummary {
  actors: number;
  posts: number;
  comments: number;
  conditions: string[];
  /** How many items are limited to a condition, so they'd be left out of "just the background". */
  targeted: number;
  /** A few images, to recognize it by. */
  images: string[];
}

const IMAGES_IN_SUMMARY = 4;

function withoutSource<T extends { source?: unknown }>(item: T) {
  const { source: _source, ...rest } = item;
  return rest as T;
}

/** Turns a study into what a pack stores, with images pointing at where they're stored. */
export function packContents(
  {
    settings,
    actors,
    spaces,
    posts,
    comments,
    reactions,
    removals,
    flagAnswers,
    bans,
    reportAnswers,
    autoRules,
    appealAnswers,
    contextNotes,
    stories,
  }: StudyDefinition,
  mediaKeys: Map<string, string>,
  provenance: Map<string, Provenance> = new Map(),
): PackContents {
  const stored = (folder: string, picture: string | undefined) =>
    picture ? { picture: mediaKeys.get(path.join(folder, picture)) ?? picture } : {};

  const site = { ...settings.site };
  for (const field of ["logo", "favicon", "homepageImage"] as const) {
    const image = site[field];
    if (image) {
      site[field] = mediaKeys.get(image) ?? image;
    }
  }

  return {
    settings: {
      site,
      platform: settings.platform,
      feed: settings.feed,
      likes: settings.likes,
      length: settings.length,
    },
    arms: settings.conditions.arms,
    actors: actors.map((actor) => ({
      ...withoutSource(actor),
      ...stored(MEDIA_FOLDERS.actors, actor.picture),
    })),
    ...(spaces.length > 0
      ? {
          spaces: spaces.map((space) => ({
            ...withoutSource(space),
            ...stored(MEDIA_FOLDERS.spaces, space.picture),
            ...(space.banner
              ? {
                  banner:
                    mediaKeys.get(path.join(MEDIA_FOLDERS.spaces, space.banner)) ?? space.banner,
                }
              : {}),
          })),
        }
      : {}),
    posts: posts.map((post) => ({
      ...withoutSource(post),
      pictures: post.pictures.map(
        (picture) => mediaKeys.get(path.join(MEDIA_FOLDERS.posts, picture)) ?? picture,
      ),
    })),
    comments: comments.map(withoutSource),
    reactions: reactions.map(withoutSource),
    ...(removals.length > 0 ? { removals: removals.map(withoutSource) } : {}),
    ...(flagAnswers.length > 0 ? { flagAnswers: flagAnswers.map(withoutSource) } : {}),
    ...(bans.length > 0 ? { bans: bans.map(withoutSource) } : {}),
    ...(reportAnswers.length > 0 ? { reportAnswers: reportAnswers.map(withoutSource) } : {}),
    ...(autoRules.length > 0 ? { autoRules: autoRules.map(withoutSource) } : {}),
    ...(appealAnswers.length > 0 ? { appealAnswers: appealAnswers.map(withoutSource) } : {}),
    ...(contextNotes.length > 0 ? { contextNotes: contextNotes.map(withoutSource) } : {}),
    ...(stories.length > 0
      ? {
          stories: stories.map((story) => ({
            ...withoutSource(story),
            picture: mediaKeys.get(path.join(MEDIA_FOLDERS.posts, story.picture)) ?? story.picture,
          })),
        }
      : {}),
    provenance: Object.fromEntries(provenance),
  };
}

function summarize(contents: PackContents): PackSummary {
  const items = [
    ...contents.actors,
    ...contents.posts,
    ...contents.comments,
    ...contents.reactions,
    ...(contents.removals ?? []),
    ...(contents.flagAnswers ?? []),
    ...(contents.bans ?? []),
    ...(contents.reportAnswers ?? []),
    ...(contents.autoRules ?? []),
    ...(contents.appealAnswers ?? []),
    ...(contents.contextNotes ?? []),
    ...(contents.stories ?? []),
  ];
  return {
    actors: contents.actors.length,
    posts: contents.posts.length,
    comments: contents.comments.length,
    conditions: contents.arms.map(({ key }) => key),
    targeted: items.filter(({ conditions }) => conditions.length > 0).length,
    images: contents.posts
      .flatMap(({ pictures }) => pictures.slice(0, 1))
      .slice(0, IMAGES_IN_SUMMARY),
  };
}

const hashOf = (contents: PackContents) =>
  createHash("sha256").update(JSON.stringify(contents)).digest("hex");

export interface SavePack {
  /** Empty makes it available to every team on this server. */
  teamId: string | null;
  name: string;
  description?: string;
  createdBy?: string;
  contents: PackContents;
}

/** Saves a pack. It never changes after this, and saving the same thing twice keeps the first one. */
export async function savePack(
  db: Database,
  { teamId, name, description = "", createdBy, contents }: SavePack,
): Promise<{ status: "saved" | "exists"; id: string; name: string }> {
  const contentHash = hashOf(contents);
  const [existing] = await db
    .select({ id: schema.contentPacks.id, name: schema.contentPacks.name })
    .from(schema.contentPacks)
    .where(
      and(
        eq(schema.contentPacks.contentHash, contentHash),
        teamId ? eq(schema.contentPacks.teamId, teamId) : isNull(schema.contentPacks.teamId),
      ),
    );
  if (existing) {
    return { status: "exists", ...existing };
  }

  const [created] = await db
    .insert(schema.contentPacks)
    .values({
      teamId,
      name,
      description,
      contents,
      summary: summarize(contents),
      contentHash,
      ...(createdBy ? { createdBy } : {}),
    })
    .returning({ id: schema.contentPacks.id, name: schema.contentPacks.name });
  if (!created) {
    throw new Error("The pack wasn't saved.");
  }
  return { status: "saved", ...created };
}

/** Saves a study folder as a pack for everyone on this server, from the command line. */
export async function savePackFromFolder(
  db: Database,
  storage: Storage,
  folder: string,
  options: { name?: string | undefined; description?: string | undefined } = {},
): Promise<
  | { status: "failed"; issues: StudyIssue[] }
  | { status: "saved" | "exists"; id: string; name: string }
> {
  const { definition, issues } = loadStudyFolder(folder);
  if (!definition || hasErrors(issues)) {
    return { status: "failed", issues };
  }
  const { keys } = await storeMedia(definition, folder, storage);
  return savePack(db, {
    teamId: null,
    name: options.name ?? definition.settings.title,
    ...(options.description ? { description: options.description } : {}),
    contents: packContents(definition, keys),
  });
}

export interface StartStudy {
  teamId: string;
  researcherId: string;
  slug: string;
  title: string;
  /** Required, with no default: this is a design decision for the researcher. */
  assignment: StudySettings["conditions"]["assignment"]["method"];
  /** Empty starts with nothing in it. */
  pack?: { id: string; name: string; contents: PackContents } | undefined;
  /** Whether to bring the pack's conditions and what's limited to them, or only its background. */
  keep?: "everything" | "background" | undefined;
  /** Which kind of platform. It can't change once a study starts. Leave out for the pack's. */
  template?: TemplateKey | undefined;
}

/**
 * Starts a new study with a draft, from a pack or from nothing. A pack is copied, so the study is
 * theirs to change, and later changes elsewhere can't reach it.
 */
export async function startStudy(
  db: Database,
  {
    teamId,
    researcherId,
    slug,
    title,
    assignment,
    pack,
    keep = "everything",
    template,
  }: StartStudy,
): Promise<{ studyId: string; draftId: string } | EditProblem> {
  const contents = pack?.contents;
  const background = keep === "background";
  const arms: Arm[] =
    contents && !background ? contents.arms : [{ key: "control", factors: {}, weight: 1 }];
  const totalWeight = arms.reduce((sum, arm) => sum + arm.weight, 0);

  const consentPage = "pages/consent.md";
  const settings = studySettingsSchema.parse({
    schemaVersion: 1,
    slug,
    title,
    site: contents?.settings.site ?? { name: title },
    length: contents?.settings.length ?? { days: 1 },
    entry: { idParam: "PROLIFIC_PID", idLabel: "Prolific ID", source: "prolific" },
    conditions: {
      assignment:
        assignment === "blocked"
          ? { method: "blocked", blockSize: totalWeight }
          : { method: "uniform" },
      arms,
    },
    ...(contents
      ? {
          platform: contents.settings.platform,
          feed: contents.settings.feed,
          likes: contents.settings.likes,
        }
      : {}),
    ...(template
      ? {
          platform: { style: "mixed", ...contents?.settings.platform, template },
          feed: {
            ...contents?.settings.feed,
            ...(TEMPLATES[template] as TemplateDefinition).feed,
          },
        }
      : {}),
    flow: [
      { step: "consent", page: consentPage },
      { step: "account" },
      { step: "feed" },
      { step: "exit" },
    ],
  });

  const everywhere = <T extends { conditions: string[] }>(items: T[]) =>
    background ? items.filter(({ conditions }) => conditions.length === 0) : items;
  // A space limited to a condition limits what's in it, even if a post doesn't say so itself.
  const spaces = everywhere(contents?.spaces ?? []);
  const keptSpaces = new Set(spaces.map(({ key }) => key));
  const posts = everywhere(contents?.posts ?? []).filter(
    ({ space }) => !background || !space || keptSpaces.has(space),
  );
  const keptPosts = new Set(posts.map(({ ref }) => ref));
  const comments = everywhere(contents?.comments ?? []).filter(({ post }) => keptPosts.has(post));
  const reactions = everywhere(contents?.reactions ?? []);
  const keptComments = new Set(comments.map(({ ref }) => ref));
  // A removal goes with what it removes, if that was left out of this study.
  const removals = everywhere(contents?.removals ?? []).filter(({ on, target }) =>
    (on === "post" ? keptPosts : keptComments).has(target),
  );
  const bans = everywhere(contents?.bans ?? []).filter(
    ({ space }) => !space || keptSpaces.has(space),
  );
  const reportAnswers = everywhere(contents?.reportAnswers ?? []);
  const autoRules = everywhere(contents?.autoRules ?? []);
  const appealAnswers = everywhere(contents?.appealAnswers ?? []);
  const stories = everywhere(contents?.stories ?? []);
  const contextNotes = everywhere(contents?.contextNotes ?? []).filter(({ post }) =>
    keptPosts.has(post),
  );
  const flagAnswers = everywhere(contents?.flagAnswers ?? []).filter(
    ({ on, target }) => !target || (on === "comment" ? keptComments : keptPosts).has(target),
  );
  // Everyone stays, even if limited to a condition, since someone's untargeted post may need them.
  const actors = (contents?.actors ?? []).map((actor) =>
    background ? { ...actor, conditions: [] } : actor,
  );

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
      .values({
        studyId: study.id,
        settings,
        pages: { [consentPage]: STARTING_CONSENT },
        createdBy: researcherId,
      })
      .returning({ id: schema.studyDrafts.id });
    if (!draft) {
      throw new Error("The draft wasn't created.");
    }

    const fromPack = (key: string | null): Provenance =>
      pack
        ? {
            origin: "pack",
            pack: { id: pack.id, name: pack.name },
            ...(key && contents?.provenance[key] ? { before: contents.provenance[key] } : {}),
          }
        : { origin: "researcher" };

    // The same pack draws the same like counts, so studies started from it match.
    const random = createRandom(
      Number.parseInt(contents ? hashOf(contents).slice(0, 12) : "0", 16),
    );
    const drawLikes = (explicit: number | undefined, distribution: number[] | undefined) =>
      explicit ?? (distribution ? pickFrom(distribution, random) : 0);

    const actorIds = new Map(actors.map(({ username }) => [username, crypto.randomUUID()]));
    const postIds = new Map(posts.map(({ ref }) => [ref, crypto.randomUUID()]));
    const actorId = (username: string) => actorIds.get(username) as string;
    const commentIds = new Map(comments.map(({ ref }) => [ref, crypto.randomUUID()]));
    const spaceIds = new Map(spaces.map(({ key }) => [key, crypto.randomUUID()]));

    const rows: (typeof schema.draftItems.$inferInsert)[] = [
      ...actors.map(({ spaceFlair, ...actor }, position) => {
        const flair = Object.entries(spaceFlair ?? {}).flatMap(([key, text]) => {
          const id = spaceIds.get(key);
          return id ? [[id, text]] : [];
        });
        return {
          id: actorId(actor.username),
          draftId: draft.id,
          kind: "actor",
          position,
          provenance: fromPack(null),
          data: {
            ...actor,
            ...(flair.length > 0 ? { spaceFlair: Object.fromEntries(flair) } : {}),
          },
        };
      }),
      ...spaces.map((space, position) => ({
        id: spaceIds.get(space.key) as string,
        draftId: draft.id,
        kind: "space",
        position,
        provenance: fromPack(null),
        data: space,
      })),
      ...posts.map(
        (
          { actor, likes, space, crosspostOf, repostOf, quoteOf, likedBy, tagged, ...post },
          position,
        ) => ({
          id: postIds.get(post.ref) as string,
          draftId: draft.id,
          kind: "post",
          position,
          provenance: fromPack(`post:${post.ref}`),
          data: {
            ...post,
            actorId: actorId(actor),
            ...(space && spaceIds.has(space) ? { spaceId: spaceIds.get(space) as string } : {}),
            // A crosspost whose original was left out of this study is an ordinary post.
            ...(repostOf && postIds.has(repostOf)
              ? { repostOfId: postIds.get(repostOf) as string }
              : {}),
            ...(quoteOf && postIds.has(quoteOf)
              ? { quoteOfId: postIds.get(quoteOf) as string }
              : {}),
            ...(crosspostOf && postIds.has(crosspostOf)
              ? { crosspostOfId: postIds.get(crosspostOf) as string }
              : {}),
            likes: drawLikes(likes, settings.likes.posts),
            ...(likedBy && actorIds.has(likedBy) ? { likedById: actorId(likedBy) } : {}),
            ...(tagged?.some((username) => actorIds.has(username))
              ? { taggedIds: tagged.filter((username) => actorIds.has(username)).map(actorId) }
              : {}),
          },
        }),
      ),
      ...comments.map(({ actor, post, likes, replyTo, ...comment }, position) => ({
        id: commentIds.get(comment.ref) as string,
        draftId: draft.id,
        kind: "comment",
        position,
        provenance: fromPack(`comment:${comment.ref}`),
        data: {
          ...comment,
          actorId: actorId(actor),
          postId: postIds.get(post) as string,
          // A reply whose comment was left out of this study sits on the post instead.
          ...(replyTo && commentIds.has(replyTo)
            ? { replyToId: commentIds.get(replyTo) as string }
            : {}),
          likes: drawLikes(likes, settings.likes.comments),
        },
      })),
      ...reactions.map(({ actor, ...reaction }, position) => ({
        draftId: draft.id,
        kind: "reaction",
        position,
        provenance: fromPack(null),
        data: { ...reaction, actorId: actorId(actor) },
      })),
      ...removals.map(({ actor, target, ...removal }, position) => ({
        draftId: draft.id,
        kind: "removal",
        position,
        provenance: fromPack(null),
        data: {
          ...removal,
          actorId: actorId(actor),
          targetId: (removal.on === "post" ? postIds : commentIds).get(target) as string,
        },
      })),
      ...stories.map(({ actor, ...story }, position) => ({
        draftId: draft.id,
        kind: "story",
        position,
        provenance: fromPack(null),
        data: { ...story, actorId: actorId(actor) },
      })),
      ...contextNotes.map(({ post, ...note }, position) => ({
        draftId: draft.id,
        kind: "contextNote",
        position,
        provenance: fromPack(null),
        data: { ...note, targetId: postIds.get(post) as string },
      })),
      ...autoRules.map(({ actor, ...rule }, position) => ({
        draftId: draft.id,
        kind: "autoRule",
        position,
        provenance: fromPack(null),
        data: { ...rule, actorId: actorId(actor) },
      })),
      ...appealAnswers.map(({ actor, ...answer }, position) => ({
        draftId: draft.id,
        kind: "appealAnswer",
        position,
        provenance: fromPack(null),
        data: { ...answer, actorId: actorId(actor) },
      })),
      ...bans.map(({ actor, user, space, ...ban }, position) => ({
        draftId: draft.id,
        kind: "ban",
        position,
        provenance: fromPack(null),
        data: {
          ...ban,
          actorId: actorId(actor),
          bannedActorId: actorId(user),
          ...(space ? { spaceId: spaceIds.get(space) as string } : {}),
        },
      })),
      ...reportAnswers.map(({ actor, user, ...answer }, position) => ({
        draftId: draft.id,
        kind: "reportAnswer",
        position,
        provenance: fromPack(null),
        data: {
          ...answer,
          actorId: actorId(actor),
          ...(user ? { reportedActorId: actorId(user) } : {}),
        },
      })),
      ...flagAnswers.map(({ actor, target, ...answer }, position) => ({
        draftId: draft.id,
        kind: "flagAnswer",
        position,
        provenance: fromPack(null),
        data: {
          ...answer,
          actorId: actorId(actor),
          ...(target
            ? { targetId: (answer.on === "comment" ? commentIds : postIds).get(target) as string }
            : {}),
        },
      })),
    ];
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      await tx.insert(schema.draftItems).values(rows.slice(i, i + INSERT_BATCH_SIZE));
    }

    return { studyId: study.id, draftId: draft.id };
  });
}
