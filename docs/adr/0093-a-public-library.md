# 93. A study in the library can be public, if its lab says so

## Context

The library (ADR 92) is for researchers signed in to one Truman. That was the first step on purpose: a public page means anything published, pictures and consent wording included, can be read by anyone. Dominic decided on 2026-11-17 that it can be public, if the lab that published it allows it.

Open science is the reason. A study someone can find from a search, read about, and download without asking for an account is one that gets rerun.

## Decision

- **Each study in the library is public or not, and its lab decides.** Publishing has a box, "Let anyone see it and download it, without an account", off unless ticked. The lab can change it later on the Library page.
- **Only listed studies are public.** On a hosted Truman, a study waiting for an operator isn't, whatever its lab chose. An operator lists studies and can take them down, but can't make a lab's study public.
- **A public page on the site, truman-research.org/library,** lists them: what each tests, its lab, kind of site, conditions, size, license, paper, and a few pictures, with a link to download its bundle.
- **The page reads the list from the app when it opens,** from `GET /api/admin/public/library`, so a study shows the moment it's public and goes the moment it isn't. That route says any site may read it.
- **The bundle downloads from `GET /api/admin/public/library/{id}/bundle`,** streamed from storage.
- **Neither route needs an account, and neither gives out more than the lab chose to.** No email, nobody's name but the lab's, and nothing about who's asking. The test that tries every admin route without an account lists these two as open, and checks every other one is refused.
- **Agents can't make a study public.**

## Alternatives considered

- **Building the list into the site** when the site is deployed. No calls to the app, and it works if the app is down. But a study made public, or taken back, wouldn't change until the next deploy, which can be days. Taking a study back has to work at once.
- **Every listed study public.** Simpler. But a lab may want to share with other labs and not with the world, for instance while a paper is under review.
- **Public by default.** It would make the library fill faster. But it's the lab's work and its participants' consent wording, and that's the lab's call to make, not one to undo.
- **A separate address for public routes,** away from `/api/admin`. Cleaner to read. These live beside the library's other routes, which keeps them in one place with one set of tests, and the route test checks they're the only open ones.

## Consequences

- **What's public is readable by anyone, and can be copied by anyone.** Taking it back stops new downloads. It can't take back the ones already made.
- **A lab's consent wording is public with it,** inside the bundle. The publish window says the consent text goes with the study.
- **The public page needs the app to be up** to show anything. When it isn't, it says so.
- **Anyone can download a public bundle as often as they like.** Each is a few megabytes, served from storage. If one becomes popular, it's worth putting behind CloudFront's cache.
- **Only hosted Truman's library is shown on truman-research.org.** Someone running their own Truman has the same two routes, for a page of their own.
