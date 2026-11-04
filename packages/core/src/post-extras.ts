import { z } from "zod";

/** Why a post stays covered until someone clicks it. */
export const POST_TAGS = ["spoiler", "adult"] as const;
export type PostTag = (typeof POST_TAGS)[number];

/** The lists a post can be kept on top of. */
export const PIN_PLACES = ["home", "space"] as const;
export type PinPlace = (typeof PIN_PLACES)[number];

export const MAX_LINK_LENGTH = 2000;

/**
 * The address a post can link to, tidied, or null if it can't be used. Only http and https, so a
 * link can't run a script, and nothing with a login in it, which can disguise where it really goes.
 * The server never fetches this.
 */
export function safeLink(raw: string): string | null {
  if (raw.length > MAX_LINK_LENGTH) {
    return null;
  }
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** The part of a safe link people recognize. */
export function linkDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

export const linkSchema = z
  .string()
  .refine((value) => safeLink(value) !== null, "A link has to be a full http or https address.");
