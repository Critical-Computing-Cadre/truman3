/**
 * Measures how long something has been on screen. Time only counts while it's both visible and the
 * tab is in front. Every view gets reported, however short: any minimum gets applied at analysis.
 */
export function createDwellTimer(now: () => number = Date.now) {
  let inView = false;
  let tabVisible = true;
  let startedAt: number | null = null;

  const update = (): number => {
    const shouldRun = inView && tabVisible;
    if (shouldRun && startedAt === null) {
      startedAt = now();
      return 0;
    }
    if (!shouldRun && startedAt !== null) {
      const elapsed = now() - startedAt;
      startedAt = null;
      return elapsed;
    }
    return 0;
  };

  return {
    /** Each of these returns the time of a view that just ended, or 0 if none did. */
    setInView: (value: boolean) => {
      inView = value;
      return update();
    },
    setTabVisible: (value: boolean) => {
      tabVisible = value;
      return update();
    },
  };
}
