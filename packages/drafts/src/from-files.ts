import { PARTICIPANT_TAG, type StudyDefinition } from "@truman3/core";
import type { ActorData, CommentData, ItemKind, PostData } from "./items.ts";

type Actor = StudyDefinition["actors"][number];
type Post = StudyDefinition["posts"][number];
type Comment = StudyDefinition["comments"][number];

/**
 * The item IDs of what's in a draft, by the names files use for them: usernames, post and comment
 * IDs, and space keys. Files point at each other by those names, and items by item ID.
 */
export interface ItemIds {
  actors: ReadonlyMap<string, string>;
  posts: ReadonlyMap<string, string>;
  comments: ReadonlyMap<string, string>;
  spaces: ReadonlyMap<string, string>;
}

/** Someone in the cast, as a file describes them, as an item. */
export function actorItemData({ spaceFlair, source: _source, ...actor }: Actor, ids: ItemIds) {
  const flair = Object.entries(spaceFlair ?? {}).flatMap(([key, text]) => {
    const id = ids.spaces.get(key);
    return id ? [[id, text]] : [];
  });
  return {
    ...actor,
    ...(flair.length > 0 ? { spaceFlair: Object.fromEntries(flair) } : {}),
  } satisfies ActorData;
}

/**
 * A post, as a file describes it, as an item. Anything it points at that isn't in the draft is left
 * out: a crosspost whose original isn't there is an ordinary post.
 */
export function postItemData(
  {
    actor,
    likes: _likes,
    space,
    crosspostOf,
    repostOf,
    quoteOf,
    likedBy,
    tagged,
    source: _source,
    ...post
  }: Post,
  ids: ItemIds,
  likes: number,
) {
  const posted = (ref: string | undefined) => (ref ? ids.posts.get(ref) : undefined);
  const taggedIds = (tagged ?? []).flatMap((username) => {
    const id = ids.actors.get(username);
    return id ? [id] : [];
  });
  const spaceId = space ? ids.spaces.get(space) : undefined;
  const likedById = likedBy ? ids.actors.get(likedBy) : undefined;
  const repostOfId = posted(repostOf);
  const quoteOfId = posted(quoteOf);
  const crosspostOfId = posted(crosspostOf);
  return {
    ...post,
    actorId: ids.actors.get(actor) as string,
    ...(spaceId ? { spaceId } : {}),
    ...(repostOfId ? { repostOfId } : {}),
    ...(quoteOfId ? { quoteOfId } : {}),
    ...(crosspostOfId ? { crosspostOfId } : {}),
    likes,
    ...(likedById ? { likedById } : {}),
    ...(taggedIds.length > 0 ? { taggedIds } : {}),
    ...(tagged?.includes(PARTICIPANT_TAG) ? { tagsParticipant: true } : {}),
  } satisfies PostData;
}

/** A comment, as a file describes it, as an item. A reply whose comment isn't there sits on the post. */
export function commentItemData(
  { actor, post, likes: _likes, replyTo, source: _source, ...comment }: Comment,
  ids: ItemIds,
  likes: number,
) {
  const replyToId = replyTo ? ids.comments.get(replyTo) : undefined;
  return {
    ...comment,
    actorId: ids.actors.get(actor) as string,
    postId: ids.posts.get(post) as string,
    ...(replyToId ? { replyToId } : {}),
    likes,
  } satisfies CommentData;
}

/** What files describe besides settings, by kind, as `startStudy` and uploads both have it. */
export type FileTables = Pick<
  StudyDefinition,
  | "actors"
  | "spaces"
  | "posts"
  | "comments"
  | "reactions"
  | "removals"
  | "labels"
  | "stories"
  | "contextNotes"
  | "autoRules"
  | "appealAnswers"
  | "bans"
  | "reportAnswers"
  | "flagAnswers"
>;

/** One draft item made from a row of a file, before it has a draft or a place. */
export interface FileItem {
  /** Set for what others can point at; the database makes one for the rest. */
  id?: string;
  kind: ItemKind;
  /** What its history before the draft is filed under, for posts and comments. */
  provenanceKey: string | null;
  data: Record<string, unknown>;
}

function withoutSource<T extends { source?: unknown }>(row: T): Omit<T, "source"> {
  const { source: _source, ...rest } = row;
  return rest;
}

/**
 * Every row of these tables as a draft item, in the order the builder lists kinds. `ids` has an
 * item ID for each username, post, comment, and space anything can point at, including any already
 * in the draft. `likes` draws a starting count where a row doesn't give one.
 */
export function itemsFromTables(
  tables: FileTables,
  ids: ItemIds,
  likes: {
    post: (given: number | undefined) => number;
    comment: (given: number | undefined) => number;
  },
): FileItem[] {
  const actorId = (username: string) => ids.actors.get(username) as string;
  const targetOf = (on: "post" | "comment" | undefined, ref: string) =>
    (on === "comment" ? ids.comments : ids.posts).get(ref) as string;
  return [
    ...tables.actors.map((actor) => ({
      id: actorId(actor.username),
      kind: "actor" as const,
      provenanceKey: null,
      data: actorItemData(actor, ids),
    })),
    ...tables.spaces.map((space) => ({
      id: ids.spaces.get(space.key) as string,
      kind: "space" as const,
      provenanceKey: null,
      data: withoutSource(space),
    })),
    ...tables.posts.map((post) => ({
      id: ids.posts.get(post.ref) as string,
      kind: "post" as const,
      provenanceKey: `post:${post.ref}`,
      data: postItemData(post, ids, likes.post(post.likes)),
    })),
    ...tables.comments.map((comment) => ({
      id: ids.comments.get(comment.ref) as string,
      kind: "comment" as const,
      provenanceKey: `comment:${comment.ref}`,
      data: commentItemData(comment, ids, likes.comment(comment.likes)),
    })),
    ...tables.reactions.map(({ actor, ...reaction }) => ({
      kind: "reaction" as const,
      provenanceKey: null,
      data: { ...withoutSource(reaction), actorId: actorId(actor) },
    })),
    ...tables.removals.map(({ actor, target, ...removal }) => ({
      kind: "removal" as const,
      provenanceKey: null,
      data: {
        ...withoutSource(removal),
        actorId: actorId(actor),
        targetId: targetOf(removal.on, target),
      },
    })),
    ...tables.labels.map(({ actor, target, ...labeling }) => ({
      kind: "label" as const,
      provenanceKey: null,
      data: {
        ...withoutSource(labeling),
        actorId: actorId(actor),
        targetId: targetOf(labeling.on, target),
      },
    })),
    ...tables.stories.map(({ actor, ...story }) => ({
      kind: "story" as const,
      provenanceKey: null,
      data: { ...withoutSource(story), actorId: actorId(actor) },
    })),
    ...tables.contextNotes.map(({ post, ...note }) => ({
      kind: "contextNote" as const,
      provenanceKey: null,
      data: { ...withoutSource(note), targetId: ids.posts.get(post) as string },
    })),
    ...tables.autoRules.map(({ actor, ...rule }) => ({
      kind: "autoRule" as const,
      provenanceKey: null,
      data: { ...withoutSource(rule), actorId: actorId(actor) },
    })),
    ...tables.appealAnswers.map(({ actor, ...answer }) => ({
      kind: "appealAnswer" as const,
      provenanceKey: null,
      data: { ...withoutSource(answer), actorId: actorId(actor) },
    })),
    ...tables.bans.map(({ actor, user, space, ...ban }) => ({
      kind: "ban" as const,
      provenanceKey: null,
      data: {
        ...withoutSource(ban),
        actorId: actorId(actor),
        bannedActorId: actorId(user),
        ...(space ? { spaceId: ids.spaces.get(space) as string } : {}),
      },
    })),
    ...tables.reportAnswers.map(({ actor, user, ...answer }) => ({
      kind: "reportAnswer" as const,
      provenanceKey: null,
      data: {
        ...withoutSource(answer),
        actorId: actorId(actor),
        ...(user ? { reportedActorId: actorId(user) } : {}),
      },
    })),
    ...tables.flagAnswers.map(({ actor, target, ...answer }) => ({
      kind: "flagAnswer" as const,
      provenanceKey: null,
      data: {
        ...withoutSource(answer),
        actorId: actorId(actor),
        ...(target ? { targetId: targetOf(answer.on, target) } : {}),
      },
    })),
  ];
}
