# 99. A community drafted ahead

## Context

Dominic picked a whole AI-played community on 2026-11-17: a cast that posts and replies to each other over days, without every line being scripted. It builds on Truman Agents, by Qian Yang and the Cornell DesignAI Group, and that credit goes with it. The design note ("AI-played community design", 2026-11-24) set out three ways to do it:

- **A:** drafted ahead and frozen, after a researcher reads it.
- **B:** live, with one shared world per condition.
- **C:** live, and different for every participant.

Dominic chose A first, with B and C later as options a research team can choose. He also answered:

- A community can be the same for every condition or different in each, as the study design needs.
- The cast reacting to participants' own posts stays with beats for now, and should become an option.
- Whether to tell participants that AI wrote content is the research team's decision, not the platform's.

Truman Agents (github.com/Cornell-Design-AI-Group/TrumanAgents) gives each agent a behavior prompt, a role, and traits such as visit frequency, and calls a model for direct messages. It doesn't generate a community, so this is built from Truman 3's own pieces: persona cards and checks (ADR 52) and rehearsing (ADR 54).

## Decision

- **A Community page in the builder.** The researcher describes:
  - what the community is and what it's like
  - topics, most common first
  - posts a day, and the most replies a post gets
  - days before participants arrive, and days while they're there
  - who in the cast takes part
  - what must never be said
  - for more than one condition: the same community in all, or a different one in each, with what's different
- **A model writes it a day at a time,** in the background, each day told what came before, so the community carries on. One call writes the day as structured posts and replies, and a second checks every line in one go. A line that fails is left out, with the replies that answered it.
- **What it writes are ordinary draft posts and comments.** Their provenance is `generated`, with the run and model, so the data says so, as for the agent (ADR 65). The researcher reads, changes, or deletes them on the Feed page. Saving a version freezes them like anything else.
- **Each person's persona card** in `beats.yaml` shapes how they write. Each person's bio is used for everyone.
- **A run is recorded** in `community_runs`, with what was asked, how far it got, and what it cost. The page shows its progress every two seconds. **Take out what this wrote** removes every post and reply from one run, and nothing else.
- **It uses the study's model** (`live.model`), and is paid for like rehearsing: the lab's key, or the host's within the starter budget (ADR 71), recorded in `ai_spending` as `community` and `check`. Without a model, the page says why before starting.
- **Times:** the days before arrival are before the start, so they're the history a participant finds. The days while they're there appear as the study runs.

## Alternatives considered

- **B or C first.** They make the community react, which is closer to a real site. But two participants in a condition would see different worlds, which weakens the comparison a study is making, and a model would write to real people unread. A keeps both, and is what most studies can use today.
- **One call for the whole community.** Fewer calls. But a long community in one answer loses track of what came before, and fails all at once. A day at a time carries on, and shows progress.
- **Checking each line in its own call,** as live writing does. Forty calls a day. One call for a day's lines checks the same limits, and anything it can't decide on counts as a no.
- **A separate kind of content for community posts.** It would keep them apart. But they need everything posts have, in every kind of site, and provenance already marks them.
- **Requiring the consent or debrief to mention AI.** Dominic decided that's the research team's choice.

## Consequences

- **Nothing reacts to the participant except beats.** B, C, and the cast replying to a participant's own posts are for later, each as something a study can turn on.
- **It hasn't been tried with a real model in development,** only with the stand-in. The first real run will show how well a day follows the brief.
- **Cost grows with days and conditions,** not with participants. A different community for each of three conditions costs three times as much.
- **Persona cards live in `beats.yaml`,** so a researcher who wants to shape each voice writes them there. A form for them on the Cast page would make that easier.
