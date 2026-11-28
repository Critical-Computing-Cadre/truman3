// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBarsThatHide } from "./bars.ts";

function Page({ on }: { on: boolean }) {
  useBarsThatHide(on);
  return null;
}

/** Moves the page to a place, the way a finger would. */
function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  window.dispatchEvent(new Event("scroll"));
}

const bars = () => document.documentElement.dataset.bars;

/** On a phone the bars slide away going down the page, and come back going up (skins.css). */
describe("bars that hide while someone scrolls", () => {
  afterEach(() => {
    cleanup();
    scrollTo(0);
  });

  it("hide going down, and come back on the way up", () => {
    render(<Page on />);
    expect(bars()).toBeUndefined();
    scrollTo(300);
    expect(bars()).toBe("hidden");
    scrollTo(600);
    expect(bars()).toBe("hidden");
    // Any real move up brings them back, long before the top.
    scrollTo(560);
    expect(bars()).toBeUndefined();
  });

  it("stay while the page is near its top, or has barely moved", () => {
    render(<Page on />);
    scrollTo(40);
    expect(bars()).toBeUndefined();
    scrollTo(300);
    expect(bars()).toBe("hidden");
    // A wobble of a few pixels changes nothing.
    scrollTo(296);
    expect(bars()).toBe("hidden");
    scrollTo(20);
    expect(bars()).toBeUndefined();
  });

  it("do nothing on a kind of site that keeps its bars, and tidy up when the page goes", () => {
    const still = render(<Page on={false} />);
    scrollTo(500);
    expect(bars()).toBeUndefined();
    still.unmount();
    scrollTo(0);
    const moving = render(<Page on />);
    scrollTo(500);
    expect(bars()).toBe("hidden");
    moving.unmount();
    expect(bars()).toBeUndefined();
  });
});
