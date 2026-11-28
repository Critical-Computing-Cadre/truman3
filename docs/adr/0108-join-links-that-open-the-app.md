# 108. Join links that open the app

## Context

A participant with the phone app (ADR 66) could join a study in it two ways: a link with the app's own scheme, like `commons://join/bystander`, or pasting their link into the app. A study's ordinary web link, the one Prolific or an email gives them, opened in the browser. So a study meant for the app needed a second kind of link, and a recruiting site that only passes on web links couldn't reach the app at all.

Phones can open a web link in an app, but only when the app and the web address each name the other. An app claiming an address isn't enough, or any app could take any site's links. The address has to serve a small file saying which app is its own: `/.well-known/assetlinks.json` for Android, `/.well-known/apple-app-site-association` for iPhones.

## Decision

- **Only a study's join link opens the app:** a path starting `/join/`. Everything else stays in the browser. A participant who never installed the app is unaffected, and so is one reading the site's terms in a browser.
- **The app claims join links** at its site's address, and at any others in `TRUMAN_LINK_HOSTS` (`apps/mobile/app.config.ts`). Only for an https address. Handed one, it opens that address as it is.
- **A stage names its app** in `infra/lib/stages.ts`, under `app`: Android's app ID and the fingerprints of the keys it's signed with, and Apple's team and app ID. Either half can be left out.
- **The router serves the two files** (`infra/lib/app-router.js`), at every address the stage answers at, from text the stack writes into it when it's built. No bucket, no request to the API.
- **Without the setting, both addresses answer "not found".** They used to get the participant app's page, like any path the router didn't know, which is the wrong answer to a phone asking a yes-or-no question. Anything else under `/.well-known/` is "not found" too.

## Alternatives considered

- **The files in the participant app's build.** A build is the same for every stage and every lab that hosts Truman. What's in these files belongs to one deployment.
- **Served by the API,** from environment variables. It works, but it's a request to a container for a file that never changes between deploys, on a path phones fetch when an app is installed.
- **Every page opens the app.** Then a link to the site's privacy policy would open an app someone installed for a different study. Join links are the one place the app is wanted.
- **Keeping only the app's own scheme.** No setup, but it's a link nothing but the app understands: it does nothing in a browser, and some recruiting sites and mail apps won't make it a link at all.

## Consequences

- Both halves have to be in place, in order: the stage's setting deployed, then a new build of the app installed. Phones check when the app is installed or updated.
- An app in the Play Store is signed again by Google, so its stage needs Google's fingerprint as well as Expo's.
- A participant with the app installed can't open a join link in their browser by tapping it. On both kinds of phone, a long press offers the browser.
- A study that wants everyone in a browser, on a Truman that has an app, has no way to say so yet.
