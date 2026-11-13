import { DetectModerationLabelsCommand, RekognitionClient } from "@aws-sdk/client-rekognition";

/** What a scan of one uploaded image said. */
export type ScanResult =
  | { scan: "clear" }
  /** `labels` is what it was flagged for. */
  | { scan: "flagged"; labels: string[] }
  /** It couldn't be scanned. `labels` holds the one reason. */
  | { scan: "unscanned"; labels: string[] };

/** Looks at an image that's already in storage, by its key. It never throws. */
export interface PhotoScanner {
  scan(key: string, extension: string): Promise<ScanResult>;
}

/**
 * What a photo is flagged for (ADR 79): nudity, violence, gore, and hate symbols. Rekognition also
 * names alcohol, tobacco, gambling, swimwear, and rude gestures, which are ordinary on a social
 * site and are left alone. The second name for nudity is from an older list, in case it comes back.
 */
export const FLAGGED_FOR = [
  "Explicit",
  "Explicit Nudity",
  "Non-Explicit Nudity of Intimate parts and Kissing",
  "Violence",
  "Visually Disturbing",
  "Hate Symbols",
];

/** How sure Rekognition has to be, out of 100, before a label counts. */
const MIN_CONFIDENCE = 60;

/** What Rekognition's reply means for us. Apart from the call, so it can be tested without AWS. */
export function readLabels(labels: { Name?: string | undefined }[]): ScanResult {
  const found = [
    ...new Set(labels.map(({ Name }) => Name ?? "").filter((name) => FLAGGED_FOR.includes(name))),
  ];
  return found.length > 0 ? { scan: "flagged", labels: found } : { scan: "clear" };
}

/**
 * Amazon Rekognition's image moderation. It reads the image from the bucket itself, with this
 * server's own permission to, so nothing is sent anywhere it isn't already. It takes JPEG and PNG.
 */
export function rekognitionScanner({
  region,
  bucket,
  client = new RekognitionClient({ region }),
}: {
  region: string;
  bucket: string;
  client?: Pick<RekognitionClient, "send">;
}): PhotoScanner {
  return {
    async scan(key, extension) {
      if (extension !== "jpg" && extension !== "png") {
        return { scan: "unscanned", labels: [`A ${extension.toUpperCase()} can't be scanned`] };
      }
      try {
        const reply = await client.send(
          new DetectModerationLabelsCommand({
            Image: { S3Object: { Bucket: bucket, Name: key } },
            MinConfidence: MIN_CONFIDENCE,
          }),
        );
        return readLabels(reply.ModerationLabels ?? []);
      } catch (error) {
        // An upload isn't refused because the scanner is down. It's held or listed instead.
        const name = error instanceof Error ? error.name : "unknown";
        return { scan: "unscanned", labels: [`The scan failed (${name})`] };
      }
    },
  };
}
