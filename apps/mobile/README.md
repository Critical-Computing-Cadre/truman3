# Truman's app

A phone app for participants: a native shell around the participant site, built with Expo. It gives the site a place on the home screen, keeps people signed in, sends push notifications, and records when it's opened and closed. Everything a participant sees comes from the site, so every template and feature works in it. ADR 66 explains why.

It's its own project, with npm, apart from the rest of the repository, so React Native stays out of the API and the website.

## Trying it on your phone

You don't need a developer account for this.

1. Install **Expo Go** from the App Store or Google Play.
2. Here:

   ```
   cd apps/mobile
   npm install --before=$(date -v-14d +%Y-%m-%d)
   TRUMAN_SITE_URL=https://your-truman-site npx expo start
   ```

   `--before` keeps every package at least two weeks old, as the rest of the repository does.
3. Scan the QR code it shows with your phone's camera. The app opens the site.

To join a study, open its link on the phone, or open `exp://…/--/join/<study>?PROLIFIC_PID=…` while trying it in Expo Go.

Push notifications need a real build (below), since Expo Go can't receive them for another app, and a study with `push: true` in its features.

## Settings

Read when the app is built:

|                        |                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `TRUMAN_SITE_URL`      | The participant site it opens, like `https://truman.example.edu`                   |
| `TRUMAN_APP_NAME`      | Its name on the home screen. Choose something neutral; the default is "Commons"    |
| `TRUMAN_APP_SLUG`      | A short name, used in links like `commons://join/bystander`                        |
| `TRUMAN_APP_ID`        | Its ID in the stores, like `edu.youruniversity.commons`. It can't be changed later |
| `EAS_PROJECT_ID`       | The Expo project, for push notifications. `eas init` prints it                     |
| `TRUMAN_APP_OWNER`     | The Expo account the project is in, if it's an organization and not your own       |
| `GOOGLE_SERVICES_JSON` | The path to Firebase's `google-services.json`, for push on Android                 |

They're read from two places:

- **`app.local.json`, on your computer.** A file beside `app.config.ts` that isn't committed, like this:

  ```json
  {
    "TRUMAN_APP_OWNER": "your-lab",
    "EAS_PROJECT_ID": "the ID eas init printed",
    "TRUMAN_APP_NAME": "Commons",
    "TRUMAN_APP_SLUG": "commons",
    "TRUMAN_APP_ID": "edu.youruniversity.commons",
    "TRUMAN_SITE_URL": "https://your-truman-site"
  }
  ```

  The `eas` commands read it to know which Expo project this is. An environment variable in your terminal wins over it, which is how the Expo Go steps above work.
- **The Expo project's environment variables,** for a build, since the build runs on Expo's computers and doesn't see your files. See below.

The default icon is two speech bubbles: `assets/icon.png` (1024×1024, no transparency) and `assets/adaptive-icon.png` (Android's, the drawing alone on a transparent square). Replace both for your own.

## Building it for testers

You need an Apple Developer account, a Google Play developer account, and a free Expo account. Each step that signs in is yours to do: nothing here needs anyone else to have your passwords.

**Once:**

1. **Sign in to Expo and make the project.**

   ```
   cd apps/mobile
   npm install --global eas-cli
   eas login
   eas init
   ```

   `eas init` prints a project ID, and says it can't write it to `app.config.ts`. That's expected: put it in `app.local.json` (above), with the rest of the settings. If the project should be in an organization's account, add `--account your-lab` to `eas init`.

2. **Save the same settings in the Expo project,** one command for each, except `GOOGLE_SERVICES_JSON`:

   ```
   eas env:set --environment production --visibility plaintext --name TRUMAN_SITE_URL --value https://your-truman-site
   ```

   The same values go in the `preview` environment if you use the `preview` profile. `eas env:list production` shows what's there.

3. **Make the app in each store,** with the same ID as `TRUMAN_APP_ID`: in App Store Connect under Apps, and in Google Play Console under Create app.

4. **For push on Android, make a Firebase project** (free) at console.firebase.google.com and add an Android app to it with the same ID. Two files come from it:
   - `google-services.json`. On expo.dev, in the project's environment variables, add it as a **file** named `GOOGLE_SERVICES_JSON`.
   - A service account key, from Firebase's Settings, Service accounts, Generate new private key. On expo.dev, under Credentials, Service credentials, add it as the **FCM V1 service account key**.

   Skip this and the app still builds. Push then works on iPhones only.

5. **Let Expo upload to Google Play:** it needs a Google service account key of its own, added on expo.dev under Credentials, Android. Expo's guide to making one is at docs.expo.dev/submit/android.

**Each build:**

1. `eas build --profile testers --platform all`. The first time, it offers to make the signing keys and keep them in your Expo account. Say yes.
2. `eas submit --profile testers --platform all`. It asks you to sign in to Apple, and uploads to TestFlight and to Google Play's internal testing track.
3. Invite people: in App Store Connect under TestFlight, and in Play Console under Testing. To reach people outside your own team, TestFlight needs an external group, which Apple reviews once, and Play needs the build promoted from internal to closed testing.

Both stores ask for a link to a privacy policy before outside testers can join. TestFlight builds last 90 days, so a long study may need a new one.

## Trying it without a phone

On a Mac with Xcode, a build for the iPhone simulator needs no Apple account:

1. `eas build --profile simulator --platform ios`. It reads the `preview` settings.
2. Download the build from its page on expo.dev and unpack it. Start a simulator from Xcode (Open Developer Tool, Simulator), and drag the `.app` onto it.
3. To join a study, open its link in the simulator's Safari with the app's own scheme, like `commons://join/<study>?PROLIFIC_PID=…`, and choose Open.

Push notifications don't arrive in a simulator.

For an Android phone, `eas build --profile preview --platform android` makes a file to install straight from the build's page, with no store involved.

## Updating its packages

Expo decides which versions of React, React Native, and its own packages go together. After changing any of them, run `npx expo install --check`, and `npx expo install --fix` to put them back in step. That's why Dependabot only proposes security fixes here.

## How someone joins a study in it

- **They tap a link made for the app,** like `commons://join/bystander?PROLIFIC_PID=…`, and the app opens at that study.
- **Or they open the app and paste their link.** Someone who isn't in a study sees "Join a study" and a box for the link they were given. Any form of it works: the study's web link, the app's kind, or the part from `/join/` on. It only ever goes to a join page on the app's own site.

A study's ordinary web link, tapped on a phone, opens in the browser and not the app.

## How it talks to the site

The app never handles who someone is: the site keeps its own session, and the app tells the site what only the app knows, with a `truman-app` event on the page. `apps/participant/src/app-bridge.ts` listens, and sends it to the API:
- the push token, to `POST /me/push`
- `app.opened` and `app.closed`, with how long it was open
- `push.permission`, whether they allowed notifications, with the phone's reason if it couldn't set them up
- `push.opened`, when they open the app from one

The API sends push notifications every 30 seconds for what's newly due (`apps/api/src/push.ts`), through Expo's push service.
