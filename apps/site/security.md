---

title: Reporting a security problem
description: How to tell us about a security problem in Truman or in hosted Truman, what to include, and what to expect.
---

# Reporting a security problem

If you've found a security problem in Truman, or in hosted Truman at truman-research.org, please tell us privately first:

**[security@truman-research.org](mailto:security@truman-research.org)**

Please don't open a public GitHub issue for it. An issue is public the moment it's filed.

## What to include

- What the problem is, and what someone could do with it.
- Where it is: a page's address, an API route, or a file in the repository.
- How to see it happen, step by step if you can.
- Whether you think anyone's data has already been reached.

A short, rough report sent today is more use than a polished one sent next month.

## What to expect

A person reads every report. Truman is run by a small research lab, so a reply can take a few days.

We'll tell you what we found and what we did about it. If the problem is in the code, the fix goes into the public repository, and we're glad to credit you there if you'd like.

## While you're looking

Hosted Truman holds research participants' data, so please take care with it.

- Use the [example studies' demos](/studies/) or a lab of your own to test. Everything in the demos is made up.
- Don't try to reach another lab's studies or its participants' data. If you find you can, stop there and tell us.
- Don't do anything that would slow the service down or take it offline.
- Please give us time to fix a problem before you write about it.

## What's in scope

- The code in [the repository](https://github.com/Critical-Computing-Cadre/truman3).
- Hosted Truman: truman-research.org, app.truman-research.org, and the addresses participants use, such as clikbrite.com.

A Truman that someone else runs on their own servers is theirs to hear about. If the problem is in Truman's code, we'd still like to know.

The same address is in [`/.well-known/security.txt`](/.well-known/security.txt), where tools look for it.
