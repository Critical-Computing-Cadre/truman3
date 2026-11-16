# 90. Reminders to come back go through Prolific

## Context

A study can last days. People who join on day one have to come back, and many don't without a nudge. Researchers running multi-day studies said reminders mattered more than almost anything else on the list.

Truman can't send one itself. It knows a participant by a recruitment ID and nothing else: no email address, no phone number. That's deliberate, and it's what the consent forms describe. The phone app can send a push notification, but it isn't in the stores yet, and most participants use a browser.

Prolific can. Its API sends a message to a participant's Prolific inbox, tied to a study. Truman already holds each researcher's Prolific connection (ADR 17) and knows which Prolific study a study recruits through.

Getting back in already works. A participant who opens the study's link with their ID in it is the same person, on any browser or computer, with nothing kept on their device. So a reminder only has to carry that link.

## Decision

- **A reminder is a message through Prolific** to someone who's part way through a study and hasn't done anything for a set number of hours. It carries their own link: the study's address with their ID in it.
- **A study turns them on once,** on its Prolific page, with how many hours away and what the message says. Twenty hours and a plain message to start with. The message has to have `{link}` in it.
- **They go out by themselves.** The API checks every 15 minutes, for every study with reminders on. There's also a button to send to everyone due one now.
- **They're sent as whoever turned them on,** with that researcher's Prolific connection. If that researcher leaves, or disconnects, the reminders stop.
- **Who's due one** is worked out from Prolific's list of who took the study, matched to who's here: in the study, not finished or withdrawn, the study's days not yet up for them, nothing done for the set hours, and no reminder yet today. Someone whose submission on Prolific was returned, rejected, or timed out is left alone.
- **Nobody gets two in a day.** Each person is claimed for the day, in `reminders_sent`, before their message goes. Two servers, or a person pressing the button while the schedule runs, can't both send. If Prolific refuses a message, the claim is given back.
- **Each send is in the page's record of what's been done,** with how many people, and who or what sent it.
- **No way to find a study from an ID.** Someone who's lost the link opens the latest message.

## Alternatives considered

- **Asking participants for an email address.** It reaches everyone, whatever recruited them. It also makes Truman hold contact details, which changes what every lab has to tell its IRB and its participants, and what a breach would expose.
- **Web push in the browser.** No address needed. Participants would have to allow notifications from a site they've just met, most don't, and on iPhones it only works for a site added to the home screen.
- **A button only, no schedule.** It keeps Truman from ever acting on Prolific unasked, as with publishing and paying. But a multi-day study is exactly where nobody wants to press a button every morning, and a message spends nothing.
- **One message to everyone at once,** with Prolific's bulk call. One request, and one wording for all, so no personal link. The link with their ID in it is the point, and the numbers are small.
- **Sending as the study, with a token of its own.** It wouldn't stop when a researcher left. Prolific's tokens are a person's, and Prolific decides what each person may do (ADR 17).
- **A page to find your study by ID.** It would let anyone ask which IDs are in which studies.

## Consequences

- **Only people recruited through Prolific are reminded,** and only when the study has been linked to its Prolific study from Truman. Anyone else is reached by the phone app's notifications, or not at all.
- **A reminder can be up to 15 minutes late,** and the hours are counted from the last thing they did, not from a time of day.
- **It adds one more thing running on a timer** in the API, beside push notifications. With more than one API container, both check. The claim keeps that from sending twice.
- **Each check asks Prolific for the study's submissions.** For a study with thousands, every 15 minutes, that's a lot of asking. Prolific doesn't publish a limit. If it becomes a problem, the check can be made less often for big studies.
- **The message says what the researcher writes.** A study that hides its purpose has to keep the message in character. The page says so beside the box.
- **Prolific may time a submission out** before a multi-day study ends, depending on how the study is set up there. Those people stop getting reminders. How to run a multi-day study on Prolific is the researcher's to set up, and the guide says to check it.
- **Tested against a stand-in for Prolific,** written from its documentation. The first real send is the test of the real thing.
