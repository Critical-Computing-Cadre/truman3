# 16. Downloading a study's data is limited and recorded

**Status:** Accepted

## Decision

In the app, owners and editors can download a study's data, and viewers can't. Only a team's owner can include recruitment IDs, which link study data to real people.

Each download records who took it, when, and whether it included recruitment IDs. The monitor page shows the latest ones.

The monitor page shows counts only, never a participant's ID.

## Why

A viewer role is often someone like a new student or a collaborator looking at progress, who shouldn't need the data to do that. Recruitment IDs are the most sensitive thing the platform holds, and a team should be able to say who has had them.

## Consequences

- Downloads from the command line aren't limited or recorded, since someone there already has full database access.
- A lab that wants viewers to download needs to make them editors. If that turns out to be common, this rule should change.
