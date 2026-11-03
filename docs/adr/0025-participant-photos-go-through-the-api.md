# 25. What participants upload goes through the API

## Context

Every image could be read by anyone with its address, through CloudFront. Photos participants upload are personal data, and CloudFront keeps copies, so a photo could still be served after a withdrawal deleted it. A withdrawal also deleted a whole world's uploads, which would remove other people's photos once worlds are shared.

## Decision

- **Uploads are served at `/api/media/uploads/...`.** The API answers only someone signed in to the same world, or a researcher on the team that owns the study. Everyone else gets the same 404, whether or not the file exists.
- **CloudFront can't reach them.** It has no `/uploads/*` path, and its permission on the media bucket covers only `media/*`. It doesn't cache `/api`, so deleting a file takes effect at once. Browsers may keep a copy for an hour.
- **Uploads are stored by person,** at `uploads/<world>/<participant>/`, and a withdrawal deletes only that folder.
- **Study images stay at `/media/*`,** cached, and readable by anyone with the address. Their names come from a hash of the file, so they can't be listed or guessed.
- **On a stage with real data, old versions of files expire after 7 days,** so a deleted photo doesn't outlast a withdrawal for long.

## Alternatives

- **Signed CloudFront links or cookies.** Faster at large scale, but they add a key to keep and rotate, and CloudFront keeps copies after deletion. This is probably right for video.
- **Short-lived S3 links.** Anyone holding one can use it until it expires, and images would come from a second address.

## Consequences

Each photo passes through the API container, up to 10 MB at a time, and this hasn't been load tested. Researchers can open a photo only while signed in, and the data download still lists file names, not the photos. Uploads made before this change sit outside anyone's folder, so a withdrawal won't find them. Only development data has any.
