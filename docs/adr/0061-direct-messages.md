# 61. Direct messages

## Context

Direct messages are the biggest idea from TrumanAgents, by Qian Yang and the Cornell DesignAI Group, that Truman 3 didn't have yet. Private conversations matter for studies of harassment, support, and persuasion, where a lot happens out of public view. Section 13 of the vault note `Christof design` set the first version: one to one only, a beat can send a message, sending one is a trigger, it's on or off by condition like other features, and messages are recorded and exported like comments.

## Decision

- **A `messages` feature, off in every template.** A study or a condition turns it on. Turning it on in templates would change how studies that already launched look, which ADR 18 rules out. Where it's on, every layout gets a **Messages** link in its header, with a count of unread messages, and each profile in the cast gets a **Message** button.
- **A message is content, of kind `message`,** with a new `recipient_actor_id`. Database rules say a message always has a recipient and is always in a world, and nothing else has a recipient. Being content means withdrawals, deleting studies, the export, and `content.created` events already include messages.
- **Only between the participant and one person in the cast.** The participant can message anyone in the cast but themselves. The cast never messages first unless a beat says so. There are no group conversations.
- **Messages never show anywhere else.** The feed leaves them out, as it does stories. Nothing can be liked, commented on, or reposted on one, and a study can't be saved with a beat that tries.
- **Beats:**
  - `action: message` sends one to the participant, with `text`, or `improvise` and a `fallback`, and rehearsed lines and approval, like comments.
  - `{ participant: message, on: jake }` is set off by the participant messaging Jake.
  - An improvised message is shown the conversation so far, up to the last twenty messages.
- **Unread is worked out, not stored.** Opening a conversation records `messages.opened`, with who it's with. Messages from them before the latest of those count as read. A message from the cast isn't a notification, as on most platforms.
- **Recorded and exported:**
  - Each message is a `content.created` event, with `to`.
  - It's a row in `content.csv`, with a `to` column.
  - `messages.opened` is in `events.csv`.
- **Scenario tests can send a message,** with `message:` and `to:`, and `sees` looks in their messages too.

## Alternatives

- **A separate `messages` table.** Clearer on its own, but withdrawal, deleting studies, the export, and events would each need to learn about it. Stories set the precedent of a new kind of content.
- **Notifications for messages.** Most platforms keep messages apart, with their own count. A notification would also show the message's text on the Notifications page, where others' reactions are.
- **Storing when each conversation was read.** The event log already says when they opened it, and keeping one record of that is simpler.
- **On in templates, since real platforms have messages.** It would change launched studies' pages.

## Consequences

- Migration 0048 adds `content.recipient_actor_id`, and the rules above.
- The bystander study (reference #2) turns messages on. Maya messages a participant who stood up to Jake, and Jake and Maya answer messages. Two scenarios test it.
- Personas in simulations (ADR 60) don't read or send messages yet.
- On a phone, the classic layout's header wraps to a second line when messages, notifications, and the profile are all on.
