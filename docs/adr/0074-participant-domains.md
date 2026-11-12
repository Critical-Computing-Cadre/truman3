# 74. Participant domains

## Context

Participants in a Truman study use what looks like a real social media site. Until now, every study ran at the participant app's single address. On production, that's app.truman-research.org, which tells anyone who looks at the address bar that it's research.

Dominic has neutral domains, such as eatsnap.love, and wants labs to be able to bring their own. The vault note `Hosted Truman design`, section 6, has the plan in two parts:
1. **This Truman's own participant domains,** which any lab's study can use.
2. **A lab's own domain.**

This ADR is the first part, and the groundwork both need.

## Decision

- **Each study has an address.** `studies.participant_domain` is one of the server's `PARTICIPANT_DOMAINS`, the participant app's own host, or empty for the default.
  - **The default** is `PARTICIPANT_DOMAIN_DEFAULT` if the server sets one, or else `PARTICIPANT_APP_URL`. On production it's clikbrite.com, as Dominic chose, so a study is at a neutral address unless its researcher chooses otherwise.
  - A researcher who can edit the study picks it on the Studies page. The picker only shows when the server offers participant domains.
  - The study's link, its pilot links, and the link Prolific sends people to all use it.
  - A domain the server stops offering falls back to the default, so a link never points where the server doesn't answer.
- **A participant domain shows nothing of Truman.**
  - The CloudFront router (`infra/lib/app-router.js`) now also runs on `/api/*`. On a participant domain, it answers 404 for `/admin` and `/api/admin`, so the admin app and the admin API can't be found there. Everything a participant uses passes through as before.
  - The list of participant domains is written into the router when the stack is built.
- **Images load from the page's own address.**
  - `MEDIA_PUBLIC_URL` can be `/`, and the stack sets it so. Study images then link to `/media/...` on whatever domain the page is on, instead of naming app.truman-research.org.
  - Participants' uploads already went through `/api/media`.
- **The stack serves each participant domain** (`participantDomains` in `infra/lib/stages.ts`). Each is a whole domain, with its Route 53 zone in the stage's account. The stack:
  - adds it to the stage's one certificate, checked through its own zone
  - adds it to the distribution's names
  - points an A and an AAAA record at the distribution
  - tells the API and the router about it

  A stage with participant domains needs its own addresses in a zone too, so there's one certificate for everything.
- **Production offers clikbrite.com,** and makes it the default. Its zone is in production's account, made by hand. The domain stays registered in Social Design Lab's account, with its name servers pointing at that zone. Adding another domain is in `docs/guides/deploying.md`.

## Alternatives

- **A subdomain of truman-research.org for each study,** like `eatsnap.truman-research.org`. It's easy, with one certificate, but it still says "research".
- **A separate CloudFront distribution for each domain.** It keeps domains apart, but means many more distributions to deploy and pay for. Adding a domain would also mean a new stack resource.
- **Leaving the admin app reachable on every domain.** It's simpler, but a participant who tried `/admin` would find Truman, and the study's cover with it.
- **Absolute image links to each study's domain.** That's more work for the API, which would have to know which domain a page is on. Linking to the page's own address needs no knowledge at all.

A lab's own domain needs certificates made while the server runs, not when the stack is built. CloudFront's multi-tenant distributions do that, with one tenant for each lab's domain. That's part 2.
