import { FEATURE_KEYS, type FeatureKey, type FeatureSet } from "../features/catalog.ts";
import {
  DEFAULT_TEMPLATE,
  type LayoutKey,
  TEMPLATES,
  type TemplateDefinition,
} from "../features/templates.ts";
import type { StudySettings } from "./definition.ts";

export type PlatformStyle = StudySettings["platform"]["style"];

/** The platform's style for a condition, since a condition can differ from the rest of the study. */
export function platformStyleFor(settings: StudySettings, conditionKey: string): PlatformStyle {
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  return arm?.platform?.style ?? settings.platform.style;
}

export type CommentBox = NonNullable<StudySettings["platform"]["commentBox"]>;

/** How the comment box appears in a condition. */
export function commentBoxFor(settings: StudySettings, conditionKey: string): CommentBox {
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  return arm?.platform?.commentBox ?? settings.platform.commentBox ?? "open";
}

/** Which features are on in a condition: the template, then the study, then the condition. */
export function featuresFor(settings: StudySettings, conditionKey: string): FeatureSet {
  const template = TEMPLATES[settings.platform.template ?? DEFAULT_TEMPLATE];
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [
      key,
      arm?.platform?.features?.[key] ?? settings.platform.features?.[key] ?? template.features[key],
    ]),
  ) as FeatureSet;
}

export function featureOn(
  settings: StudySettings,
  conditionKey: string,
  feature: FeatureKey,
): boolean {
  return featuresFor(settings, conditionKey)[feature];
}

export function layoutFor(settings: StudySettings): LayoutKey {
  return (
    settings.platform.layout ?? TEMPLATES[settings.platform.template ?? DEFAULT_TEMPLATE].layout
  );
}

/** Whether participants can join and leave spaces in a condition. A study decides this. */
export function canJoinSpacesFor(settings: StudySettings, conditionKey: string): boolean {
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  return arm?.platform?.canJoinSpaces ?? settings.platform.canJoinSpaces ?? true;
}

/** Whether participants can choose a feed's order in a condition. A study decides this. */
export function canSortFor(settings: StudySettings, conditionKey: string): boolean {
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  return arm?.feed?.participantsCanSort ?? settings.feed.participantsCanSort ?? false;
}

/** Whether participants can choose an order for comments in a condition. A study decides this. */
export function canSortCommentsFor(settings: StudySettings, conditionKey: string): boolean {
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  return (
    arm?.feed?.participantsCanSortComments ?? settings.feed.participantsCanSortComments ?? false
  );
}

/** A participant's karma before any votes on what they post. */
export function startingKarmaFor(settings: StudySettings, conditionKey: string): number {
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  return arm?.platform?.startingKarma ?? settings.platform.startingKarma ?? 0;
}

/**
 * What scripted changes have added to someone's karma by this point. `username` is someone in the
 * cast, and null is the participant.
 */
export function scriptedKarmaChange(
  settings: StudySettings,
  conditionKey: string,
  username: string | null,
  elapsedMs: number,
): number {
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  const changes = arm?.platform?.karmaChanges ?? settings.platform.karmaChanges ?? [];
  return changes
    .filter(
      ({ actor, afterMinutes }) =>
        (actor ?? null) === username && afterMinutes * 60_000 <= elapsedMs,
    )
    .reduce((total, { change }) => total + change, 0);
}

/** Everything a browser needs to draw this platform for someone in a condition. */
export function platformFor(settings: StudySettings, conditionKey: string) {
  return {
    layout: layoutFor(settings),
    features: featuresFor(settings, conditionKey),
    platformStyle: platformStyleFor(settings, conditionKey),
    commentBox: commentBoxFor(settings, conditionKey),
    canJoinSpaces: canJoinSpacesFor(settings, conditionKey),
    canSort: canSortFor(settings, conditionKey),
    canSortComments: canSortCommentsFor(settings, conditionKey),
  };
}

export type PlatformView = ReturnType<typeof platformFor>;

/**
 * Copies what comes from the template into the settings, for a version about to freeze. A later
 * change to a template can't then change a study that has already launched (ADR 18).
 */
export function freezePlatform(settings: StudySettings): StudySettings {
  const template = settings.platform.template ?? DEFAULT_TEMPLATE;
  const commentOrder =
    settings.feed?.commentOrder ?? (TEMPLATES[template] as TemplateDefinition).feed?.commentOrder;
  return {
    ...settings,
    ...(commentOrder ? { feed: { ...settings.feed, commentOrder } } : {}),
    platform: {
      ...settings.platform,
      template,
      layout: layoutFor(settings),
      features: { ...TEMPLATES[template].features, ...settings.platform.features },
    },
  };
}

/** Whether a new post fits the platform's style. Returns what's wrong, or null if it's fine. */
export function checkNewPost(
  style: PlatformStyle,
  hasText: boolean,
  hasImage: boolean,
  /** A title or a link can be enough by itself, except on a platform that's about photos. */
  also: { titled?: boolean; linked?: boolean } = {},
): string | null {
  const enough = hasText || Boolean(also.titled) || Boolean(also.linked);
  switch (style) {
    case "photo":
      return hasImage ? null : "Add a photo to your post.";
    case "text":
      if (hasImage) {
        return "Photos can't be added to posts here.";
      }
      return enough ? null : "Write something to post.";
    case "mixed":
      return enough || hasImage ? null : "Add some text or a photo.";
  }
}
