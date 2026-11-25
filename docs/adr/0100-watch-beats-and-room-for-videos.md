# 100. Beats that wait for watching, and a lab's room for videos

## Context

Two things were left open when video arrived (ADR 94 to 97).

The video design note, which Dominic approved on 2026-11-18, said a beat should be able to wait for watching, such as "when they've watched this video for 10 seconds", because that's what makes a question right after a video possible (ADR 89).

And ADR 94 said videos don't count toward a lab's storage limit, and should before hosted labs use them much. A video can be 200 MB, and nothing stopped a lab uploading any number of them.

## Decision

### A beat can wait for watching

- **`when: { participant: watch }`** joins the other things a participant does that set a beat off.
  - `post` names one of the study's posts. Without it, any video.
  - `seconds` is how much of it they've watched in all, added up over every spell. `finished: true` waits for it to reach its end. With neither, any watching at all.
  - `on` works as for other actions: only videos by that person.
- **It happens once for each video,** when a spell of watching takes them past the mark. The server adds up the `video.watched` events it has for that person and video, before and after the new one.
- **The player now reports a spell when a video reaches its end,** as well as when it leaves the screen or the page closes, and the participant app sends it at once. So a beat waiting for the end follows within a few seconds.
- **Validate** checks that the post exists and has a video, and warns if the mark is longer than the video.

### A lab's videos count toward a limit

- **A new limit, `videosGb`,** on the videos a lab's researchers upload in the builder, for posts and for ads. A hosted lab starts with 20 GB. No number means no limit, as for a team made on the server. An operator changes it on the Labs page. The Demos team gets none.
- **Each upload is recorded** in `team_videos`: the lab, the file's key, and its size. A video counts once for a lab, however many studies use it.
- **An upload that wouldn't fit is refused before any of it is taken in,** with a message saying how much is used.
- **Your lab and the Labs page show what's used.**
- **Migration 0070** adds the table, and gives the 20 GB limit to hosted labs that were approved before it existed.

## Alternatives considered

- **Reporting watching every few seconds,** so a mark part way through is noticed at that second. It's many more events for every participant, for one kind of beat. A study that needs the moment can cut its video there, or use `finished`.
- **A beat for every spell of watching,** not once for each video. A looping short video would set it off over and over.
- **Counting videos from what studies use,** by reading every version and draft. It would give room back when a video is taken off a post. But it's slow, and a video's file stays in storage either way, since files are kept by their contents and shared. Recording uploads is simple and counts what's really stored.
- **One limit for photos and videos together.** Participants' photos and researchers' videos fill up for different reasons, and a lab running out of one shouldn't stop the other.

## Consequences

- **Taking a video off a post doesn't give its room back.** Nothing deletes a study's media yet. If labs reach their limit by trying things out, an operator raises it.
- **Videos brought in from the command line, or in a replication bundle, aren't counted.** Only uploads in the builder are.
- **A mark part way through a long video is noticed when they stop watching,** not at that second.
