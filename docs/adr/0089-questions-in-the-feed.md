# 89. A beat can ask the participant a question in the feed

## Context

Researchers measure what a participant felt or thought with a survey at the end. By then they're remembering. Several have asked for a way to ask in the moment: how did that comment make you feel, just after reading it. Asking at a moment, over time, is a method of its own (experience sampling), and a survey tool can't do it, because it doesn't know what's happening in the feed.

Truman already knows. Beats (ADR 51) say when things happen: at a time, when the participant does something, or after another beat. A moderator's warning (ADR 32) already puts something on a participant's screen that stays until they press a button.

Truman doesn't have questionnaires of its own, and isn't getting them: nearly every lab uses Qualtrics for those, and the flow already hands people to a survey and back.

## Decision

- **A new thing a beat can do: `ask`.** It has one to three `questions`, an optional `title`, and `required`. It has no `actor`. Nobody in the cast asks. The site does.
- **Four kinds of question:** `scale`, `choice`, `choices`, and `text`. A scale is 1 to 5 unless it sets `min` and `max`, and can label its ends.
- **It's asked when the beat is due,** like everything a beat does. So it can follow anything a beat can wait for, be limited to conditions, happen more than once with `max`, and be cancelled with `unless`. In a shared world each participant gets their own.
- **A card at the bottom of the screen,** over whatever page they're on, until they press Send or Not now. `required` takes away Not now.
- **A table of its own, `beat_asks`,** a row for each time a beat asks: the questions as asked, when it was due, and then the answers, or that it was put aside. It hangs from the beat's run.
- **Two events,** `question.answered` and `question.dismissed`, so the event log has them like everything else a participant does.
- **How long they took** is from when the card was on their screen to when they answered, by their device's clock, sent with the answer.
- **`answers.csv` in the download,** a row for each question each time it was asked, answered or not.
- **A feature, `questions`,** on in every kind of site. It does nothing unless a beat asks. A condition can turn it off.
- **It shows up promptly.** The participant's screen checks for a waiting question right after anything they do, and every ten seconds otherwise. Checking catches the world up first, so a question set off by what they just did is there at once, without their loading the feed again.

## Alternatives considered

- **Questionnaires as a step in the flow,** with these as a special case. It's the bigger feature, and it remakes Qualtrics. Asking in the moment is the part only Truman can do.
- **Using the notifications table,** as a warning does. A notification has to be about a post or a person, and a question often isn't. It would also put questions among "Jake liked your post".
- **Only events, no table.** The export reads from the event log. But a question that was asked and never answered leaves no event, and who was asked is half of what a researcher needs. And the screen has to know what's waiting.
- **A step in a scenario or a card in the feed's own list,** between two posts. It would scroll away. The point is to be answered now.
- **Someone in the cast asking,** in a message. That's a different study: a person asking is social, and the participant answers to them. A beat can already send a message.
- **Recording when it appeared with a call of its own.** More exact about what the server knows. It's another request each time, and the participant's device knows best when the card was drawn.
- **More than three questions, or skip logic.** That's a survey.

## Consequences

- **Asking changes what people do next.** That's a property of the method, not something to engineer away. The guide says to decide which conditions ask and to keep timing the same across what's compared. Every ask is in `beat_runs.csv`, so exactly when each person was asked is known.
- **Withdrawal needs nothing new.** A participant's questions go with their beat runs, which already go with them, alone or in a shared world. Their answer events go with their events.
- **A beat can't wait for someone to _see_ a post,** only for something they do. "Just after reading it" means after they react to it, for now. A trigger for seeing would be its own change, since what's seen is recorded differently from what's done.
- **Scenario tests can check a question was asked,** with `happened`, but can't answer one. Simulated participants and personas don't answer either, so in a simulation every question is unanswered.
- **`took_ms` trusts the participant's device,** as the time of every action does. It's left out when it makes no sense.
- **A question at a set time, or after a delay, can be up to ten seconds late,** since it waits for the screen's next check. One set off by what they just did isn't.
- **The phone app shows it without changes,** since it shows the site.
