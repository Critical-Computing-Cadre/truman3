# 95. A short-video kind of site

## Context

Dominic picked short-video sites on 2026-11-17, and on 2026-11-18 said the swipe kind comes first, called "Short video". ADR 94 made video something a post can hold. This is the first kind of site built around it: one video at a time, filling the screen, and a swipe for the next, as people know from the big short-video apps. Like every kind of site in Truman, it looks like the kind of platform, not like any one of them.

## Decision

- **A fifth kind of site, Short video,** with its own layout. On a phone, one post fills the screen. Its video plays by itself, and loops. Swiping up, the arrow keys, or the scroll wheel go to the next. On a computer it's a tall column in the middle of the page.
- **Down the right side** are the author's picture (to open their profile or follow them), like, comments, save, and share, each with its count. The author's name and the post's text sit at the bottom, over the video.
- **Comments open in a sheet** that slides up over the video, which keeps playing behind it.
- **A post without a video** shows its picture, or its text on a colored card, so a study can mix them, and the sample content of other kinds still shows something.
- **Sound starts off, and one tap turns it on** for every video after, until they turn it off. That's the default, from Dominic's answer. A study can instead ask for a tap before the feed starts, so sound is on from the first video. Browsers don't play sound until someone has tapped something, so one of the two is needed.
- **Watching is recorded the same way as on other kinds of site** (`video.watched`, ADR 94), with each spell ending when they swipe on. Since one post is on screen at a time, `content.viewed` is that post's time on screen.
- **Its sample content** is nine short clips cut from NASA's public-domain footage, credited in each post and in the starter's `CREDITS.md`. Their sound is replaced, since NASA's videos sometimes use licensed music.

## Alternatives considered

- **Autoplaying with sound.** It's what the apps do once someone has used them. Browsers forbid it until the person has tapped the page, and the error is silent, so a study would get videos that don't play.
- **A setting per video for sound.** More control. But what researchers vary is the experience of the site, and the browser's rule applies to the page, not the video.
- **Swiping between posts with a library** such as a carousel package. It's one scrolling column with snap points, which browsers do themselves, and works with a keyboard and a screen reader.
- **Showing only video posts.** Cleaner. But a study that changes kind of site part way through its design would lose its other posts without warning.

## Consequences

- **Two things are new for a kind of site:** a way to go through posts one at a time, and a setting about sound. Both are only used by this kind for now. The watch-page kind (like YouTube), which comes next, will use the sound setting.
- **The sample is NASA footage.** It was first eight clips Truman drew itself. On 2026-11-23 Dominic asked for public-domain video in their place. VidShare's science clips were considered and mostly left out: most are credited to channels such as BBC Earth and National Geographic, so they can't be shared in a public repository. Its one NASA clip is used.
- **The clips add about 22 MB to the repository.** Each is cut to 20 to 25 seconds at a phone's size to keep that down.
