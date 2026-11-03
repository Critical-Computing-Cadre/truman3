import { FEATURE_KEYS, type FeatureSet } from "./catalog.ts";

/**
 * How posts and the page around them are arranged. A layout's look can't change once a study has
 * launched with it, so changing one means adding a new name, such as `classic-2` (ADR 18).
 */
export const LAYOUT_KEYS = ["classic"] as const;

export type LayoutKey = (typeof LAYOUT_KEYS)[number];

export interface TemplateDefinition {
  name: string;
  description: string;
  layout: LayoutKey;
  features: FeatureSet;
}

const allFeatures = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])) as FeatureSet;

/** Starting points. A study copies one, and can then change anything about it. */
export const TEMPLATES = {
  classic: {
    name: "Classic",
    description: "Truman's original platform: a feed of posts with comments open below each.",
    layout: "classic",
    features: { ...allFeatures, threads: false },
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof TEMPLATES;

export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as [TemplateKey, ...TemplateKey[]];

export const DEFAULT_TEMPLATE: TemplateKey = "classic";
