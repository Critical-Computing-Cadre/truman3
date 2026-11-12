import {
  DEFAULT_TEMPLATE,
  type FeatureKey,
  type FeatureSet,
  type LayoutKey,
  TEMPLATES,
  textOnAccent,
} from "@truman3/core";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";

export interface PlatformChoices {
  layout: LayoutKey;
  features: FeatureSet;
  /** The study's own main color, as #rrggbb. Without one, the layout's. */
  accent?: string | null | undefined;
  /** What's only for show that the study left out, by key, and what it added, by label. */
  decor?: { hide: string[]; add: string[] } | undefined;
}

/**
 * What to put on an element so everything inside takes a platform's colors (skins.css). The study's
 * own color goes on the same element as the layout's name, where the rest is worked out from it.
 */
export function skinProps(platform: Pick<PlatformChoices, "layout" | "accent">) {
  return {
    "data-layout": platform.layout,
    ...(platform.accent
      ? {
          style: {
            "--accent-base": platform.accent,
            "--color-on-accent": textOnAccent(platform.accent),
          } as CSSProperties,
        }
      : {}),
  };
}

const PlatformContext = createContext<PlatformChoices>(TEMPLATES[DEFAULT_TEMPLATE]);

/** Says which platform everything inside it belongs to. Without one, it's the Classic template. */
export function PlatformProvider({
  platform,
  children,
}: {
  platform: PlatformChoices | undefined;
  children: ReactNode;
}) {
  return platform ? (
    <PlatformContext.Provider value={platform}>
      {/* Takes up no room of its own. It's only there to carry the platform's colors. */}
      <div className="contents" {...skinProps(platform)}>
        {children}
      </div>
    </PlatformContext.Provider>
  ) : (
    children
  );
}

export function usePlatform() {
  return useContext(PlatformContext);
}

/** Whether a building block is part of this platform, in this person's condition. */
export function useFeature(feature: FeatureKey) {
  return usePlatform().features[feature];
}

const PHONE_WIDTH = "(max-width: 639px)";

/** Whether this is a phone's width, for what can't just be arranged differently by CSS. */
export function useIsPhone() {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") {
        return () => {};
      }
      const query = window.matchMedia(PHONE_WIDTH);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(PHONE_WIDTH).matches,
  );
}
