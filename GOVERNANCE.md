# How Truman 3 is governed

This page says how decisions are made today. It's short because the project is small.

## Today

- **One maintainer.** Truman 3 is maintained by Dominic DiFranzo, who created Truman, at Lehigh University. He reviews and merges every change, decides what the project takes on, and approves each deploy of hosted Truman.
- **Where it lives.** The code is in the [Critical Computing Cadre](https://github.com/Critical-Computing-Cadre) organization on GitHub, which is his lab's.
- **How decisions are made.** In the open, in pull requests. A choice someone might later question is written down as a decision record in [`docs/adr`](docs/adr), with the alternatives considered, so the reasons outlast the people.
- **Who can contribute.** Anyone, through issues and pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Hosted Truman** at truman-research.org is run by the same lab. Labs apply to use it, and the maintainer approves them.

## What that means for you

A project with one maintainer depends on that person. What guards against that today:

- **The license is MIT,** so anyone can keep using, changing, and hosting Truman whatever happens to this repository.
- **Nothing needs hosted Truman.** Everything here runs on your own servers, and a study can be taken out as a replication bundle and its data as plain files.
- **The reasons are written down,** in the decision records and in each pull request, for whoever comes next.

## What's planned

Truman has been used by labs at several universities since 2017, across three generations of the code. It should outgrow one lab. Planning is under way for a community-governed home for Truman and related open tools for social media simulation research, with the working name Seahaven. Nothing about it is decided yet: who governs, how maintainers are chosen, and how hosting is paid for are the questions that planning is meant to answer, with the people who use Truman.

This page will change when there's something decided to describe.

## Changing this document

By pull request, like everything else.
