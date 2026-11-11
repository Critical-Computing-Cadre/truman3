# 72. Email to researchers

## Context

Until now, Truman sent no email. A forgotten password was reset with a command on the server, and a teammate was added the same way, with a password printed for someone to pass on. A hosted Truman (ADRs 70 and 71) needs labs to manage themselves: reset their own passwords, invite their own people, and hear about their application. Dominic chose email through Amazon's email service (SES), with notices to operators at the email they sign in with.

## Decision

- **Email goes only to researchers.** Truman doesn't have participants' email, and this doesn't change that.
- **One small interface, `Mailer`** (`apps/api/src/mail.ts`), with several ways to send, picked in `server.ts`:

  | Mailer      | When                                             | What it does                                                                                  |
  | ----------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
  | **SES**     | `MAIL_FROM` is set                               | Sends plain-text email                                                                        |
  | **Printed** | Local development                                | Prints each email, links and all, to the terminal                                             |
  | **Unsent**  | Production without `MAIL_FROM`                   | Notes that an email wasn't sent, without printing its links, since one might reset a password |
  | **A file**  | `TEST_MAIL_OUTBOX` is set, for the browser tests | Writes each email there                                                                       |

- **Email never stops what someone was doing.** A failed send is logged by its subject, and the request goes on.
- **Links work once and run out,** like sessions. Each is a random token. Only its hash is kept, in a new table, `researcher_links`.
  - **Resetting a password:** "Forgot your password?" emails a link that works for an hour.
    - The answer is the same whether or not there's an account, so nobody can use it to find out who has one.
    - Setting a new password signs them out everywhere else, and signs them in.
    - Attempts are rate limited.
  - **Invitations:** an owner invites an email to the team, as an owner, editor, or viewer. The link works for 7 days.
    - Someone new makes their account from the link.
    - Someone with an account has to be signed in as that email to accept, so an invitation can't be used to join as someone else.
- **Owners manage their team** on the Your lab page:
  - its members and open invitations
  - changing roles, taking people off, and cancelling invitations
  - anyone can leave
  - a team always keeps at least one owner
  - agents' tokens can't do any of this
- **On a hosted Truman, a lab hears about its application:**
  - The applicant is told it arrived, and every operator is told there's one to look at, with what the lab wants to study.
  - The lab's owners are told when it's approved, with its limits, and when it's suspended or reinstated.
- **SES is set up for each stage in the CDK stack** (`mail` in `infra/lib/stages.ts`).
  - The stack makes the domain identity, and lets only the API's task send from it.
  - It prints the three DKIM records to add wherever the domain's DNS is kept. truman-research.org's DNS is in a different AWS account from staging, so the stack can't add them itself.
  - Staging sends from `staging.truman-research.org`, which leaves truman-research.org itself for production.
- **SES starts in its "sandbox"** for each AWS account: it only sends to addresses verified in SES, and at most 200 a day. Leaving it is a request to AWS, made once per account. That's for whoever owns the account.

## Alternatives

- **Another email service, like Postmark or SendGrid.** These are good, but they're another account and another secret. SES is in the AWS account Truman already runs in, and the API's role can send without a key.
- **Magic links instead of passwords.** It's simpler for people, but every sign-in would depend on email arriving, and university email filters can hold links back.
- **Invitations that make an account with a password the owner passes on,** as `pnpm admin add` does. It needs no email, but passwords travel through chat and get reused.
- **HTML email.** Plain text is enough for a link and a few sentences, reads the same everywhere, and is less likely to be filtered as spam.
