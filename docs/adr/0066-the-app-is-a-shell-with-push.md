# 66. The app is a native shell around the site, with push notifications

## Context

Dominic wants participants to use a real phone app for their study, so it feels like a real platform. The vault note `Design plan v3` planned an Expo app as Phase 6, and he moved it up. The vault note `Mobile app design` set out the choices, and he answered them:
- **A native shell around the participant website first,** with fully native screens later if needed.
- **One neutral app by default,** with builds for each study possible later.
- **Testing channels to start:** TestFlight and Google Play's closed testing.
- **Both platforms,** with accounts he'll set up.
- **Push notifications** that a study turns on or off.

## Decision

- **`apps/mobile` is an Expo app (SDK 58) around the participant site.**
  - It shows the site in a WebView, keeps its sign-in cookie between visits, and goes back with Android's back button.
  - It opens study links, and notifications, at the right page.
  - Its name, icon, store ID, and which site it opens are set when it's built, so a lab can give it a neutral name, and a study can have its own build.
- **It's its own npm project, outside the pnpm workspace.**
  - React Native brings about 470 packages, which the API, the website, and CI don't need.
  - The app only talks to the site, so it needs nothing from the shared packages.
  - Its packages are installed with `--before`, so they're at least two weeks old, like the rest.
- **The app never handles who someone is.** The site keeps its session. The app tells the page what only it knows, with `truman-app` events, and the page's bridge (`apps/participant/src/app-bridge.ts`) sends them to the API:
  - **The push token** goes to `POST /me/push`, and is kept on the session. So it's deleted when someone withdraws, as their sessions are.
  - **`app.opened` and `app.closed`** are recorded, with how long it was open: new data, only an app has it.
  - **`push.permission`** records whether they allowed notifications, and **`push.opened`** records when they open the app from one.
- **A `push` feature,** off in every template, as with other new features (ADR 61). A study turns it on.
- **Push notifications are sent every 30 seconds** by the API (`apps/api/src/push.ts`).
  - Nothing else in Truman runs between a participant's visits, since what's due is worked out when they load something. For each participant with push on, the loop catches up their world as if they'd checked in, so what the cast does while the app is closed happens on time.
  - It then sends what has newly come due: what their Notifications page would show, without muted threads, and direct messages to them.
  - Each is claimed before it's sent (`pushed_at`), so it's sent once.
  - Only what's due after they turned push on is sent, so nobody gets a backlog.
  - Each push is a `push.sent` event, with what it said.
- **A push says who, not what:** "Jake replied to you", never what anyone wrote. It passes through Expo, Apple, and Google, which shouldn't see study content.

## Alternatives

- **Fully native screens first.** They'd feel most like a real app. But all four templates and about 50 features would be built twice, and kept in step. The vault note lists what a rebuild would take.
- **A progressive web app,** installed from the browser. No store is needed, but iPhones limit their push notifications and home-screen installs, and it's less like a real app.
- **The app holding the session itself.** It could call the API directly, but then two things would sign in, and an app would hold who someone is. The page already does it.
- **A separate worker for push.** The API process already runs, and one loop every 30 seconds is enough for a lab's studies. It can move if a hosted Truman needs it.

## Consequences

- Migration 0052 adds `sessions.push_token`, `push_platform`, and `push_since`, and `pushed_at` on notifications and on content (for messages).
- The API now does work between visits, for participants with push on. With more than one copy of the API running, each could catch up the same world, but claiming means each push is still sent once.
- Expo Go can show the app without any developer account. Push notifications need a real build, which needs the lab's accounts.
- Nothing has run on a real phone yet. The app typechecks and bundles for both platforms, and the API's side is tested.
