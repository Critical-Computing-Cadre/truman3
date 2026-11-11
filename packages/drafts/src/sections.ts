import { type StudySettings, studySettingsSchema } from "@truman3/core";
import { z } from "zod";

const { shape } = studySettingsSchema;

/**
 * Settings are saved a section at a time, as items in the draft, the same way a post is. So they get
 * the same history and undo, and two people changing different sections never collide.
 */
export const SETTINGS_SECTIONS = {
  study: z.strictObject({ title: shape.title, site: shape.site, platform: shape.platform }),
  /** With shared worlds, since a world's condition is part of how people are assigned. */
  conditions: z.strictObject({ conditions: shape.conditions, worlds: shape.worlds }),
  feed: z.strictObject({ feed: shape.feed, likes: shape.likes, length: shape.length }),
  flow: z.strictObject({ flow: shape.flow, entry: shape.entry }),
};

export type SectionName = keyof typeof SETTINGS_SECTIONS;

export const isSectionName = (section: string): section is SectionName =>
  Object.hasOwn(SETTINGS_SECTIONS, section);

const PAGE_PREFIX = "page:";

/** A page's text is its own section, because it's long and people work on them separately. */
export const pageSection = (key: string) => `${PAGE_PREFIX}${key}`;
export const pageKeyOf = (section: string) =>
  section.startsWith(PAGE_PREFIX) ? section.slice(PAGE_PREFIX.length) : null;

export const pageKeySchema = z.string().regex(/^[\w./-]{1,100}$/);
export const pageTextSchema = z.string().trim().min(1, "A page can't be empty.");

export interface SectionItem {
  section: string;
  /** Null for a page that didn't exist before this change, so undoing it removes the page again. */
  value: unknown;
}

export interface SectionState {
  revision: number;
  value: unknown;
}

/** The part of the settings a section covers. */
export function sectionValue(settings: StudySettings, section: SectionName): unknown {
  const keys = Object.keys(SETTINGS_SECTIONS[section].shape) as (keyof StudySettings)[];
  return Object.fromEntries(keys.map((key) => [key, settings[key]]));
}

/** A draft's settings and pages: what it started with, plus each section that's been saved since. */
export function applySections(
  baseSettings: unknown,
  basePages: Record<string, string>,
  rows: readonly { data: unknown; revision: number }[],
) {
  const raw = { ...(baseSettings as object) };
  const pages = { ...basePages };
  const sections = new Map<string, SectionState>();

  for (const { data, revision } of rows) {
    const { section, value } = data as SectionItem;
    sections.set(section, { revision, value });
    const pageKey = pageKeyOf(section);
    if (pageKey === null) {
      // What a section leaves out, like shared worlds turned off, is gone, not kept from before.
      if (isSectionName(section)) {
        for (const key of Object.keys(SETTINGS_SECTIONS[section].shape)) {
          delete (raw as Record<string, unknown>)[key];
        }
      }
      Object.assign(raw, value);
    } else if (value === null) {
      delete pages[pageKey];
    } else {
      pages[pageKey] = value as string;
    }
  }

  return { settings: studySettingsSchema.parse(raw), pages, sections };
}
