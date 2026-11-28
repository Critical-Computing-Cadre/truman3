# What Truman 3 does

An inventory of what's in this repository, as of **2026-11-25**. Each line comes from the code, the decision records in [`docs/adr`](docs/adr), and merged pull requests. Nothing here is planned work described as done.

**Status** says where it runs today:

- **Production**: on hosted Truman at [truman-research.org](https://truman-research.org), which is in beta.
- **Staging**: merged, tested, and running on the staging servers, waiting for a person to approve it for production (ADR 88).
- **Built, not released**: in the repository and tested, but not yet available to the people it's for.

Everything marked Production or Staging also runs on a Truman you host yourself. The numbers in the last column are decision records: ADR 26 is [`docs/adr/0026-spaces-and-several-feeds.md`](docs/adr/0026-spaces-and-several-feeds.md).

## Contents

- [Kinds of site](#kinds-of-site)
- [What a site can have](#what-a-site-can-have)
- [Building a study](#building-a-study)
- [Study design](#study-design)
- [A cast that acts](#a-cast-that-acts)
- [AI in a study](#ai-in-a-study)
- [Moderation as study material](#moderation-as-study-material)
- [Several participants in one world](#several-participants-in-one-world)
- [Recruiting and running](#recruiting-and-running)
- [Data](#data)
- [Testing a study before it runs](#testing-a-study-before-it-runs)
- [Sharing and replication](#sharing-and-replication)
- [Participants' privacy and safety](#participants-privacy-and-safety)
- [Hosted Truman](#hosted-truman)
- [For agents and developers](#for-agents-and-developers)
- [The phone app](#the-phone-app)
- [How it's built and run](#how-its-built-and-run)

## Kinds of site

A study picks a template: a look, a page layout, and a starting set of features. Each looks like a kind of platform without copying a real one, and each comes with sample content to start from (ADR 50, 81).

| Template       | What it's like                                                          | Status     | ADR        |
| -------------- | ----------------------------------------------------------------------- | ---------- | ---------- |
| Classic        | A community feed of posts on cards, with likes and comments             | Production | 18, 28     |
| Forum          | Communities, titled posts, votes, and threaded replies                  | Production | 27, 29, 30 |
| Short posts    | Short text posts, reposts, quotes, hashtags, and what's trending        | Production | 37, 38     |
| Photo          | A photo feed with stories, places, tags, and an explore page            | Production | 39, 41     |
| Short video    | One video fills the screen and plays by itself. Swipe for the next      | Production | 95         |
| Video platform | A grid of videos, a watch page with Up next, channels, and pre-roll ads | Production | 96, 97     |

Each template has a light and a dark look (ADR 40, 76), and works on phones and computers.

## What a site can have

A platform is built from features that a study turns on or off, for everyone or for one condition (ADR 18). There are 60 today. They include:

| Feature                                                                     | Status     | ADR            |
| --------------------------------------------------------------------------- | ---------- | -------------- |
| Posts with text, pictures, links, and several attachments                   | Production | 24             |
| Comments and replies, as a tree that can show flat                          | Production | 20             |
| Likes, and votes up and down beside them                                    | Production | 22             |
| Spaces (communities), and several feeds: home, following, and a space's own | Production | 26             |
| Polls, flair, and crossposting                                              | Production | 30             |
| Reposts, quotes, hashtags, trending, and labeled ads in the feed            | Production | 37, 38         |
| Context notes and labels on posts, such as a misinformation label           | Production | 38, 46         |
| Stories, highlights, close friends, places, and tagging                     | Production | 39, 41, 42, 47 |
| Profiles with headers, banners, follower counts, and a replies tab          | Production | 43, 49         |
| Following, muting a thread, blocking, and reporting                         | Production | 34, 43         |
| Direct messages between a participant and the cast                          | Production | 61             |
| Notifications                                                               | Production | 18             |
| An "are you sure?" prompt before posting, set off by rules a study writes   | Production | 36, 42         |
| Video on posts: H.264, up to 10 minutes and 200 MB, with a poster           | Production | 94             |
| Pre-roll ads on videos: how often, when they can be skipped, and which ads  | Production | 97             |
| Captions on videos, as WebVTT files                                         | Staging    | 101            |
| Captions on pre-roll ads                                                    | Staging    | 101            |

## Building a study

| Feature                                                                              | Status     | ADR    |
| ------------------------------------------------------------------------------------ | ---------- | ------ |
| A study is data, not code: files in a folder, or a draft in the builder              | Production | 5, 10  |
| A builder in the browser, where posts are edited in the feed they'll appear in       | Production | 12, 14 |
| Several researchers editing one draft, with who else is there shown                  | Production | 12     |
| Saving a version freezes it. Launching is a separate step                            | Production | 13     |
| Choosing a template and its features on one page                                     | Production | 44     |
| Posts, comments, and the cast from spreadsheets                                      | Production | 45, 48 |
| Content packs: reusable sets of posts and cast, copied into a study                  | Production | 15, 62 |
| A cast page for the people participants see, with a picture for each condition       | Production | 11     |
| Persona cards as a form on the cast page                                             | Staging    | 52     |
| Consent, instructions, survey links, and debriefing as steps in a flow               | Production | 9      |
| A preview of the study as a participant in any condition, at any point in study time | Production | —      |
| Teams own studies, with owners, editors, and viewers                                 | Production | 11     |
| Archiving a study, and deleting one that never had real participants                 | Production | 58     |
| Examples to start from when making a study                                           | Production | 81     |

## Study design

| Feature                                                                                      | Status     | ADR    |
| -------------------------------------------------------------------------------------------- | ---------- | ------ |
| Conditions with blocked random assignment, weights, and labels for multi-factor designs      | Production | 10     |
| Anything can differ by condition: posts, the cast, features, feed order, and the look        | Production | 10, 18 |
| Study time that's each participant's own, so content appears at set points after they arrive | Production | 5      |
| Studies that last days, with reminders to come back                                          | Production | 90     |
| Decision points for adaptive designs, where what someone does decides their next condition   | Production | 55     |
| Questions in the feed, asked at a moment a study chooses                                     | Production | 89     |
| Feed ranking a study sets, kept fast under load                                              | Production | 69     |

## A cast that acts

The people in a simulated site are a cast the research team writes. They can do more than appear in posts.

| Feature                                                                                           | Status     | ADR     |
| ------------------------------------------------------------------------------------------------- | ---------- | ------- |
| Scripted reactions: the cast likes, replies to, or follows what a participant posts               | Production | 5       |
| Beats: "when this happens, someone in the cast does that", decided by a director                  | Production | 51      |
| Beats that wait for time, for what a participant does, or for how much of a video they've watched | Production | 51, 100 |
| Beats that moderate: remove, label, warn, or ban                                                  | Production | 62      |
| A decision trace for every beat: what set it off, whether it happened, and why not                | Production | 51      |

## AI in a study

All of this is off unless a study turns it on. A lab uses its own Claude key, or the host's within a starter budget (ADR 71).

| Feature                                                                                                                         | Status     | ADR |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------- | --- |
| Live writing: a model writes a cast member's line from a persona card, with a second call checking every line                   | Production | 52  |
| A fallback line for every improvised beat, a budget for each study, and a pause switch                                          | Production | 52  |
| Rehearsed lines: a model drafts lines ahead, a researcher edits them, and they're frozen with the version                       | Production | 54  |
| Approval before posting, for Wizard of Oz studies: a researcher approves, changes, or skips a line                              | Production | 53  |
| A community drafted ahead: a model writes days of posts and replies by the cast, for a researcher to read and change            | Production | 99  |
| A live community: written while the study runs, a day ahead, the same for everyone in a condition, optionally held for approval | Staging    | 102 |
| A community of each participant's own, where the cast can answer what they post, with a cost cap for each participant           | Staging    | 103 |
| Drafting a whole study from a written brief                                                                                     | Production | 65  |
| Personas: a model plays participants through a study, to read how it feels before paying real people                            | Production | 60  |
| Every generated line recorded with its prompt, model, check, and cost                                                           | Production | 52  |

The community features and live writing haven't yet been used in a study with real participants.

## Moderation as study material

A moderator's decisions are things a study scripts and varies by condition, so moderation itself can be studied.

| Feature                                              | Status     | ADR |
| ---------------------------------------------------- | ---------- | --- |
| A post removed by a moderator, with the reason shown | Production | 31  |
| Warnings, and a public moderation log                | Production | 32  |
| Writing moderation in the builder                    | Production | 33  |
| Answers to what a participant flags or reports       | Production | 34  |
| Bans that happen to members of the cast              | Production | 35  |
| Automatic rules, posts held for review, and appeals  | Production | 36  |

## Several participants in one world

| Feature                                                                                       | Status     | ADR |
| --------------------------------------------------------------------------------------------- | ---------- | --- |
| Shared worlds: several real participants in one site, who see each other's posts              | Production | 67  |
| Live updates between them, a researcher removing things as they happen, and a load test       | Production | 68  |
| Withdrawing from a shared world: what someone wrote is wiped, and others' records stay intact | Production | 67  |

## Recruiting and running

| Feature                                                                                       | Status     | ADR  |
| --------------------------------------------------------------------------------------------- | ---------- | ---- |
| Entry links that carry a recruitment ID, and exit links back to a survey or panel             | Production | 9    |
| Prolific: connect with each researcher's own token, see submissions, approve, and pay bonuses | Production | 17   |
| Reminders through Prolific's messages                                                         | Production | 90   |
| Recruiting through CloudResearch Connect, SONA, or any panel that uses links                  | Production | 98   |
| A monitor page: who's in, where they are, and what the cast has done                          | Production | —    |
| Pilot runs kept apart from real data                                                          | Production | 13   |
| Withdrawing a participant, which deletes their data and records that it happened              | Production | 6, 9 |

## Data

| Feature                                                                                                     | Status     | ADR    |
| ----------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| An append-only event log: 63 kinds of event, each with a schema, written through one function               | Production | 6      |
| What was shown as well as what was done: every post put on someone's screen, and for how long               | Production | 6      |
| Watching records for videos and ads: time played, how far, pauses, sound, and captions                      | Production | 94, 97 |
| Export as CSV files with a codebook that describes every column                                             | Production | 16     |
| Every download of data recorded: who, when, and what                                                        | Production | 16     |
| Provenance on content: whether a file, a researcher, a pack, or a model wrote it, and whether it was edited | Production | 12, 99 |
| Synthetic data from simulated participants, for writing analysis code before a study runs                   | Production | 59, 60 |

## Testing a study before it runs

| Feature                                                                                     | Status     | ADR    |
| ------------------------------------------------------------------------------------------- | ---------- | ------ |
| Checks on a study's files and settings, with messages that say what to fix                  | Production | 10     |
| Scenario tests: "a participant does this, then that should happen", with a clock under test | Production | 56, 57 |
| Simulated participants sent through a study at random, with a report                        | Production | 59     |
| A warning before launching a version whose tests haven't passed                             | Production | 57     |

## Sharing and replication

| Feature                                                                                    | Status     | ADR |
| ------------------------------------------------------------------------------------------ | ---------- | --- |
| A replication bundle: a saved version as files another lab can load and run                | Production | 91  |
| A library of studies within a hosted Truman                                                | Production | 92  |
| A public library, readable without an account, for studies whose creators allow it         | Production | 93  |
| Five example studies in the repository, four of them reference studies with scenario tests | Production | 63  |
| Demos of the reference studies that anyone can try from the public site                    | Production | 78  |

## Participants' privacy and safety

| Feature                                                                                      | Status     | ADR    |
| -------------------------------------------------------------------------------------------- | ---------- | ------ |
| Participants' photos go through the API, and only people in their study's world can see them | Production | 25     |
| Photos scanned before they're stored, and a limit on how many a participant can upload       | Production | 79, 80 |
| A key for each lab on hosted Truman: recruitment IDs and photos are sealed with it           | Production | 82     |
| Emergency access by the host is possible, recorded, and told to the lab                      | Production | 83     |
| The API has its own database login that owns nothing, with rules the database enforces       | Production | 21     |
| Rate limits on researchers' sign-in and on participants entering a study                     | Production | 21     |
| A security contact, a policy, and `/.well-known/security.txt`                                | Production | 84     |

## Hosted Truman

| Feature                                                                                                         | Status     | ADR         |
| --------------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| Labs apply, and an operator approves them                                                                       | Production | 70          |
| Limits for each lab: participants a month, studies running at once, AI spending, and room for photos and videos | Production | 70, 80, 100 |
| Each lab's own Claude key, or the host's within a starter budget                                                | Production | 71          |
| Email to researchers: invitations and password resets                                                           | Production | 72          |
| Participant domains, so a study's address doesn't say "research"                                                | Production | 74          |
| A public site with a guide for researchers and docs for developers                                              | Production | 75          |
| A support address, and alarms that come from outside the service                                                | Production | 87          |

## For agents and developers

| Feature                                                                                         | Status     | ADR    |
| ----------------------------------------------------------------------------------------------- | ---------- | ------ |
| An HTTP API described with OpenAPI, which is the only path that changes study state             | Production | 3      |
| Access tokens for a researcher's own tools and agents, limited in what they can reach           | Production | 64     |
| An MCP server, so an AI agent can build, test, and monitor a study                              | Production | 64     |
| A command line: validate, test, simulate, import, launch, convert, export, bundle, and withdraw | Production | 5      |
| Run your own with Docker, or on AWS from the CDK code in `infra`                                | Production | 19, 23 |

## The phone app

| Feature                                                                       | Status              | ADR |
| ----------------------------------------------------------------------------- | ------------------- | --- |
| An app for participants that wraps the study site and adds push notifications | Built, not released | 66  |

It isn't in the App Store or on Google Play yet. Until it is, participants use a study in a phone's browser, where every kind of site works.

## How it's built and run

| Practice                                                                                      | Where                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| TypeScript throughout, in one repository of apps and packages                                 | ADR 1                                                  |
| Every pull request runs checks, type checks, unit tests, integration tests, and browser tests | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) |
| The API's container is built and proved to work in CI                                         | `pnpm check:container`                                 |
| A merge deploys to staging. Production waits for a person's approval                          | ADR 88                                                 |
| Deploys that would widen access are refused in CI and need a person at a terminal             | ADR 88                                                 |
| Database changes only add things, so the old version keeps running while a deploy finishes    | ADR 86                                                 |
| Backups, and a documented check that a restore works                                          | [`docs/guides/restoring.md`](docs/guides/restoring.md) |
| A decision record for every choice someone might later question: 103 so far                   | [`docs/adr`](docs/adr)                                 |

## Not built

So that nobody goes looking: there's no live-stream kind of site, no built-in questionnaires (studies link out to a survey tool), and nothing that moves an older Truman's participants or code changes over. `pnpm study convert` starts a study from an older Truman's files ([Coming from Truman 2.0](docs/guides/coming-from-truman-2.md)).
