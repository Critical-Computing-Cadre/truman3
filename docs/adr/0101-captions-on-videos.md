# 101. Captions on videos

## Context

ADR 94 left captions out: a study that needed them had to burn them into the video. Captions matter for access, and on short-video sites most people watch with sound off, which is how videos start there (ADR 95). The video design note planned a `.vtt` file for each video, shown or hidden by the participant.

## Decision

- **A video can have captions, as a WebVTT file.** In a study folder, a `captions` column in `posts.csv` names a `.vtt` file in `media/posts`. In the builder, a video post's Details has **Add captions**, **Replace captions**, and **Remove captions**.
- **They're checked as they're stored:** text that starts with `WEBVTT`, up to 1 MB. Anything else is refused, with a note that SRT files need converting. They're kept under the checksum of their contents, like pictures and videos.
- **The video attachment carries them** (`captions`), so replication bundles, packs, and the library do too. A bundle's captions are checked the same way when it's loaded.
- **They're served by the API, at `/api/captions/<checksum>.vtt`.** A browser loads a video's captions only from the same address as the page, and media can be served from another, as it is in development. Only a stored captions file can be asked for. There's nobody to check, since captions are part of what a study shows everyone.
- **They show unless the participant turns them off.** Where a video has the browser's controls, that's its captions button. On Short video, which has none, there's a **Captions** button beside **Tap for sound**, and the choice holds for every video, as sound does.
- **`video.watched` says whether they were showing** (`captionsOn`), for a video that has them.

## Alternatives considered

- **Serving captions from storage, like pictures,** with a cross-origin setting on the video. It needs the storage service to allow it, which differs between development, a lab's own server, and AWS, and it would make the video itself load that way too.
- **Accepting SRT and converting it.** Friendlier. The two formats differ in small ways that are easy to get wrong, and tools that make captions export WebVTT.
- **Off unless turned on.** The usual default on video sites. On here, since Short video starts muted, and a researcher who added captions wants them seen. A setting can come if a study needs them off.
- **Several languages for a video.** One track for now. The attachment can hold more later.

## Consequences

- **Pre-roll ads don't have captions yet.**
- **The captions' language is marked as English** for the browser, whatever it is. It doesn't change what's shown.
- **How captions look is the browser's,** and differs a little between them.
