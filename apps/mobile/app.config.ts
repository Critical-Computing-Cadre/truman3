import type { ExpoConfig } from "expo/config";

/**
 * The app's name, icon, and which Truman site it opens are set when it's built, so each lab can give
 * it a neutral name that doesn't say "research", and a study can have its own build if it needs one.
 * See README.md and ADR 66.
 */
const name = process.env.TRUMAN_APP_NAME ?? "Commons";
const slug = process.env.TRUMAN_APP_SLUG ?? "commons";
const id = process.env.TRUMAN_APP_ID ?? "edu.example.commons";

const config: ExpoConfig = {
  name,
  slug,
  version: "0.1.0",
  orientation: "portrait",
  // Links like commons://join/bystander open the app at that study.
  scheme: slug,
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: id, supportsTablet: false },
  android: { package: id },
  plugins: ["expo-notifications"],
  extra: {
    /** The participant site, like https://truman.example.edu. */
    siteUrl: process.env.TRUMAN_SITE_URL ?? "http://localhost:5180",
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
