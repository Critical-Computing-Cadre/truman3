import { describe, expect, it } from "vitest";
import { createDwellTimer } from "./dwell.ts";

function timerAt() {
  let time = 0;
  return { timer: createDwellTimer(() => time), advance: (ms: number) => (time += ms) };
}

describe("createDwellTimer", () => {
  it("reports how long something stayed in view", () => {
    const { timer, advance } = timerAt();

    expect(timer.setInView(true)).toBe(0);
    advance(2000);
    expect(timer.setInView(false)).toBe(2000);
  });

  it("reports very short views rather than dropping them", () => {
    const { timer, advance } = timerAt();

    timer.setInView(true);
    advance(50);
    expect(timer.setInView(false)).toBe(50);
  });

  it("doesn't count time while the tab is in the background", () => {
    const { timer, advance } = timerAt();

    timer.setInView(true);
    advance(1000);
    expect(timer.setTabVisible(false)).toBe(1000);
    advance(60_000);
    expect(timer.setTabVisible(true)).toBe(0);
    advance(500);
    expect(timer.setInView(false)).toBe(500);
  });

  it("doesn't start when the tab is hidden", () => {
    const { timer, advance } = timerAt();

    timer.setTabVisible(false);
    timer.setInView(true);
    advance(1000);
    expect(timer.setInView(false)).toBe(0);
  });

  it("ignores repeated signals", () => {
    const { timer, advance } = timerAt();

    timer.setInView(true);
    advance(100);
    expect(timer.setInView(true)).toBe(0);
    advance(100);
    expect(timer.setInView(false)).toBe(200);
    expect(timer.setInView(false)).toBe(0);
  });
});
