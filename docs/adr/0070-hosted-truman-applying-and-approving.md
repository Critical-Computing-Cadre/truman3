# 70. A hosted Truman: applying, approving, and limits

## Context

Labs should be able to run studies on a Truman someone else hosts, without deploying their own, the way WordPress.com hosts WordPress. The vault note `Hosted Truman design` lays out what that takes. Dominic chose:
- labs apply, and he approves each one
- free for now, with limits he can change for any lab
- he never sees what's in a lab's studies

This is the first of several parts. It covers applying, approving, the operator's page, and limits. Each lab's own Claude key, email, the production stage, encrypting each lab's data, and scanning photos come next.

## Decision

- **One codebase, two editions.**
  - `HOSTED=true` turns on applying. Without it, Truman works as before: teams are made on the server with `pnpm admin setup`.
  - A team's status and limits still apply either way, but a team made on the server is approved and has no limits.
- **A lab applies from the sign-in page** (`POST /admin/apply`):
  - It gives its name, institution, an optional web page, and what it wants to study, and the applicant chooses a password.
  - That makes a `pending` team, with the applicant as its owner, and signs them in.
  - An email that already has an account is refused, and they're told to sign in instead.
  - Attempts are rate limited, like signing in.
- **A pending lab can build, preview, and test, but not launch.** Waiting for approval is also a sandbox to try Truman in. Launching tells them why it can't.
- **Operators run the Truman.**
  - `researchers.operator` is set with `pnpm admin operator <email>`, on the server, never from the app.
  - An operator sees a **Labs** page (`/admin/operator/teams`). It lists every team, those waiting first, with:
    - its application
    - its owners' names and emails
    - counts: members, studies, studies open, participants, and participants in the last 30 days
  - It never shows a study's content or a participant's data.
  - Tokens can't use it, since agents don't run the server.
- **Approving a lab gives it the starting limits** (`HOSTED_STARTING_LIMITS` in `packages/core`): 1,000 new participants in any 30 days, and 10 studies open at once. An operator can change either for any lab, or clear one for no limit.
- **Limits are checked where they bite:**
  - **Launching** checks the team is approved and below its studies open at once.
  - **Entering** checks the team is approved and below its participants for the last 30 days. Someone already in a study can always come back.
  - Test participants don't count.
- **Suspending stops a lab's studies at once.**
  - Its participants' sessions stop working, since `loadParticipantContext` won't find them.
  - Nobody new can enter, and the lab can't launch.
  - Its researchers can still sign in, and export their data.
  - Reinstating brings it all back.

## Alternatives

- **Invitation only.** It's simpler, but Dominic wants labs he doesn't know to be able to ask.
- **Approving before a lab can do anything.** It's safer, but a lab would wait days to see whether Truman fits. Building without launching risks nothing, since no participant can reach a study.
- **Limits in settings, not in the database.** Then one setting would apply to every lab, but Dominic wants to raise them for a lab that needs more.
- **A separate operator app.** It would be more apart from the researcher's admin app, but it would be more to build and run. An operator page that only shows counts is enough for now.
- **Limiting storage for photos now.** Truman doesn't yet record how much each team stores. That comes with scanning photos, which decides whether participants' uploads are on in a hosted Truman at all.
