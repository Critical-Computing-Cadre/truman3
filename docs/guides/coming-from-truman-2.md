# Coming from Truman 2.0

For a lab that has run studies on Truman or Truman 2.0 ([cornellsocialmedialab/truman_2023](https://github.com/cornellsocialmedialab/truman_2023)), or on a copy of either. It says what's different in Truman 3, how to bring a study's materials over, and what doesn't come over.

Truman 3 is a new codebase. It reads the older versions' study files, and shares none of their code.

## What's different

|                         | Truman and Truman 2.0                                                  | Truman 3                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A study                 | A copy of the repository, with its CSV files, pictures, and `.env`     | A folder of files, or a draft in the builder. No copy of the code                                                                                                               |
| Several studies         | One copy, one server, and one database each                            | Many in one Truman, each owned by a team                                                                                                                                        |
| Changing how it behaves | Edit the code in your copy                                             | Turn features on or off in the study's settings, for everyone or for one condition. A new behavior is a feature added for every study ([Adding a feature](adding-a-feature.md)) |
| Loading content         | `populate.js`, which fills the database                                | `pnpm study import`, or the builder. A saved version is frozen                                                                                                                  |
| Conditions              | Names in `.env`, with `condition` and `class` columns in the CSV files | Named in `study.yaml`, with how participants are assigned. The same columns are read                                                                                            |
| The look                | One, like a photo-sharing site                                         | Six kinds of site. A converted study starts as the photo kind                                                                                                                   |
| Surveys and consent     | A link at the end, from `.env`                                         | Steps in the study's flow, in any order ([Connecting a study to Prolific and a survey](connecting-prolific-and-surveys.md))                                                     |
| Data                    | `data-export.js`, which writes a CSV from each participant's record    | A log of every event, including what was put on screen and for how long, exported as CSV files with a codebook                                                                  |
| Checking before running | By hand                                                                | `pnpm study validate`, scenario tests, and simulated participants ([Testing studies](testing-studies.md))                                                                       |
| Where it runs           | Your own server, with MongoDB                                          | Hosted at [truman-research.org](https://truman-research.org), or your own servers with Postgres and file storage ([Deploying](deploying.md))                                    |

[FEATURES.md](../../FEATURES.md) is the full list of what Truman 3 does.

## Bringing a study over

You need a checkout of Truman 3 that runs ([Getting started](../../README.md#getting-started)) and your old study's folder.

```
pnpm study convert <old Truman folder> <new study folder> <slug>
pnpm study validate <new study folder>
```

The slug is the short name in the study's address, such as `eatsnap` in `/join/eatsnap`.

`convert` reads the old folder and changes nothing in it. It writes:

| In the new folder | From                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actors.csv`      | `input/actors.csv`, as it is                                                                                                                           |
| `posts.csv`       | `input/posts.csv`, as it is                                                                                                                            |
| `comments.csv`    | `input/replies.csv`                                                                                                                                    |
| `reactions.csv`   | `input/notifications (read, like).csv` and `input/notifications (reply).csv`, joined in one file                                                       |
| `media/`          | `post_pictures/` and `profile_pictures/`                                                                                                               |
| `study.yaml`      | Started from `.env.example`: the site's name, the number of days, the names of the conditions, the feed's order, and whether flagged posts are removed |

Then:

1. **Read `study.yaml` and decide each setting.** The values copy how the old version behaved, and each is a design decision of your study. Look hardest at `conditions.assignment`, which is set to equal chances for each condition, and at `entry`, which is set up for Prolific whatever the old study used.
2. **Add what the old study did around the feed.** The converted flow is an account, the feed, and an exit. A consent page, instructions, and survey links are steps you add ([Connecting a study to Prolific and a survey](connecting-prolific-and-surveys.md)).
3. **Run `pnpm study validate` and read its warnings.** It names the file and row. Expect some about timing: a post timed after the study's last day, or too early to be in the feed when someone starts, is never shown.
4. **Try it.** `pnpm study import <folder>`, `pnpm study launch <slug>`, and open `/join/<slug>`. [Testing studies](testing-studies.md) has more.

[`studies/examples/eatsnap`](../../studies/examples/eatsnap) is Truman 2.0's own example study, converted, with consent and community rules pages added.

## What doesn't come over

- **Participants' data.** Nothing reads an old study's MongoDB database. Keep it, and its exports, as that study's record.
- **Changes to the code.** If your copy added a button, a page, or a rule, look for it in [FEATURES.md](../../FEATURES.md) first. Some things labs added to their own copies are recorded for every study now, such as how long each post was on screen. If it isn't there, [Adding a feature](adding-a-feature.md) says how one is added.
- **The site's pictures and wording.** The logo, the home page picture, and any pages you rewrote. A study's own pages go in its `pages` folder.
- **The survey link** in `.env`. A survey is a step in the study's flow.
- **Truman Agents scenarios.** Its agents, levels, objectives, and grader aren't converted. Truman 3's cast can react to what a participant does, and a language model can write their lines ([Writing beats](writing-beats.md)), but a scenario has to be written again in that form.

## Running an old study again

A converted study is a new study that uses the old one's materials. It isn't the old software, and it won't behave the same in every detail: the feed, the timing of the cast's reactions, and what's recorded are all Truman 3's. To add to data you've already collected under the same conditions, keep running the version that collected it.
