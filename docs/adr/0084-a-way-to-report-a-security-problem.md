# 84. A way to report a security problem

## Context

Truman's code is public, and a hosted Truman holds participants' data. Someone who finds a hole needs somewhere to say so that isn't a public issue. There was nowhere. It was on the list of things to have before real participants.

## Decision

- **One address, `security@truman-research.org`,** on the site's [security page](https://truman-research.org/security), in `SECURITY.md`, which GitHub shows on the repository, and in `/.well-known/security.txt`, where tools look (RFC 9116).
- **AWS takes the mail.** The production stage adds an MX record for the mail domain and an SES rule for that one address. Anything else sent to the domain is refused. Mail that SES judges spam or a virus is dropped.
- **Each message goes to an SNS topic,** `<stage>-security-reports`. Whoever should read them subscribes an address to it by hand, the way alerts work (ADR 73). So nobody's own address is in this repository, which is public.
- **`security.txt` says when it expires,** as the standard requires. A test fails a month before that date, so it's moved on before the file lapses.
- **The page promises little:** a person reads every report, and a reply can take a few days. It asks people to test on the demos or their own lab, to stop if they reach someone else's data, and to give us time before writing about a problem.

## Alternatives considered

- **A person's address on the page.** It's in a public repository for good, and it changes when the person does.
- **GitHub's private vulnerability reporting.** Good for problems in the code, and worth turning on as well. It needs a GitHub account, and a problem with the hosted service isn't a problem with the repository.
- **Forwarding the mail as mail,** with a function that re-sends it. It reads better in an inbox. It's another thing to run and keep patched, for a few messages a year. A topic's notification carries the whole message, headers and all.
- **A mailbox service.** A monthly cost and one more account, for the same few messages.
- **Promising not to take legal action against good-faith research.** That's a promise for the university to make, not this page. It can be added when it's been asked.

## Consequences

- **A report arrives as a notification from AWS, not as the sender's email.** It has the sender, subject, and text inside it. Replying means writing a new message to the sender, from an address of your own.
- Mail over 150 KB is dropped by SNS. A report with a large attachment won't arrive, and the page asks for a description, not files.
- Nothing reaches anyone until someone subscribes to the topic and confirms it.
- An account has one active set of SES receiving rules. This stack makes one and makes it the active one. A second thing in the same account that wanted to receive mail would have to share it.
- Staging has no such address.
