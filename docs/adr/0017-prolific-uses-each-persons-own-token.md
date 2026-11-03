# 17. Prolific uses each person's own token, and Truman doesn't publish

**Status:** Accepted

## Decision

Each researcher connects their own Prolific API token. Everything done with Prolific from Truman happens as that person, so **Prolific decides what they're allowed to do.** Truman's roles add one limit: viewers can't reach any of it, because submissions show Prolific IDs.

Truman creates unpublished drafts, but never publishes a study. People publish on Prolific.

Only the Prolific study's ID, its completion codes, and the approval rules are stored. Submissions are fetched when the page opens, and matched against the recruitment IDs Truman already holds.

Approving and paying bonuses each ask for confirmation, and each action records who did it. Paying a bonus is claimed in the database before calling Prolific, so it can't be sent twice from here.

Rules, such as a minimum number of posts seen, never reject anyone. Someone who doesn't meet them gets looked at by a person. Rejecting stays on Prolific.

## Why

Dominic's answer (2026-11-02): whoever has access to a project on Prolific should have the same access in Truman, and other labs set this up differently. Prolific's tokens have full access to an account and no expiry date. A shared team token would hand one person's full access to everyone on the team, while personal tokens mean we don't have to copy Prolific's permissions, or keep them up to date.

Publishing spends real money on real people. Leaving it on Prolific costs one click, and removes the most expensive mistake this code could make.

Prolific warns that repeating a bonus payment pays people again. If a payment fails in a way that might have reached them, it stays claimed, and the researcher is told to check Prolific.

Storing less means withdrawal has nothing more to delete, and nothing can drift out of date.

## Consequences

- Each researcher has to create a token. Tokens are encrypted with `TRUMAN_SECRET_KEY`, which has to be kept safe. Changing it means everyone connects again.
- A token reaches everything on that person's Prolific account, so a compromised server with its key could use all of them. This is worth revisiting before a hosted version holds many labs' tokens, for instance if Prolific adds narrower tokens.
- Someone who withdrew or declined still appears on Prolific, with no match here. The page says so plainly, and approving them is the researcher's call.
- Automatic approval only works when Truman sends people to Prolific. With a survey in between, Truman can't choose their code, so that study approves from this page.
- Reading submissions needs the Prolific API on each page load, so the page depends on Prolific being up.
- CloudResearch could follow. It would add a second client in `packages/recruit`, and that's the time to work out what the two share.
