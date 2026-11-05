# 32. Warnings and a mod log

## Context

The next piece of Forum part 3, after removal (ADR 31). As there, a moderator's decisions are written by the research team. Dominic also said a participant isn't really banned, they see a ban decision, and that things like elections or penalty policies are part of the simulation, so a warning shouldn't assume any real system of strikes behind it.

## Decision

- **Two features, `warnings` and `modLog`, off in Classic and on in Forum.** Each does nothing until a study writes moderation.
- **A warning is a new reaction type, `warn`,** on a participant's nth post or comment, whose `body` is required and is what it says. It changes nothing about what they wrote, and doesn't stop them doing anything.
- **It stays on every page until they press "I understand."** It also goes in notifications, but a study can't rely on someone opening those. Pressing it is `moderation.warning_acknowledged`, recorded once. That says they pressed it, not that they read it, and the codebook says so.
- **The mod log is worked out from the removals,** through `loadRemovals`, so it can't disagree with what's on screen. It lists who removed what kind of thing, whose it was, where, why, and when, and never what it said. It only lists what this person could otherwise see, including their own.
- **Viewing it is `page.viewed`,** as for any page, with the path saying whether it was one community's log. That's enough to say someone looked, and what it listed follows from the time.
- **Its link is on the Communities page and each community's page,** since a phone's bottom tabs are already full. With spaces off, it goes in the header.

## Alternatives

- **A warning only in notifications.** Whether someone opened that page would decide whether they got the treatment.
- **Recording what a log listed, as with feeds.** It'd be a second record of what removals and the time already say.
- **Warnings in the public log.** A warning is said privately, and a public log of them changes what's being studied. A study can write a public post from its moderator if it wants that.
- **Warnings at a set time, with no post behind them.** They could reach someone who wrote nothing, but `notifications` needs something to point at, and no study has asked for one yet.
- **Log entries for things that never appeared,** to suggest a busy moderator. It could be useful, but it's a separate thing to write, and can wait for a study that needs it.

## Consequences

- Someone who writes nothing gets no warning, since a warning is a reaction to what they wrote.
- A notice over every page takes room on a phone until it's pressed, and pressing it is required only in the sense that it doesn't go away otherwise. The study's flow carries on regardless.
- A warning arrives when the page next checks, within 30 seconds, or on a reload.
- As with removals, these can only be written in study files for now (ADR 33 adds the builder's screen).
