# 97. Pre-roll ads on a video site

## Context

Dominic put pre-roll ads in scope on 2026-11-18, and answered the design questions on 2026-11-24: ads are their own thing, written by the research team. How often they play and how soon they can be skipped are the team's choices, and can differ by condition. They're for the Video platform kind (ADR 96). Short video and the other kinds already have ads as posts in the feed, and since ADR 94 those can be videos, as Facebook's are.

## Decision

- **A pre-roll ad lives in the study's settings,** under `platform.prerolls.ads`. It has an id, a video, an optional poster, the advertiser, a label ("Ad" unless the study says), an optional link for Visit site, and the conditions it plays in.
- **How often:** `prerolls.every`, an ad before every Nth video someone opens in a visit. 1 is every video, and 0 is none.
- **Per video:** a video can say it always or never has one (`preroll` in `posts.csv`, or in the builder).
- **Which ad:** the condition's ads take turns.
- **Skipping:** `prerolls.skipAfter` is the seconds before Skip appears, or `never`.
- **By condition:** a condition can override `every` and `skipAfter` with `prerollEvery` and `prerollSkipAfter`, as other settings are overridden. Ads are limited to conditions as posts are.
- **Where it plays:** on a video's watch page, in the player's place, before the video. It says it's an ad and who it's from, counts down how long is left, has Visit site if there's a link, and has "Skip in 5" until skipping is allowed. It can't be sought. When it ends or is skipped, the video starts.
- **What's recorded:** `preroll.watched`, once per ad, against the video it came before. It has the ad, how long it played, its length, when they skipped (or null), whether it played to the end, whether they pressed Visit site, and whether sound was on.
- **Choosing happens in the browser,** from the condition's ads, which the participant's flow state includes. The count of videos opened is for the visit, so it starts again if the page reloads.
- **The ad videos** are uploaded and checked like any other video: H.264 MP4, up to 10 minutes and 200 MB. The Video platform sample has two drawn ads for made-up advertisers.

## Alternatives considered

- **Ads as posts with a flag,** reusing the post machinery. But a pre-roll isn't in the feed, has no author, comments, or likes, and would need hiding everywhere posts show.
- **Choosing on the server,** counting videos opened from the events. It would survive a reload. But it would also have to know the order of things that happen at the same moment: the page asks for the post at about the same time it records opening it. Counting in the browser is exact within a visit, and "every Nth video in a visit" is easy to explain.
- **Picking an ad at random.** Taking turns means every ad is seen about equally often, which is what a comparison between ads needs.
- **Mid-roll ads, part way through.** Not asked for. The same player and event could do it later.
- **Ads in `ads.csv`.** Ads have few fields, and live in the settings, so they're in `study.yaml`.

## Consequences

- **The count restarts with each visit.** A participant who reloads after their first video could see two videos in a row without an ad when `every` is 2. Ads can be set to "always" on chosen videos where that matters.
- **Turning autoplay on or off still isn't recorded,** and neither is what someone does while an ad plays besides skipping and Visit site.
- **An ad's sound follows the browser:** with sound after a click, without where the browser refuses.
