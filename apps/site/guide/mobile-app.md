---

title: The phone app
description: What Truman's phone app for participants is, what push notifications will let a study do, and what already works in a phone's browser while the app isn't in the stores yet.
---

# The phone app

Truman has a phone app for participants. It wraps the study site, so a study looks and works the same in it, and it adds one thing the site in a phone's browser doesn't have: push notifications. With those, a study can bring people back over several days, the way a real platform does.

::: warning Not in the stores yet
The app isn't in the App Store or on Google Play yet. The store listings are being set up, and we don't have a date. Until then, participants use a study in their browser, which works today on phones and computers.
:::

## What it is

The app is a shell around the participant site. Everything a participant sees in it comes from the site, so every kind of site and every feature works in it, and there's nothing extra for you to build.

On top of the site, the app gives a study:

- a place on the phone's home screen
- a sign-in that's kept between visits
- study links that open in the app, at the right page
- push notifications, if the study turns them on and the participant allows them

The app's name and icon are set when it's built, so it can have a neutral name, like the rest of a participant's screens.

## Push notifications

Push notifications are a feature like any other. The feature is called **Push notifications**, it's off in every kind of site, and a study turns it on. It only does something for participants who use the app.

With it on, a participant gets a notification on their phone for what their Notifications page would show, and for direct messages to them. So when someone in your cast replies to a participant at hour 26, the participant can hear about it while the app is closed, and tapping the notification opens the app at the right page.

A few details are worth knowing:

- **A push says who, not what.** It reads like "Jake replied to you" and never includes what anyone wrote. Notifications pass through outside services, including Apple's and Google's, which shouldn't see study content.
- **The participant chooses.** The app asks whether to allow notifications, and their answer is recorded.
- **Nobody gets a backlog.** Only what comes due after they turned notifications on is sent, and threads they muted are left out.
- **The cast stays on schedule.** For participants with push on, Truman checks every 30 seconds for what has newly come due, so what the cast does while the app is closed happens on time.

## What the app adds to your data

The app records a few things a browser can't:

- when the app was opened and closed, and how long it was open
- whether the participant allowed notifications
- each notification that was sent, and what it said
- when a participant opened the app from a notification

The token a phone uses to receive notifications is deleted when a participant withdraws, along with everything else about them.

## What works today, in a browser

You don't need the app to run a study over several days. In a browser, on a phone or a computer:

- The whole study works. The app shows the same site.
- Participants come back with the same link, on any later day.
- Posts and beats still happen on their schedule. If a participant is away when something comes due, it's placed at the time it was due, and they find it there on their next visit.
- A site with notifications on has a Notifications page, so a participant sees what happened once they're back.

What's missing is the nudge. Truman doesn't send participants anything between visits, so in a browser nothing tells them that someone replied. If your design depends on people returning, plan for that in how you recruit and remind them.

## If you run your own Truman

The app is open source, like the rest of Truman. Someone comfortable with building phone apps can build it for your own server, with your own name and icon, and try it on a phone without a developer account. Push notifications need a real build and Apple and Google developer accounts. The steps are in [the app's README](https://github.com/Critical-Computing-Cadre/truman3/blob/main/apps/mobile/README.md).

For the study link and recruiting, see [Running a study](/guide/running).
