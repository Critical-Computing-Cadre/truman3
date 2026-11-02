import type { StudySettings } from "./definition.ts";

export type PlatformStyle = StudySettings["platform"]["style"];

/** The platform's style for a condition, since a condition can differ from the rest of the study. */
export function platformStyleFor(settings: StudySettings, conditionKey: string): PlatformStyle {
  const arm = settings.conditions.arms.find(({ key }) => key === conditionKey);
  return arm?.platform?.style ?? settings.platform.style;
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
