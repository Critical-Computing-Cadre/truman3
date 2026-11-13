# 78. Demos the server sets up for itself

## Context

The public site describes five example studies. Reading about a study isn't the same as being in one, and Dominic asked for running versions people can open and play with.

The obvious way is to import the examples on production from the command line. That doesn't work as the cloud is built (docs/cloud.md): the database has no route from outside, and the one-off tasks that run inside have no storage settings, so they can't upload a study's pictures. Giving them storage would widen what a task can do for a job that runs a few times a year. The other way, making them by hand in the admin app, has to be redone whenever an example changes, on each server.

## Decision

- **With `DEMO_STUDIES=true`, the API sets up the demos as it starts.** It already has the database and storage. The examples are in its container, beside the starters.
  - It makes a team called Demos if there isn't one. The team has no researchers, so only an operator sees it, on the Labs page.
  - It imports each example as a study at `try-<slug>`, such as `/join/try-bystander`, and opens it.
  - Importing the same content twice changes nothing, so most starts do nothing. When an example changes in the repo, the next deploy saves a new version and new visitors get it.
- **A demo differs from its example in three ways.** Its address has `try-` in front, so a lab's own import of the example can't collide with it. Its consent page starts by saying it's a demo and nothing is used for research. Its exit step sends nobody on to a survey.
- **Town talk has no demo.** It puts six strangers in a forum together, and nobody would be reading what they wrote to each other.
- **The Demos team has no starter budget for Claude.** Anyone on the internet can open a demo, so a cast that improvises uses its written lines. An operator can raise the budget on the Labs page.
- **The site's Try it button makes up the recruitment ID,** so a visitor doesn't type one. Each click is a new participant with a world of their own, in a condition chosen as the study chooses.
- **A demo an operator stops stays stopped,** until its example next changes.
- **A demo visit is deleted after a week.** The longest example runs for two days, so a week leaves time to come back to it.
- **Hosted stages turn it on.** A lab's own Truman has it off unless it sets the variable.

## Alternatives considered

- **Importing from the command line.** See above: it needs the one-off task to reach storage, and someone to run it on each server after each change.
- **Making them in the admin app.** Works once. Then the examples change and the demos don't.
- **A demo mode in the participant app,** with no consent step and a banner on every page. More to build and to keep working, and a demo that skips consent no longer shows what a participant goes through.
- **Using the examples' own addresses.** A lab trying `pnpm study import studies/examples/bystander` on a server with demos would add a version to the demo.

## Consequences

- Demo visitors are participants like any others: their events and posts are stored. The server deletes each one a week after they started, with what they posted and uploaded, the way a withdrawal does. It checks soon after it starts and every six hours, and takes up to 200 at a time. Each demo's first page says so.
- A visitor can upload a photo in a demo, as a participant can in any study. Only they can see it, since each has their own world, but it's stored. Photo scanning is already on the road to launch, and matters more with these open.
- The API's container is about 100 MB larger, nearly all of it EatSnap's pictures.
- Each start reads the examples' pictures to hash them. That's after the server is listening, so it doesn't slow a deploy's health check.
- With several API tasks starting at once, two may try to make the same demo. One fails on the address being taken, logs it, and the other's work stands.
