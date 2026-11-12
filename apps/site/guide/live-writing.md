---

title: A cast that writes for itself
description: How cast members can write their own lines with an AI model, inside limits you set, with rehearsed lines, checks, researcher approval, budgets, and a pause switch.
---

# A cast that writes for itself

By the end of this page, someone in your cast can answer a participant in their own words. A participant defends Maya's painting, and Maya thanks them for what they actually said.

You still decide what happens and when. The beat says "Maya thanks them". An AI model, Claude, only fills in the wording. You choose how much freedom it gets:

1. **Fixed text.** The beat has `text`, and that's what's posted.
2. **Rehearsed lines, live writing off.** Each participant's world gets one of a few lines you read ahead of time. No model runs during the study, so it costs nothing.
3. **Rehearsed lines, live writing on.** The model picks the line that fits what the participant said.
4. **Live writing.** The model writes the line, and a second check reads it before it's posted.

Add approval to any of these and a researcher reads every line before it goes out.

## Improvise and fallback

On the **Beats** page, give a post, comment, or message `improvise` in place of `text`. It's an instruction to the character. It needs a `fallback`, the line used whenever live writing can't be.

```yaml
do:
  action: comment
  actor: maya
  on: trigger
  improvise: Thank them for what they said, in your own words
  fallback: "Thank you, that really means a lot"
  lines:
    - "omg thank you, that made my day"
    - "this is so kind, thank you!!"
```

`lines` are the rehearsed lines. Write them yourself, or have the model draft them:

1. On the **Beats** page, find **Rehearse lines**. It lists each beat that improvises.
2. Press **Rehearse** beside one. The model drafts five lines, adds them to the beat in the editor, and says what the call cost.
3. Read them. Change or delete any you don't like, then save.

## Turning live writing on

Live writing is off unless the top of the Beats page turns it on:

```yaml
live:
  enabled: true
  budgetUsd: 5
  model: claude-opus-5-5
  maxLength: 500
  redLines: [Insulting anyone's appearance, family, or identity]
```

- `budgetUsd` is the most this study spends, across everyone in it.
- `maxLength` is in characters.
- `redLines` are things no character in this study may write.
- `stray` decides what happens when no rehearsed line fits. `choose`, the default, lets the model write its own. `never` keeps it to the rehearsed lines. `always` ignores them.

Persona cards say who each character is. They go under `cast:` on the same page, and everything in a card is optional.

```yaml
cast:
  jake:
    about: A classmate who thinks he's funny.
    voice: Lowercase, short, sarcastic.
    relationships:
      participant: Annoyed that they're getting involved
    redLines: [Never swears]
```

## What the model sees, and the check

For each line, the model is told who the character is, what they've already said in this participant's world, the post they're on with up to ten comments, the comment they're replying to, and the beat's instruction. For a message, it gets the conversation so far, up to twenty messages. It sees nothing else in the study's data.

Every line a model writes is read by a second model call before it's posted. The check allows rudeness that a study intends. It blocks lines that cross a limit:

- the limits every study has: no slurs, sexual content, threats, real people's information, dangerous instructions, or saying it's an AI or a study
- your study's `redLines`
- the character's own red lines

## When the fallback is used

A rehearsed line, or the fallback if there are none, is used when live writing is off, there's no Claude key, the budget is used up, a researcher paused it, the model declines or can't be reached, or the check stops the line. The reason is recorded. The participant sees a line either way.

A page someone is looking at never waits for a model. A live line is written in the background, so it can appear up to 30 seconds later than it was due.

## Approval, for Wizard of Oz studies

A beat can wait for a researcher before anything is posted.

```yaml
live:
  approval: all
  approvalTimeout: "0:05"
```

`approval: all` holds every beat. To hold just one, give that beat `approve: true`.

While the study runs, open **Monitor and download**. Waiting beats are on the **Christof, the director** card, under **Waiting for you**. Each shows what it's about, such as the participant's post, and **The line, which you can change**.

- **Approve** posts the suggested line.
- Edit the line and the button becomes **Post my version**.
- **Skip it** means the beat doesn't happen.

This works with live writing off, so a researcher can write every line by hand. Your own words aren't checked by the model, and they're recorded as yours.

If nobody decides within the timeout, ten minutes unless you set one, the fallback or fixed line is used, so a participant never waits forever. `approvalTimeout: never` waits as long as it takes.

## Budgets and pausing

Each call costs a little, and two limits apply. The study's `budgetUsd` is one, and the Christof card shows what's been spent against it. Your lab's Claude budget is the other. On hosted Truman a lab starts with a $5 starter budget, then uses its own key. See [Your lab on hosted Truman](/guide/your-lab).

On the same card, **Pause all live writing** switches the whole study to fallback lines until you press **Resume live writing**. Under **Pause one person**, tick a cast member and only their beats use fallback lines. Beats keep happening on schedule either way.

## What's recorded

For every improvised beat, `beat_runs.csv` says whether the line was written live, rehearsed, or the fallback, and why. For a live line it also has the prompt, the model, what it wrote, the check's answer, and the cost. For an approved beat it has who decided, the suggested line, and whether it was changed. **The latest decisions** on the Christof card shows these as they happen.

AI-written content is something to describe to your IRB and in your debriefing. See [Ethics](/guide/ethics). To read what your cast says before anyone real does, run personas. See [Testing a study](/guide/testing).
