import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TEMPLATES } from "@truman3/core";
import { afterEach, describe, expect, it } from "vitest";
import { FeedFrame } from "../PageFrames.tsx";
import { PlatformProvider } from "../platform.tsx";

// How videos that play by themselves get their sound (ADR 95).
const platform = (videoSound: "tap" | "askFirst") => ({
  layout: "short-video" as const,
  features: TEMPLATES.shortVideo.features,
  videoSound,
});
const feed = (videoSound: "tap" | "askFirst") =>
  render(
    <PlatformProvider platform={platform(videoSound)}>
      <FeedFrame renderProfile={() => null}>
        <article>a video</article>
      </FeedFrame>
    </PlatformProvider>,
  );

describe("a short-video feed", () => {
  afterEach(cleanup);

  it("starts at once, without sound, by default", () => {
    feed("tap");
    expect(screen.queryByRole("button", { name: "Tap to start watching" })).toBeNull();
    expect(screen.getByLabelText("Videos")).toBeTruthy();
  });

  it("asks for a tap first when the study says, and is gone once there's been one", () => {
    feed("askFirst");
    fireEvent.click(screen.getByRole("button", { name: "Tap to start watching" }));
    expect(screen.queryByRole("button", { name: "Tap to start watching" })).toBeNull();
    // Sound is on from then, so it isn't asked again, even on another page of the feed.
    cleanup();
    feed("askFirst");
    expect(screen.queryByRole("button", { name: "Tap to start watching" })).toBeNull();
  });
});
