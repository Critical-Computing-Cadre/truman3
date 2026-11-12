---

title: Testing a study
description: Five ways to check a study before real participants see it, from previewing the feed to sending in simulated participants and AI-played personas.
---

# Testing a study

Before anyone real arrives, you want to know that your study does what you meant, in every condition. Truman gives you five ways to check. None of them put anything in your real data.

## Preview, at any time

The builder is already a preview. At the top:

- **Condition** switches which condition's feed you see.
- **Compare with** puts a second condition beside it.
- The slider moves through the study. Bars above it show when new posts appear.

If the page says some posts can never appear, they're timed after the study ends or fall outside how far back the feed reaches. Press **Show posts on the timeline**, find the red ones, and drag them back in.

For a saved version, press **See the feed** beside it on the **Studies** page. It's the same view, drawn as participants see it, and nothing can be changed.

Keep in mind that preview shows what's scripted to a time. It doesn't show beats, which depend on what a participant does.

## Try as a participant

To see beats, go through the study yourself.

1. Save a version. In the builder, press **Save as new version**, then **Save version**.
2. On the **Studies** page, find the version. Pick a condition in the dropdown, and press **Try as a participant**.
3. Press **Open as a test participant**.

You go through the real thing in a new tab: consent, profile, feed, exit. Beats happen, and the cast answers you.

Test participants are left out of exports and counts, and don't use up places in blocked assignment. This works before the study is launched, and while your lab is waiting for approval.

Do this once in every condition.

## Scenario tests

Going through a study by hand gets slow once it has a few paths. A scenario does it for you. It's a made-up participant who does set things at set times, and each `expect` says what should be true by then. It runs in a world that's fast-forwarded through the study, so two days take a moment.

Use them for the logic you care most about: Sam steps in by minute 10 in one condition, and never in the other.

1. In the builder, press **Tests**. The page has an editor, with **How scenarios work** beside it.
2. Write the scenarios and press **Save scenarios**.
3. Save a version. The tests run by themselves.
4. On the **Studies** page, the result is beside the version, with what failed. **Run tests again** reruns them.

```yaml
scenarios:
  - name: Answering Jake heads off Sam, and Jake answers back
    condition: defended
    steps:
      - at: "0:03"
        comment: "Hey, that's not nice"
        on: { beat: jake-mocks }
      - at: "0:10"
        expect:
          happened: [jake-answers-participant]
          notHappened: [sam-defends]
          sees: ["relax, it's a joke"]
```

A step has an `at` time and one thing the participant does: `post`, `comment`, `like`, `repost`, `flag`, `follow`, or `message`. Or it has an `expect`, which can check `happened` and `notHappened` for beats, the `condition` they're in, and `sees` and `doesNotSee` for text in their feed.

If a version's tests haven't all passed, the Launch window warns you. You can still launch.

Scenario tests never call a model, so a run costs nothing. Improvised lines use their rehearsed or fallback lines.

## Simulated participants

Scenarios check the paths you wrote down. Simulated participants look for the ones you didn't. Many made-up participants go through a version at random, liking, commenting, reposting, following, posting, and flagging. A report says how often each beat happened in each condition.

1. On the **Studies** page, press **Simulate** beside a saved version.
2. Leave **At random** chosen, and set **How many participants**, up to 200.
3. Press **Simulate**.

The report starts with **Worth a look:** beats that never happened for anyone who could have had them, beats that happened in a condition they aren't in, decision points never reached, and errors. With nothing to report it says "Nothing stood out." Below that is each beat, with how many participants it happened for in each condition.

A beat that's rare isn't necessarily wrong. Run more participants, or write a scenario for that path.

::: tip Rerun after a change
**Repeat the last run** uses the same random choices again, which is useful after you change something.
:::

Random runs use no model and cost nothing. The participants are deleted afterwards.

## Personas

Random participants check the logic. Personas show you how the study reads. A model plays a participant you describe, and you read what they saw, what they did, and why, in their words.

1. In the builder, press **Personas** and describe a few people:

   ```yaml
   model: claude-sonnet-5-5
   personas:
     - id: upstander
       about: Confident and kind. Quick to defend someone being picked on.
       condition: silent
   ```

2. Press **Save personas**, then save a version.
3. On the **Studies** page, press **Simulate** beside the version and choose **Personas**.
4. Say how many of each to run, and set **Budget, in US dollars**. $2 is the default. The run stops when the budget is spent, and says so.
5. Press **Simulate**, then read **What each persona saw and did**.

Each transcript goes in order, with what was new each time that persona looked. Under it is the same report as for random participants, and what the model calls cost.

If the study writes live, the cast writes live for personas too, from the study's own live-writing budget.

Personas need Claude. On hosted Truman that means an approved lab with starter budget left, or its own key. See [Your lab on hosted Truman](/guide/your-lab). Personas are one of several places Truman uses a model, and [AI in Truman](/guide/ai) has the overview.

## Before you launch

Here's the checklist we'd run through before opening a study:

- Compare every pair of conditions side by side, start to end.
- Go through every condition as a test participant.
- Every scenario test passes.
- A random simulation says "Nothing stood out."
- The whole path works with real links, from recruitment to survey and back. See [Consent, surveys, and debriefing](/guide/flow).

Simulated participants can also be kept as synthetic data, for building your analysis ahead of time. See [Your data](/guide/data). The same tests can be run from the command line. See [Studies as files](/developers/study-files).
