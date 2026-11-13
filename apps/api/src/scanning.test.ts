import { describe, expect, it } from "vitest";
import { readLabels, rekognitionScanner } from "./scanning.ts";

describe("reading what Rekognition says about a photo (ADR 79)", () => {
  it("flags nudity, violence, gore, and hate symbols, each named once", () => {
    expect(
      readLabels([
        { Name: "Explicit" },
        { Name: "Explicit Sexual Activity" },
        { Name: "Explicit" },
      ]),
    ).toEqual({ scan: "flagged", labels: ["Explicit"] });
    expect(readLabels([{ Name: "Violence" }, { Name: "Hate Symbols" }])).toEqual({
      scan: "flagged",
      labels: ["Violence", "Hate Symbols"],
    });
  });

  it("leaves alone what's ordinary on a social site", () => {
    expect(
      readLabels([{ Name: "Alcohol" }, { Name: "Swimwear or Underwear" }, { Name: "Gambling" }]),
    ).toEqual({ scan: "clear" });
    expect(readLabels([])).toEqual({ scan: "clear" });
  });
});

describe("the Rekognition scanner", () => {
  const scannerWith = (send: () => Promise<unknown>) => {
    const asked: unknown[] = [];
    const scanner = rekognitionScanner({
      region: "us-east-1",
      bucket: "photos",
      client: {
        send: (async (command: { input: unknown }) => {
          asked.push(command.input);
          return send();
        }) as never,
      },
    });
    return { scanner, asked };
  };

  it("has Rekognition read the photo from the bucket, and never sends the bytes itself", async () => {
    const { scanner, asked } = scannerWith(async () => ({
      ModerationLabels: [{ Name: "Visually Disturbing" }],
    }));

    expect(await scanner.scan("uploads/w/p/a.jpg", "jpg")).toEqual({
      scan: "flagged",
      labels: ["Visually Disturbing"],
    });
    expect(asked).toEqual([
      { Image: { S3Object: { Bucket: "photos", Name: "uploads/w/p/a.jpg" } }, MinConfidence: 60 },
    ]);
  });

  it("says a GIF or WebP can't be scanned, without asking", async () => {
    const { scanner, asked } = scannerWith(async () => ({}));

    expect(await scanner.scan("uploads/w/p/a.gif", "gif")).toEqual({
      scan: "unscanned",
      labels: ["A GIF can't be scanned"],
    });
    expect(asked).toHaveLength(0);
  });

  it("doesn't fail an upload when Rekognition does", async () => {
    const { scanner } = scannerWith(async () => {
      const error = new Error("no");
      error.name = "ThrottlingException";
      throw error;
    });

    expect(await scanner.scan("uploads/w/p/a.png", "png")).toEqual({
      scan: "unscanned",
      labels: ["The scan failed (ThrottlingException)"],
    });
  });
});
