import { PARTICIPANT_TAG, type StudyDefinition } from "@truman3/core";
import type { ActorData, CommentData, PostData } from "./items.ts";

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
