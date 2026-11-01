# 8. SeaweedFS for local file storage

**Status:** Accepted

## Decision

Local development uses SeaweedFS as its S3-compatible store. Code talks to it through the S3 API only, so it can use AWS S3 in the cloud without changes.

## Why

The original plan was MinIO, but its open-source repository is archived and marked as no longer maintained. SeaweedFS is actively maintained and starts with a single command.

## Alternatives

- **MinIO:** see above.
- **RustFS:** also active, but newer.
- **Plain local files:** code would need a separate path for development and production.
