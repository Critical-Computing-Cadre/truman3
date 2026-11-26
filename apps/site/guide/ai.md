---

title: AI in Truman
description: An overview of every place an AI model is involved in Truman, from cast members who write their own lines to agents that draft a study, and whose Claude key pays for each.
---

# AI in Truman

You can build and run a whole Truman study without an AI model. Every post can be written by you ahead of time, and scenario tests and random simulated participants never call one.

AI is there when you want it, in three places: the cast can write some of its own lines, a model can play participants to pilot your study, and an agent can help you build it. The model is Claude, made by Anthropic. This page is the map of how those pieces fit together, and each section links to the page that has the details.

One rule holds across all of them. A model never decides what your study does, and it never does anything that reaches real participants without a limit you set. You script what happens, and you launch the study.

## In the cast

A beat normally has fixed text. You can give the model more room one step at a time, and stop at whichever step suits your study.

**Rehearsed lines.** A beat can carry a few lines you've read ahead of time, and each participant's world gets one of them. You can write these yourself or press **Rehearse** on the **Beats** page to have the model draft five. With live writing off, no model runs during the study.

**Live writing.** With live writing on, the model can pick the rehearsed line that fits what the participant said, or write a new line in the character's voice. The beat still decides who speaks and when, and the model only fills in the wording. Each study has its own budget, and you can pause live writing for the whole study or for one cast member while it runs.

**Checks on every line.** A line the model writes is read by a second model call before it's posted. The check blocks slurs, sexual content, threats, real people's information, dangerous instructions, and a line that says it's an AI or a study. It also blocks anything on your study's list of red lines or the character's own. If a line is stopped, or the model can't be reached, the participant gets a rehearsed line or the beat's fallback, and the reason is recorded.

**Approval before posting.** For a Wizard of Oz study, a beat can wait for a researcher. You see the suggested line on the **Monitor and download** page and approve it, change it, or skip it. This also works with live writing off, so a person can write every line by hand.

All four are covered in [A cast that writes for itself](/guide/live-writing). What to tell your ethics board about machine-written content is in [Ethics](/guide/ethics).

## A whole community, drafted ahead

The cast can talk among themselves, not only in the moments your beats set up. On the **Community** page in the builder, describe the community: what it is and what it's like, what people talk about, how many posts a day and how many replies, who in the cast takes part, and the days before participants arrive and while they're there. Add anything that must never be said.

Press **Draft the community**, and the model writes it a day at a time, each day following from the ones before. Every line is checked against your limits and Truman's, and anything that fails is left out. It lands in your draft as ordinary posts and replies, marked as generated. Read them on the **Feed** page, and change or delete any of them, as with anything else. **Take out what this wrote** removes a whole draft if it isn't what you wanted.

With more than one condition, choose **The same community in every condition**, or **A different community for each condition**, saying what's different in each, such as one friendly and one hostile.

Nothing reaches a participant until you save a version, so a person has read every line, and everyone in a condition sees the same community. Each person's persona card, on the **Beats** page, shapes how they write. What it costs is shown, and counted against your lab's budget. In your data, each post and reply's provenance says it was generated.

The moments that matter, and anything that reacts to the participant, are still beats.

## A community written while the study runs

The same page can leave the writing until the study is running. Under **When it's written**, choose **While the study runs**, and press **Turn on the live community**. Nothing is written in the draft. Once you save a version and launch it:

- **At launch,** the model writes the days before participants arrive, and their first day.
- **After that it stays a day ahead** of whoever is furthest along. When the first participant in a condition reaches day 2, day 3 is written.
- **Everyone in a condition sees the same community.** Each post is timed from a participant's own arrival, so someone who joins a week later sees the same posts at the same point in their study. The comparison between conditions is kept.
- **It stops** after the number of days you gave, when the study's budget for live writing (`live.budgetUsd` in `beats.yaml`) is used up, or when live writing is paused on the **Monitor and download** page. The community goes quiet, and what's already written stays.

**Nobody reads it first, unless you say so.** Every line is checked by a second call against your limits and Truman's, and what fails is left out. That's a model checking a model. Tick **Hold each day until someone on the team approves it**, and each day waits on the Monitor page for **Approve this day** or **Skip it**. A participant who reaches a day that isn't approved sees nothing from it, so someone has to keep up.

Either way, the **Live community** card on the Monitor page shows every day as it's written, a day before anyone sees it. **Take out** removes a post and its replies, for everyone who has it and everyone still to reach it.

In your data, a live community's posts are in each participant's world, with `provenance` of `generated`. The same post has the same `source_ref` for every participant, such as `live-all-d2-p0`: the community for all conditions, day 3, first post.

It isn't written for [shared worlds](/guide/shared-worlds) yet, and a preview of a draft doesn't show it.

### Each participant's own community

Tick **Give each participant a community of their own** and, from their second day, each participant's community is written for them alone.

- **Up to their first day it's their condition's,** the same as everyone's, since nothing can be written for someone who hasn't arrived.
- **After that, each day is written when they come back that day.** The model is told what they've posted, so people in the cast can pick it up, and reply under their posts. They get a notification for a reply, as for any other.
- **Two people in a condition now see different posts.** That's the point of it, and it's what you give up. Use it when the study is about a community that responds to someone, and say in your methods that it varied. Every post is in your data, for each participant.
- **It costs for every participant, every day they come back.** Set the most one participant's community can cost, 50 cents unless you change it. At that point theirs goes quiet. The study's budget still holds over everything.
- **Their posts are sent to the model,** as with live writing.

The Monitor page says how many participants have one and what it's cost, and lists the latest days, and any held for approval. With hundreds of participants, holding every day for each of them is a lot of reading.

A reply that has to come at once, or at a set moment, is still a beat.

## As participants

Before you pay real people, you can have a model play a few. You describe each persona in a sentence or two on the **Personas** page, save a version, and run them from **Simulate** on the **Studies** page. Afterwards you read a transcript for each one: what they saw, what they did, and why, in their words.

Personas are for reading how a study feels. For checking its logic, random simulated participants are the better tool, and they cost nothing because they use no model. If your study writes live, the cast writes live for personas too, so a persona run shows you what participants would really see.

Each run has a budget, $2 unless you change it, and stops when it's spent. See [Testing a study](/guide/testing).

::: info Personas and persona cards are different things
The persona cards under `cast:` on the Beats page say who your cast members are. The personas on the Personas page are made-up participants.
:::

## As a helper while you build

An agent is a model that works on a draft with tools: it can read the draft, add and change things, check for problems, save a version, run its scenario tests, and simulate participants. There are two ways to have one, and both use the same tools with the same limits.

### Draft from a brief

This one needs no setup. On the **New study** page, describe your study under **Draft from a brief**, and an agent builds a first draft for you to review: the cast, posts, beats, and tests.

You can also ask for one job on a study you've already started. In the builder, press **Agent**, type a request under **What should it do?**, set **Budget, in US dollars**, and press **Ask the agent**. It can draft a whole study, write personas to pilot it, or write scenario tests for its beats. The page shows each step as it happens and what the agent said at the end.

The agent runs on the Truman server within its budget, which is $2 unless you change it and can be set up to $20. It stops when the budget is reached.

### Your own agent

If you already use an AI agent such as Claude Code, you can connect it to Truman yourself. Truman has an MCP server, which is a small program your agent's client runs on your own computer. MCP is an open standard, so the client doesn't have to be Claude.

1. In the admin app, open **Access for agents** in the menu on the left.
2. Fill in **What it's for** and press **Create a token**. Copy the token straight away, because it's shown once.
3. Add Truman's MCP server to your client, with the server's address and the token. The command is in [The API and agents](/developers/api-and-agents).

A token lasts 90 days. Press **Revoke** on the same page when you're done with it.

::: warning Keep a token like a password
A token acts as you. Keep it in your MCP client's settings, never in a study or a shared file.
:::

### What an agent can't do

Whichever way you run one, an agent can't do anything that reaches real participants or their data. It can't launch, stop, or delete a study, withdraw anyone, download data, see or remove what participants write in shared worlds, touch Prolific, or approve what the cast says. The server refuses those from an agent. It can recommend them, and you decide and do them in the admin app.

What an agent writes is marked as generated, so your methods section can say which parts were. The full list of limits and tools is in [The API and agents](/developers/api-and-agents).

## Who pays for Claude

Four things in Truman call Claude: live writing, rehearsing lines, personas, and agents that run on the server, which covers Draft from a brief and the Agent page. Each call costs a little, and whose key pays depends on where your Truman runs.

**On hosted Truman,** an approved lab starts with a $5 starter budget, paid for by hosted Truman. It's a one-time amount across all your studies. After that, an owner adds the lab's own Claude key on the **Your lab** page, and the lab pays Anthropic for what it uses. A lab that's still waiting for approval can't use Claude yet. See [Your lab on hosted Truman](/guide/your-lab).

**On your own Truman,** the server has one Claude key, set by whoever runs it, and everything uses that. See [Run your own Truman](/developers/run-your-own).

An agent you connect yourself is different, because the model runs in your own client and is paid for there. Only what it asks Truman to do with a model, such as a persona run, is paid for as above.

Running out of budget doesn't break a study. When a call is refused, a beat uses its rehearsed or fallback line and records why. Budgets stack, too: a study's live-writing budget, a persona run's budget, and an agent's budget each cap their own spending. On hosted Truman, all of them also count against your lab's.

## What's recorded

Your export shows where a model was involved. For every improvised beat, `beat_runs.csv` says whether the line was written live, rehearsed, or the fallback, and for a live line it has the prompt, the model, what it wrote, the check's answer, and the cost. For an approved beat it has who decided and whether the line was changed. See [Your data](/guide/data).
