# Changelog

What's changed in Truman 3, newest first. Each release's notes are also on [GitHub Releases](https://github.com/Critical-Computing-Cadre/truman3/releases). What Truman 3 does today, in full, is in [FEATURES.md](FEATURES.md).

## Unreleased: the first tagged release

Everything since the repository started on 2026-11-01. Truman 3 is a new codebase, so there's nothing to upgrade from.

### Kinds of site

- Six templates: Classic, Forum, Short posts, Photo, Short video, and Video platform, each with sample content and a light and a dark look.
- About 60 features a study turns on or off, for everyone or for one condition.
- Video on posts, with watching records, pre-roll ads, and captions.

### Building and designing a study

- A builder in the browser, where posts are edited in the feed, with several researchers in one draft.
- Studies as folders of files, with checks that say what to fix.
- Conditions, study time that's each participant's own, studies that last days, decision points for adaptive designs, and questions in the feed.
- Content packs, examples to start from, and a draft written from a brief.

### A cast that acts

- Beats: the cast does something when time passes, a participant acts, or a video has been watched.
- Live writing by a language model, with a check on every line, fallback lines, budgets, a pause switch, rehearsed lines, and approval for Wizard of Oz studies.
- A community written by a model: drafted ahead for a researcher to read, or written while the study runs, for a condition or for each participant.
- Persona cards, edited as a form.

### Moderation, and shared worlds

- Removals, warnings, a moderation log, labels, bans, automatic rules, holds, and appeals, as things a study scripts.
- Several real participants in one world, with live updates and a load test.

### Recruiting, running, and data

- Prolific, with reminders and bonuses. CloudResearch Connect, SONA, and any panel that uses links.
- A monitor page, pilot runs kept apart, and withdrawal that deletes a participant's data.
- An append-only event log of what was shown and what was done, exported as CSV with a codebook.
- Scenario tests, simulated participants, and personas a model plays.

### Sharing

- Replication bundles, a library of studies, and a public library.
- Reference studies in the repository, with demos on the public site.

### Hosting and security

- Hosted Truman: labs apply and are approved, with limits, a key for each lab, and each lab's own Claude key.
- Participants' photos served only to people in their world, and scanned before they're stored.
- A security contact, policy, and `security.txt`.
- Deploys from GitHub: staging on every merge, production on a person's approval.

### For developers and agents

- An HTTP API described with OpenAPI, access tokens, an MCP server, and a command line.
- 103 decision records in `docs/adr`.
