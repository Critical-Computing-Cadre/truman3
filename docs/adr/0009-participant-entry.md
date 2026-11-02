# 9. Participants enter with a recruitment ID and create an account in the study

**Status:** Accepted, for now. Expected to be revisited.

## Decision

A participant enters with their recruitment ID, such as a Prolific ID, either from the study link or typed into a form. There is no password and no email address. New participants then go through an account creation step inside the study, choosing a username and profile. To return, they use the same link or enter the same ID.

A participant who finishes a study, or withdraws from it, can never enter that study again. Withdrawing leaves behind only a per-study hash of the recruitment ID, so the same person can still take part in a different study.

## Why

Older Truman versions used email and password. Email supported daily reminders for multi-day studies, and it supported the cover story: messages looked like they came from the startup behind the app. But many IRBs don't allow collecting email addresses, and recruitment platforms may not either.

Without email there's no way to reset a forgotten password, so a password would lock people out of multi-day studies. A recruitment ID is something participants can always look up.

The account creation step keeps the feel of signing up for a real app, which the cover story depends on.

## Alternatives

- **Email and password:** see above. It could come back as an optional module where a study's IRB allows it.
- **A personal return link:** easy to build, but hard for a participant to save and easy to lose.
- **ID and password:** forgetting the password has no recovery path without email.
- **OAuth (Google and so on):** this has the same personal data problems as email.

## Costs

The recruitment ID is the only credential, so anyone who knows a participant's ID can enter as them. These IDs aren't public, but they aren't secret either. It's a reasonable trade-off for a low-risk, anonymous study. It isn't suitable for a study collecting sensitive disclosures. Such a study would need a stronger option first.

Someone who declines consent is treated like a withdrawal: their data is deleted, and that ID can't enter the study again. Ideally this never happens, because people who don't consent shouldn't have reached the study at all.

Attempts to enter are rate limited per address, to slow down guessing. The limit is generous, since a campus network can put many participants behind one address.

## Related

Participant-facing screens should never reveal that this is a research platform unless the study says so, since that would break a cover story. Site name and branding come from the study definition.
