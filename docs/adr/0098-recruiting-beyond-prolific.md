# 98. Recruiting beyond Prolific

## Context

Truman's Prolific page makes the study on Prolific through its API, with the right link and completion codes, and lets a researcher review, approve, and pay people. Dominic picked recruitment beyond Prolific on 2026-11-17, CloudResearch especially.

Every platform needs the same three things from a study: the link to give out, the name of the ID it adds to that link, and where people go when they finish. A study already has all three in its settings: `entry.idParam`, `entry.source`, and the exit step's `redirect`, which can include `{externalId}`. What was missing was knowing what each platform wants, and checking the study has it.

## Decision

- **One Recruit button beside Launch,** which opens a page to choose where you're recruiting: Prolific, CloudResearch Connect, SONA, or somewhere else. Prolific goes on to its own page, as before.
- **For the others, the page shows the link to paste,** the completion address to paste back, and a check of what the study does now:
  - **CloudResearch Connect** adds `participantId` (and `assignmentId` and `projectId`) to the link by itself, and gives a completion redirect when a project is set up. The study reads `participantId`, calls it "CloudResearch ID", and records it as `cloudresearch`.
  - **SONA** puts each person's code where the study's URL says `%SURVEY_CODE%`, and its client-side completion URL ends in `survey_code=XXXX`. The study reads `id`, and Truman replaces `XXXX` with `{externalId}`, so SONA can grant the right person credit.
  - **Somewhere else:** the researcher chooses the ID's name, what it's called, and how it's recorded, and pastes the completion address, with `{externalId}` where the ID goes.
- **A study's link, ID, and exit are part of its version,** so changing them is a change to the study. **Make these changes in a draft** opens a draft of the version people get, with the entry and exit changed, on its Settings page, to save and launch as usual.
- **A route, `GET /admin/studies/{studyId}/recruiting`,** gives the page the version people get (the live one, or else the newest), its link on the study's own address, its entry, and its exit.

## Alternatives considered

- **Connecting to CloudResearch's API,** as Truman does with Prolific's. I found no public API for creating projects or approving people on Connect. If one appears, it can follow the Prolific page's pattern.
- **Changing the live version directly.** Quicker. But a version is frozen so what participants got can be known, and a study's link and exit are part of that.
- **A field for each platform's completion code,** shown at the end. Codes are what people type in by hand, and get wrong. A redirect sends them back without anything to type, which Connect and SONA both support.
- **Only a generic page.** It covers every platform. But the details of each (Connect's parameter name, SONA's `XXXX`) are exactly what researchers get wrong, so the two most asked for have their own.

## Consequences

- **Truman can't approve or pay people on these platforms.** Researchers match `recruitment_ids.csv` to the platform's list, as before.
- **Connect lets a project rename its parameters.** A project that does needs "Somewhere else", with the new name.
- **Only the ID Truman reads is kept.** Connect's `assignmentId` and `projectId` are in the link, and aren't recorded.
- **The page's details for each platform are from their help pages and other researchers' reports,** not from running a study on them. They're worth checking with a test participant before a real study.
