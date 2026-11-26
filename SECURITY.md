# Security policy

## Reporting a problem

Please report security problems privately, and not in a public issue. An issue is public the moment it's filed. There are two ways:

- Email **security@truman-research.org**.
- Or use GitHub's private reporting: [Report a vulnerability](https://github.com/Critical-Computing-Cadre/truman3/security/advisories/new), under the repository's Security tab.

What to include, and what to take care with while you're looking, are at <https://truman-research.org/security>. The same address is in [`/.well-known/security.txt`](https://truman-research.org/.well-known/security.txt).

## Supported versions

| Version                                          | Supported                            |
| ------------------------------------------------ | ------------------------------------ |
| The `main` branch, and the latest release        | Yes. Fixes go here                   |
| Earlier releases of Truman 3                     | No. Please update to the latest      |
| Truman and Truman 2.0, in their own repositories | No. They aren't maintained from here |

Hosted Truman at truman-research.org runs `main`, after a person approves each deploy.

## What to expect

Truman is maintained by a small research lab, so these are what we aim for, not a service agreement.

| When                   | What happens                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| Within 5 working days  | A person replies to say the report was read                                     |
| Within 30 days         | We tell you what we found, and what we've done or plan to do                    |
| When a fix is released | It goes into this repository, with credit to you if you'd like it               |
| 90 days after a report | You're free to write about it, fixed or not. Please talk to us first if you can |

If participants' data on hosted Truman may have been reached, we tell the labs affected.

## What's in scope

- The code in this repository.
- Hosted Truman: truman-research.org, app.truman-research.org, and the addresses participants use.

A Truman that someone else runs on their own servers is theirs to hear about. If the problem is in Truman's code, we'd still like to know.
