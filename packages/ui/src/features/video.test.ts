import { describe, expect, it } from "vitest";
import { createWatchMeter } from "./video.tsx";

describe("createWatchMeter", () => {
  const clock = () => {
    let time = 0;
    return { now: () => time, pass: (ms: number) => (time += ms) };
  };

  it("counts only the time it's playing, and how far they got", () => {
    const { now, pass } = clock();
    const meter = createWatchMeter(30, now);
    expect(meter.take()).toBeNull();
    meter.playing();
    pass(4000);
    meter.at(4);
    meter.paused(true);
    pass(10_000);
    meter.playing();
    pass(2000);
    meter.at(6);
    expect(meter.take()).toEqual({
      playedMs: 6000,
      seconds: 30,
      furthestSeconds: 6,
      ended: 0,
      plays: 2,
      pauses: 1,
      seeks: 0,
      soundOn: false,
    });
  });

  it("starts again after each report, still counting while it plays", () => {
    const { now, pass } = clock();
    const meter = createWatchMeter(10, now);
    meter.playing();
    pass(1000);
    expect(meter.take()?.playedMs).toBe(1000);
    pass(500);
    expect(meter.take()).toMatchObject({ playedMs: 500, plays: 0 });
    meter.paused(false);
    expect(meter.take()).toBeNull();
  });

  it("doesn't count reaching the end, or being scrolled away, as a pause", () => {
    const { now, pass } = clock();
    const meter = createWatchMeter(10, now);
    meter.playing();
    pass(10_000);
    meter.paused(false);
    meter.ended();
    meter.sought();
    meter.playing();
    pass(1000);
    meter.paused(false);
    expect(meter.take()).toMatchObject({
      playedMs: 11_000,
      ended: 1,
      pauses: 0,
      seeks: 1,
      plays: 2,
    });
  });

  it("says sound was on only if it was on while playing", () => {
    const { now, pass } = clock();
    const muted = createWatchMeter(10, now);
    muted.sound(true);
    muted.sound(false);
    muted.playing();
    pass(100);
    expect(muted.take()?.soundOn).toBe(false);
    const heard = createWatchMeter(10, now);
    heard.playing();
    heard.sound(true);
    pass(100);
    expect(heard.take()?.soundOn).toBe(true);
  });
});
