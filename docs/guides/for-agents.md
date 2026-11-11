# Working in Truman, for agents

This is for an AI agent, such as Claude, helping a researcher build and check studies in Truman 3 through its MCP server. It's also a good overview for a person. Read it before using the tools.

## What Truman is

Truman is a social media site that researchers build to run experiments. Participants join a study, are put in a condition, and use a feed that looks and works like a real platform. Everyone else on it is the **cast**: people the study wrote, whose posts, comments, likes, and moderation are scripted, or written by a model within limits. What participants do is recorded for analysis.

## How a study is put together

A study is a **draft** while it's being written, and a **version** once it's saved. Participants only ever get a version, and only once a researcher launches it.

- **Settings** (`study`, `conditions`, `feed`, and `flow` sections):
  - the site's name and look
  - the platform template (`classic`, `forum`, `shortPosts`, `photo`) and which features are on in each condition
  - how long it runs
  - the conditions and how people are assigned to them
  - the steps: consent, pages, the feed, and the exit
- **Items:** the cast (kind `actor`), posts, comments, spaces, and moderation (removals, labels, bans, answers to flags and reports, automatic rules).
  - Each has a time, in hours:minutes from when a participant starts, and can be limited to conditions.
  - What an agent adds is marked as generated, so a methods section can say so.
- **Pages:** files kept as written.
  - `beats.yaml` is what the cast does in response to each participant. See `docs/guides/writing-beats.md`.
  - `scenarios.yaml` holds tests: a made-up participant does things at set times, and the study says what should have happened.
  - `personas.yaml` holds simulated participants a model plays.
  - The consent page and other pages are Markdown.

`docs/architecture.md` and the ADRs in `docs/adr/` explain the rest. The reference studies in `studies/examples` are complete examples:
- `bystander` uses beats
- `flag-source` is about moderation notices
- `vaccine-frames` changes pictures by condition
- `eatsnap` is a classic study

## What you can do

With the researcher's token:
- **Read:** list their studies and packs, and read a draft: everything in it, and the problems found when checking it.
- **Write:** start a study, open a draft, add, change, and remove items, save settings, and write pages. Each is checked as it's saved, and refused with a reason if it isn't valid.
- **Check:** save a version, run its scenario tests, and simulate participants, at random for free, or with personas a model plays within a budget.
- **Follow a running study:** read its Monitor page, which has counts only.
- **Anything else** under `/admin/` in the API, with `call_api`. `/api/openapi.json` on the server lists it all.

## What you can't do

These reach real participants or their data, so they're for the researcher, in the admin app. The server refuses them from a token:
- launching, stopping, or deleting a study
- withdrawing a participant
- downloading data, or participants' photos
- anything to do with Prolific
- approving what the cast says to participants, and Christof's live controls
- making or revoking tokens

**You can recommend them.** When one is the right next step, say so with `recommend_to_researcher`: what to do, why, and where in the admin app. The researcher decides and does it.

## Working well

- **Start from what's there.** Read the draft before changing it, and keep the researcher's choices unless they ask you to change them.
- **Check as you go.** After changes, read the draft's problems. Before calling a study ready, save a version, run its scenario tests, and simulate it. Fix what they find.
- **Write tests for what the study is meant to do,** especially what should happen in one condition and not another.
- **Be careful with what participants will read.** Studies of harassment or misinformation need content that does what the design says and nothing more. Keep to what the researcher asked for, and flag anything you're unsure about for them to look at.
- **Say what you did.** Tell the researcher what you added or changed, what you checked, and what you recommend they do.
- **Images:** use ones already uploaded or in packs. If a study needs one you can't find, say so. Generating images comes later.

## Connecting

1. In the admin app, open **Access for agents** and create a token. Copy it; it's shown once.
2. Add Truman's MCP server to your client, running `node` on `apps/mcp/src/main.ts` in a copy of this repository, with two settings:
   - `TRUMAN_URL`: the server's address, like `https://truman.example.edu`
   - `TRUMAN_TOKEN`: the token

   For Claude Code, from the repository folder:

   ```
   claude mcp add truman --env TRUMAN_URL=https://truman.example.edu --env TRUMAN_TOKEN=truman_pat_... -- node apps/mcp/src/main.ts
   ```

   Run it with `node` directly, not through `pnpm`: `pnpm` prints a line first, which the client would misread.
3. Revoke the token on the same page when you're done with it. Tokens last 90 days.
