# 94. A post can have a video

## Context

Dominic picked short-video sites as a feature on 2026-11-17: one like TikTok and one like YouTube. On those sites people mostly watch, comment, and follow. They rarely post videos of their own. So researchers add the videos and participants watch them. His answers on 2026-11-18 set the limits: up to 10 minutes and 200 MB, with the swipe kind built first.

Before either kind of site, a video has to be something a post can hold. ADR 24 made a post's files a list of typed attachments so video could join images later. This is that step. It shows videos in the four kinds of site there are now, which proves the path before a site is built around it.

## Decision

- **A video is an attachment of type `video`,** with its stored key, an optional poster picture, and what the file says about itself: its length, its width and height, and whether it has sound. A post has a video or photos, not both.
- **Truman doesn't convert videos.** Every browser has to be able to play the file as it is, so it has to be an MP4 encoded as H.264. QuickTime files and HEVC are refused, with a message that says how to export one that works.
- **Truman reads the file's own description** (its `moov` box) to check it, with no video library. It reads only that part, from storage, so a 200 MB video is never loaded to check it.
- **In the builder, the video goes straight to storage as it uploads,** under a temporary name nothing serves. It's checked there, then copied to `media/` under the checksum of its contents, like a picture. The server never holds it in memory. The page shows how much has uploaded.
- **The poster is a frame taken in the researcher's browser,** a second in, and uploaded as a picture. A study folder can name its own in a `poster` column.
- **In a study folder,** a post has a `video` column naming an MP4 in `media/posts`. `pnpm study import` checks each one as it stores it. Packs, starters and replication bundles check them the same way.
- **Videos can't come through the sheets zip.** A zip is capped at 200 MB unzipped, the size of one video. The upload says to add the video in the builder.
- **On the four current kinds of site, a video plays when it's pressed,** with the browser's own controls, and stops when it's scrolled away.
- **Watching is recorded as `video.watched`,** one event per spell of watching, sent when the video leaves the screen or the page closes. It has time spent playing, how far into the video they got, how many times it reached the end, plays, pauses, seeks, and whether the sound was ever on.

## Alternatives considered

- **Converting videos with a service** (AWS MediaConvert or ffmpeg in a task), to any format and several sizes. It would take any file and save data on phones. It's another service with its own costs and failure modes. H.264 MP4 is what most editors export by default. If phones struggle, this can come later, and the attachment already has room for it.
- **Uploading straight from the browser to S3** with a signed address. Nothing passes through the API. It needs the bucket to accept uploads from browsers (CORS), and a second step to check the file. Streaming through the API keeps one path, works the same locally, and changes nothing in AWS.
- **Checking videos with a library** such as mp4box. It's a large dependency to read a few numbers. The boxes Truman needs are a short, documented format.
- **Trusting the browser's report** of a video's length. It can't be trusted from a request, and a study folder has no browser.
- **Reporting watching every few seconds,** as a stream of positions. Exact, but far more events, and harder to analyze. One summary per spell of watching answers the questions researchers ask: did they watch it, how much, and did they come back to it.

## Consequences

- **Videos aren't captioned yet.** A `.vtt` file per video is planned. Until then, a study that needs captions needs them burned into the video.
- **Videos don't count toward a lab's storage limit yet.** They should, before hosted labs use them much.
- **A replication bundle with videos can be bigger than 200 MB,** which is the most the admin app loads. A bigger one can be written, and not yet loaded.
- **Starting muted, autoplaying, and sound settings** belong to the swipe kind of site, which comes next. On the current kinds, a participant presses play, so sound plays.
- **Every browser that runs Truman plays H.264**, including the one the browser tests use, which is checked.
