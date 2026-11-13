# 79. Scanning the photos participants upload

## Context

Participants can upload photos: on posts, in stories, and as profile pictures and banners. On a hosted Truman the host stores them, and the demos (ADR 78) let anyone on the internet upload one. Nothing looked at them.

Dominic chose Amazon Rekognition for this, over matching against known abuse images (PhotoDNA, Thorn's Safer), as proportionate to what Truman is. In most studies a participant's photo is seen only by them and the study's researchers. Shared worlds (ADR 67) are the exception: there, other participants see it.

Until now an upload was only a file. Nothing recorded that it existed, how big it was, or who it belonged to, except its path.

## Decision

- **Every upload gets a row in `uploads`:** its key, world, participant, size, and what a scan said. It goes when its participant or its world does, so a withdrawal and a demo's clean-up need nothing more.
- **With `PHOTO_SCANNING=rekognition`, each photo is scanned as it's uploaded.** The API asks Rekognition to read the photo from the bucket it's already in, with the API's own permission to. The bytes aren't sent again.
- **A photo is flagged for nudity, violence, gore, or hate symbols,** at 60% confidence or more. Rekognition also names alcohol, tobacco, gambling, swimwear, and rude gestures. Those are ordinary on a social site, and a study about them shouldn't have its photos held, so they're left alone.
- **An upload is never refused because of a scan.** Refusing tells the participant something a real site often wouldn't, and a wrong flag would lose a participant's post.
- **In a shared world, a flagged photo is held.** Whoever uploaded it still sees it. Everyone else in their world gets a gray stand-in that says "This photo is being reviewed." Researchers see the real photo.
- **In a world of someone's own, a flagged photo is only listed for the researchers.** Nobody else can see it anyway.
- **A photo that couldn't be scanned is treated as flagged.** Rekognition reads JPEG and PNG, so that's every GIF and WebP, and any photo uploaded while Rekognition is failing. The list says why.
- **A researcher decides,** on the Monitor page's **Photos to look at** card: release it, or remove it. Removing deletes the file and shows everyone "This photo was removed." Each photo is covered until the researcher asks to see it. A viewer can look and can't decide.
- **Hosted stages turn it on,** and get the one permission it needs, `rekognition:DetectModerationLabels`. A lab's own Truman has it off unless it sets the variable. With it off, uploads are still recorded, as `unscanned`, and nothing is held or listed.

## Alternatives considered

- **Matching against known abuse images** (PhotoDNA, Thorn's Safer). The right tool for a public site with strangers' uploads. It needs an application that takes weeks, or a paid service, and reporting duties to go with it. It can be added beside this: the `uploads` table is where its answer would go.
- **No participant uploads on hosted Truman.** Safe, and it takes away a photo app's main action.
- **Refusing a flagged upload.** See above.
- **Holding flagged photos in every world.** In a world of someone's own there's nobody to hold it from.
- **Hiding a held photo's post from other participants.** The post's words weren't flagged, and hiding a whole post changes the conversation more than a stand-in for its picture does.
- **Sending the bytes to Rekognition.** It takes at most 5 MB that way, and uploads can be 10 MB.
- **Recording each scan as an event.** Events are what participants did and saw. A scan is something the host did to a file. A researcher who wants it in their data can be given it from `uploads` later.

## Consequences

- **By default, Amazon may keep what its AI services are sent and use it to improve them.** Opting out is an "AI services opt-out policy" set in AWS Organizations, on the account, by its owner. Until that's set for the hosted account, scanned photos fall under the default. The site says so.
  - **Since 2026-11-13 the hosted Truman's organization has that policy,** attached to its Root, so both of its accounts are opted out.
- The scan is wrong sometimes, both ways. The guide tells researchers it's a prompt to look.
- An upload now takes as long as a scan, usually well under a second.
- Photos uploaded before this have no row. They're served as before and were never scanned.
- A held photo's uploader isn't told. If a researcher removes it, they see that it was removed, with no reason given.
- A browser that already loaded a photo may keep showing it for up to an hour after it's removed, as after a withdrawal.
- The storage limit for each lab, planned with this, isn't here. `uploads.bytes` is what it will add up.
