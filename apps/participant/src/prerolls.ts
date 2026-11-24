import type { FeedPost } from "@truman3/core";
import type { FlowState, PrerollAd } from "./api.ts";

// Counted for the visit, as someone moves from video to video (ADR 97).
let videosOpened = 0;
let adsShown = 0;

/**
 * Whether this video gets an ad before it, and which. Called once each time someone opens a video.
 * A video can say it always or never has one. Otherwise it's one before every `every` videos they
 * open in this visit, and the condition's ads take turns.
 */
export function prerollFor(post: FeedPost, prerolls: FlowState["prerolls"]): PrerollAd | null {
  if (!prerolls || post.attachments[0]?.type !== "video") {
    return null;
  }
  videosOpened += 1;
  const wanted =
    post.preroll === "always" || (post.preroll !== "never" && videosOpened % prerolls.every === 0);
  if (!wanted || prerolls.ads.length === 0) {
    return null;
  }
  const ad = prerolls.ads[adsShown % prerolls.ads.length] ?? null;
  adsShown += 1;
  return ad;
}
