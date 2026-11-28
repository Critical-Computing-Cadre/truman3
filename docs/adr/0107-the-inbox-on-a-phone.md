# 107. The inbox on a phone

## Context

The fourth part of making a site behave like an app on a phone (ADRs 104 to 106). Three things were left about notifications and messages:

- Notifications were one long list. The apps these sites stand for have a row of chips above it to see one kind.
- In a conversation, the box to write in was under the last message, so it moved as messages arrived and sat above the sections along the bottom.
- Forum's bottom bar had six tabs on a phone once Create was added (ADR 104), and "Communities" and "Notifications" were cut short.

## Decision

- **Chips above the notifications narrow the list to one kind:** All, Replies, Reactions, Follows, Moderation. On every kind of site, at every width.
  - Each chip is a few kinds of notification under one word (`notification-filters.ts`). A reply or a tag is under Replies. A like, a repost, or a read is under Reactions. Everything a moderator does is under Moderation. A test fails if a kind of notification is under none of them.
  - A chip is only offered when the list has something for it, and there are no chips at all until there are two kinds to choose between.
  - It's the same list with some left out. Nothing more is asked of the server, and nothing is marked read or unread by it.
  - **Each press is recorded** as `notifications.filtered`, with which chip. A study of what people look for in their notifications can use it, and it's in the export's codebook.
- **In a conversation on a phone, the box to write in is held to the bottom of the screen,** and the sections along the bottom aren't shown there, on all six kinds. It's the same as the box to reply on a post's page (ADR 106), and uses the same mark on the page, `data-page`. The arrow at the top goes back to the list.
- **On a phone, Forum has one tab for both, "Inbox".** It opens notifications. Notifications and Messages each have a pair of tabs at the top to move between the two, with a count on the other when something's new there. A dot on Inbox says a message is waiting. That brings the bar to Home, Communities, Create, Inbox, and Profile, with nothing cut short.
  - To a screen reader, and to tests, the tab is still the link named "Notifications, 2 new".
  - On a wider screen Forum's top bar has room for both, and nothing changes. A forum with only one of the two keeps that one's own tab.

## Alternatives considered

- **Chips that are only for show.** A press on one would say it isn't available, which is odd for something so small, and a real filter is a few lines.
- **Filtering on the server.** It would make each press a request and a record on the server without the client saying so. The list is at most a few dozen lines, and the press is recorded either way.
- **An Inbox tab on every kind of site.** The others have five or fewer tabs and room for both, and a microblog or a photo app keeps the two apart.
- **Dropping Profile from Forum's bar instead.** A participant's own page is where Settings is (ADR 105), so it has to stay within reach.

## Consequences

- A new event type, `notifications.filtered`. A study that doesn't want it can ignore it. It can't be turned off apart from notifications.
- On a phone, a forum's participant reaches messages in two taps where it was one.
- A study's instructions that say "tap Messages at the bottom" are wrong for a forum on a phone. They should say Inbox.
