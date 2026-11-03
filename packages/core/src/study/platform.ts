import { FEATURE_KEYS, type FeatureKey, type FeatureSet } from "../features/catalog.ts";
import { DEFAULT_TEMPLATE, type LayoutKey, TEMPLATES } from "../features/templates.ts";
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

/** Everything a browser needs to draw this platform for someone in a condition. */
export function platformFor(settings: StudySettings, conditionKey: string) {
  return {
    layout: layoutFor(settings),
    features: featuresFor(settings, conditionKey),
    platformStyle: platformStyleFor(settings, conditionKey),
    commentBox: commentBoxFor(settings, conditionKey),
  };
}

export type PlatformView = ReturnType<typeof platformFor>;

/**
 * Copies what comes from the template into the settings, for a version about to freeze. A later
 * change to a template can't then change a study that has already launched (ADR 18).
 */
export function freezePlatform(settings: StudySettings): StudySettings {
  const template = settings.platform.template ?? DEFAULT_TEMPLATE;
  return {
    ...settings,
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
): string | null {
  switch (style) {
    case "photo":
      return hasImage ? null : "Add a photo to your post.";
    case "text":
      if (hasImage) {
        return "Photos can't be added to posts here.";
      }
      return hasText ? null : "Write something to post.";
    case "mixed":
      return hasText || hasImage ? null : "Add some text or a photo.";
  }
}
