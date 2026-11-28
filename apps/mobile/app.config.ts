import type { ExpoConfig } from "expo/config";

/**
 * The app's name, icon, and which Truman site it opens are set when it's built, so each lab can give
 * it a neutral name that doesn't say "research", and a study can have its own build if it needs one.
 * See README.md and ADR 66.
 *
 * Each setting is read from the environment, which is how Expo's build servers get it. On your own
 * computer it falls back to app.local.json, a file you write once and that isn't committed, so the
 * `eas` commands know which Expo project this is without anything typed in front of them.
 */
// Expo compiles this file to CommonJS before running it, where these two exist. The app has no
// Node types of its own, so this says what's used of them.
declare const __dirname: string;
declare const require: (name: "node:fs") => {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
};
const files = require("node:fs");
const localFile = `${__dirname}/app.local.json`;
const local: Record<string, string | undefined> = files.existsSync(localFile)
  ? JSON.parse(files.readFileSync(localFile, "utf8"))
  : {};
const setting = (key: string): string | undefined => process.env[key] || local[key] || undefined;

const name = setting("TRUMAN_APP_NAME") ?? "Commons";
const slug = setting("TRUMAN_APP_SLUG") ?? "commons";
const id = setting("TRUMAN_APP_ID") ?? "edu.example.commons";
const owner = setting("TRUMAN_APP_OWNER");
const projectId = setting("EAS_PROJECT_ID");
const googleServices = setting("GOOGLE_SERVICES_JSON");
const siteUrl = setting("TRUMAN_SITE_URL") ?? "http://localhost:5180";

/**
 * The web addresses whose join links open the app (ADR 108): the site's own, and any others in
 * TRUMAN_LINK_HOSTS, separated by commas, for a Truman whose studies run at several domains. Only
 * for a site served over https. Each address also has to say the app is its own, which is the
 * stage's `app` setting in infra/lib/stages.ts. Until it does, links open in the browser.
 */
const siteHost = /^https:\/\/([^/:]+)/.exec(siteUrl)?.[1];
const linkHosts = [
  ...new Set(
    [siteHost, ...(setting("TRUMAN_LINK_HOSTS") ?? "").split(",")]
      .map((host) => host?.trim().toLowerCase())
      .filter((host): host is string => Boolean(host)),
  ),
].filter(() => siteHost !== undefined);

const config: ExpoConfig = {
  name,
  slug,
  // The Expo account the project is in, when it isn't your personal one.
  ...(owner ? { owner } : {}),
  version: "0.1.0",
  orientation: "portrait",
  // Links like commons://join/bystander open the app at that study.
  scheme: slug,
  userInterfaceStyle: "automatic",
  // The default icon is two speech bubbles, neutral on purpose. Put a lab's own in assets/.
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: id,
    supportsTablet: false,
    // The app only uses the encryption the phone provides (HTTPS), which is exempt. Saying so here
    // saves Apple asking with every upload.
    config: { usesNonExemptEncryption: false },
    ...(linkHosts.length > 0
      ? { associatedDomains: linkHosts.map((host) => `applinks:${host}`) }
      : {}),
  },
  android: {
    package: id,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#26547c" },
    // Push notifications on Android go through Firebase, which needs this file from the lab's
    // Firebase project. Without it the app builds, and push works on iPhones only. See README.md.
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
    // A study's join link at one of these addresses opens the app, once Android has checked with
    // the address that the app is its own.
    ...(linkHosts.length > 0
      ? {
          intentFilters: [
            {
              action: "VIEW",
              autoVerify: true,
              data: linkHosts.map((host) => ({ scheme: "https", host, pathPrefix: "/join/" })),
              category: ["BROWSABLE", "DEFAULT"],
            },
          ],
        }
      : {}),
  },
  plugins: ["expo-notifications"],
  extra: {
    /** The participant site, like https://truman.example.edu. */
    siteUrl,
    /** The addresses whose join links open the app, for the app to know one when it's handed one. */
    linkHosts,
    eas: projectId ? { projectId } : undefined,
  },
};

export default config;
