import path from "node:path";
import { type StudyDefinition, type StudySettings, studyDefinitionSchema } from "@truman3/core";
import { MEDIA_FOLDERS } from "@truman3/study-files";
import type {
  ActorData,
  CommentData,
  DraftItem,
  PostData,
  Provenance,
  ReactionData,
  RemovalData,
  SpaceData,
} from "./items.ts";

export interface DraftAsDefinition {
  definition: StudyDefinition;
  /** Images in a draft are already stored, so each one maps to itself. */
  mediaKeys: Map<string, string>;
  /** Each post and comment's provenance, by its reference. */
  provenance: Map<string, Provenance>;
}

/**
 * Turns a draft's items into a study definition, so a draft gets exactly the same rules as a study
 * written in files. Everything points at IDs in a draft, and at usernames and refs in a definition.
 */
export function draftToDefinition(
  settings: StudySettings,
  pages: Record<string, string>,
  items: readonly DraftItem[],
): DraftAsDefinition {
  const ofKind = <T>(kind: DraftItem["kind"]) =>
    items
      .filter((item) => item.kind === kind)
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ item, data: item.data as T }));

  const actors = ofKind<ActorData>("actor");
  const spaces = ofKind<SpaceData>("space");
  const posts = ofKind<PostData>("post");
  const comments = ofKind<CommentData>("comment");
  const reactions = ofKind<ReactionData>("reaction");
  const removals = ofKind<RemovalData>("removal");

  const usernames = new Map(actors.map(({ item, data }) => [item.id, data.username]));
  const postRefs = new Map(posts.map(({ item, data }) => [item.id, data.ref]));
  const commentRefs = new Map(comments.map(({ item, data }) => [item.id, data.ref]));
  const spaceKeys = new Map(spaces.map(({ item, data }) => [item.id, data.key]));
  const usernameOf = (actorId: string) => usernames.get(actorId) ?? "(missing actor)";

  const mediaKeys = new Map<string, string>();
  const provenance = new Map<string, Provenance>();

  for (const { data } of actors) {
    if (data.picture) {
      mediaKeys.set(path.join(MEDIA_FOLDERS.actors, data.picture), data.picture);
    }
  }
  for (const { data } of spaces) {
    if (data.picture) {
      mediaKeys.set(path.join(MEDIA_FOLDERS.spaces, data.picture), data.picture);
    }
    if (data.banner) {
      mediaKeys.set(path.join(MEDIA_FOLDERS.spaces, data.banner), data.banner);
    }
  }
  for (const { item, data } of posts) {
    for (const picture of data.pictures ?? []) {
      mediaKeys.set(path.join(MEDIA_FOLDERS.posts, picture), picture);
    }
    provenance.set(`post:${data.ref}`, item.provenance as Provenance);
  }
  for (const { item, data } of comments) {
    provenance.set(`comment:${data.ref}`, item.provenance as Provenance);
  }
  for (const image of [settings.site.logo, settings.site.favicon, settings.site.homepageImage]) {
    if (image) {
      mediaKeys.set(image, image);
    }
  }

  const definition = studyDefinitionSchema.parse({
    settings,
    // A step can be removed, and its page stay behind so it can be undone. It shouldn't be frozen.
    pages: Object.fromEntries(
      Object.entries(pages).filter(([key]) =>
        settings.flow.some((step) => "page" in step && step.page === key),
      ),
    ),
    actors: actors.map(({ data: { spaceFlair, ...actor } }) => {
      // A space that's been removed takes what people showed in it with it.
      const flair = Object.entries(spaceFlair ?? {}).flatMap(([spaceId, text]) => {
        const key = spaceKeys.get(spaceId);
        return key ? [[key, text]] : [];
      });
      return { ...actor, ...(flair.length > 0 ? { spaceFlair: Object.fromEntries(flair) } : {}) };
    }),
    spaces: spaces.map(({ data }) => data),
    posts: posts.map(({ data: { actorId, spaceId, crosspostOfId, ...post } }) => ({
      ...post,
      actor: usernameOf(actorId),
      ...(crosspostOfId ? { crosspostOf: postRefs.get(crosspostOfId) ?? "(missing post)" } : {}),
      ...(spaceId ? { space: spaceKeys.get(spaceId) ?? "(missing space)" } : {}),
    })),
    comments: comments.map(({ data: { actorId, postId, replyToId, ...comment } }) => ({
      ...comment,
      actor: usernameOf(actorId),
      post: postRefs.get(postId) ?? "(missing post)",
      ...(replyToId ? { replyTo: commentRefs.get(replyToId) ?? "(missing comment)" } : {}),
    })),
    reactions: reactions.map(({ data: { actorId, ...reaction } }) => ({
      ...reaction,
      actor: usernameOf(actorId),
    })),
    removals: removals.map(({ data: { actorId, targetId, ...removal } }) => ({
      ...removal,
      actor: usernameOf(actorId),
      target:
        (removal.on === "post" ? postRefs.get(targetId) : commentRefs.get(targetId)) ??
        `(missing ${removal.on})`,
    })),
  });

  return { definition, mediaKeys, provenance };
}
