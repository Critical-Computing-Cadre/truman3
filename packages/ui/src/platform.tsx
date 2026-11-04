import {
  DEFAULT_TEMPLATE,
  type FeatureKey,
  type FeatureSet,
  type LayoutKey,
  TEMPLATES,
} from "@truman3/core";
import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";

export interface PlatformChoices {
  layout: LayoutKey;
  features: FeatureSet;
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
    <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
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
