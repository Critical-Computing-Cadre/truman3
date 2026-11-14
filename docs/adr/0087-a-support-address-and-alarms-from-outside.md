# 87. A support address, and alarms that look from outside

## Context

Two gaps in how a hosted Truman finds out something is wrong.

**Nobody to write to.** The only address on the site was for security problems (ADR 84). A researcher whose study wouldn't launch had nowhere to ask, short of knowing someone.

**Alarms that only look from inside.** Production had six alarms (ADR 73): the API's errors, speed, load, and whether a container is healthy, and the database's load and space. Every one is measured inside AWS, at the load balancer or the database. If the domain's DNS broke, a certificate lapsed, or CloudFront misrouted, the API would look healthy to all six while nobody could reach it. And nothing watched email. Amazon reviews, and can stop, an account whose mail bounces or is marked as spam too often. Invitations and password resets would stop with it.

## Decision

- **`support@truman-research.org`,** set as `mail.supportContact`. It works exactly as the security address does: SES takes the mail and hands it to a topic, `<stage>-support-requests`, and whoever should read it subscribes by hand. One set of mail rules now serves both addresses.
- **The site gives that address** on "Your lab on hosted Truman", and the security page points to it for anything that isn't a security problem.
- **Three checks from outside AWS,** as Route 53 health checks: the admin app's address and the default participant domain, each at `/api/health`, and the public site's front page. Each is asked over HTTPS from several places every 30 seconds. An alarm fires when one hasn't answered for two minutes.
- **Two alarms on email,** at half the level Amazon acts on: 2.5% of mail bouncing, or 0.05% marked as spam.
- **All of them go to the alerts topic** the other alarms use.

## Alternatives considered

- **A status page from an outside service.** It checks from outside too, and shows labs the history. It needs an account, and while the only users are people who can message the operator, there's nobody to show. The health checks give the operator the same warning. A status page can be added on top when strangers sign up.
- **CloudWatch Synthetics,** which drives a real browser through the site. It can catch a page that loads but doesn't work. It costs more, needs a script and a bucket, and a broken page is what the browser tests are for. A plain request catches the failures the inside alarms can't see.
- **Checking only one address.** The three fail separately: each has its own DNS records and certificate, and the site is a different origin from the apps.
- **A person's address for support.** In a public repository for good, as with the security address.
- **A help form in the admin app.** It can't be used by someone who can't sign in, which is one of the things people ask about.

## Consequences

- **A request for help arrives as a notification from AWS,** with the sender's message inside. Answering means writing to the sender from your own address.
- **Nothing reaches anyone until the new topic has a subscriber.**
- **A few dollars a month,** for three health checks. Route 53 charges for each one, and more for one over HTTPS. Under $10 in all.
- **An outside check can be wrong.** A fault on the internet between Route 53 and CloudFront raises the alarm with nothing wrong at Truman. Three failures in a row from most of the places it checks from are needed, which keeps that rare.
- **The checks see the front door, not the rooms.** `/api/health` answers when the API is running. It doesn't say a study can be joined. The inside alarms and the browser tests cover that.
- **The email alarms say nothing until there's enough mail** for Amazon to work out a rate.
- **Staging has none of this.** It has no alerts and no domain to take mail at.
