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

Set when it's built, with environment variables:

|                   |                                                                                 |
| ----------------- | ------------------------------------------------------------------------------- |
| `TRUMAN_SITE_URL` | The participant site it opens, like `https://truman.example.edu`                |
| `TRUMAN_APP_NAME` | Its name on the home screen. Choose something neutral; the default is "Commons" |
| `TRUMAN_APP_SLUG` | A short name, used in links like `commons://join/bystander`                     |
| `TRUMAN_APP_ID`   | Its ID in the stores, like `edu.youruniversity.commons`                         |
| `EAS_PROJECT_ID`  | The Expo project, for push notifications. `eas init` prints it                  |

The icon goes in `assets/icon.png` (1024×1024), added to `app.config.ts` as `icon`.

## Building it for testers

Once the lab's Apple and Google developer accounts exist (see the vault note `Mobile app design`):

1. `npx eas-cli login`, with the lab's Expo account, and `npx eas-cli init` once.
2. `TRUMAN_SITE_URL=… npx eas-cli build --profile testers --platform all`
3. `npx eas-cli submit --profile testers --platform all`. It asks you to sign in to Apple and Google, and uploads to TestFlight and Google Play's closed testing.
4. Invite participants from TestFlight and Play Console.

TestFlight builds last 90 days, so a long study may need a new one.

## How it talks to the site

The app never handles who someone is: the site keeps its own session, and the app tells the site what only the app knows, with a `truman-app` event on the page. `apps/participant/src/app-bridge.ts` listens, and sends it to the API:
- the push token, to `POST /me/push`
- `app.opened` and `app.closed`, with how long it was open
- `push.permission`, whether they allowed notifications
- `push.opened`, when they open the app from one

The API sends push notifications every 30 seconds for what's newly due (`apps/api/src/push.ts`), through Expo's push service.
