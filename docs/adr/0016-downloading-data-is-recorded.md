# 16. Downloading a study's data is limited and recorded

**Status:** Accepted

## Decision

In the app, owners and editors can download a study's data, and viewers can't. Only a team's owner can include recruitment IDs, which link study data to real people.

Each download records who took it, when, and whether it included recruitment IDs. The monitor page shows the latest ones.

The monitor page shows counts only, never a participant's ID.

Photos participants uploaded are a separate download, with the same limits and record. It's built as it's sent, so it doesn't hold them all in memory, which the data download does. It comes with `photos.csv`, which ties each file to the participant and post in the data. It holds the photos people have now, so a picture someone replaced isn't in it, and neither is anyone who withdrew. A zip made this way can't pass 4 GB, because the library doesn't write the larger format. That's about 400 of the largest photos, and many more typical ones.

## Why

A viewer role is often someone like a new student or a collaborator looking at progress, who shouldn't need the data to do that. Recruitment IDs are the most sensitive thing the platform holds, and a team should be able to say who has had them.

## Consequences

- Downloads from the command line aren't limited or recorded, since someone there already has full database access.
- A lab that wants viewers to download needs to make them editors. If that turns out to be common, this rule should change.
