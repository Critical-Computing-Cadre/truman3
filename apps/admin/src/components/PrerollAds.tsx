import type { StudySettings } from "@truman3/core";
import { useState } from "react";
import { uploadWithProgress } from "../api.ts";

type Prerolls = NonNullable<StudySettings["platform"]["prerolls"]>;
type Ad = Prerolls["ads"][number];

const field = "flex flex-col gap-1 text-sm font-medium";
const input = "rounded border border-stone-300 px-2 py-1.5 font-normal";

/**
 * Pre-roll ads on a video site (ADR 97): how often one plays, how soon it can be skipped, and the
 * ads themselves, each a video the research team uploads. It edits the study's settings, which
 * save with the rest of the card.
 */
export function PrerollAds({
  draftId,
  value,
  set,
  conditions,
}: {
  draftId: string;
  value: Prerolls | undefined;
  set: (value: Prerolls | undefined) => void;
  conditions: string[];
}) {
  const prerolls: Prerolls = value ?? { every: 0, skipAfter: 5, ads: [] };
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const update = (next: Partial<Prerolls>) => set({ ...prerolls, ...next });
  const setAd = (index: number, ad: Ad) =>
    update({ ads: prerolls.ads.map((item, i) => (i === index ? ad : item)) });

  /** Stores a WebVTT file, checked as it goes in, and puts it on the ad (ADR 101). */
  const addCaptions = async (index: number, ad: Ad, file: File | undefined) => {
    if (!file) {
      return;
    }
    setProblem(null);
    try {
      const response = await fetch(`/api/admin/drafts/${draftId}/captions`, {
        method: "POST",
        headers: { "content-type": "text/vtt" },
        body: file,
      });
      const body = (await response.json()) as { captions?: string; error?: string };
      if (!response.ok || !body.captions) {
        setProblem(body.error ?? "That didn't work. Try again.");
        return;
      }
      setAd(index, { ...ad, captions: body.captions });
    } catch {
      setProblem("That didn't work. Try again.");
    }
  };

  const add = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setProblem(null);
    setProgress(0);
    try {
      const { video } = await uploadWithProgress<{
        video: {
          key: string;
          seconds?: number;
          width?: number;
          height?: number;
          hasSound?: boolean;
        };
      }>(`/admin/drafts/${draftId}/videos`, file, setProgress);
      const { key, ...videoDetails } = video;
      const taken = new Set(prerolls.ads.map(({ id }) => id));
      let n = prerolls.ads.length + 1;
      while (taken.has(`ad-${n}`)) {
        n += 1;
      }
      update({
        ads: [
          ...prerolls.ads,
          { id: `ad-${n}`, video: key, advertiser: "", label: "Ad", conditions: [], videoDetails },
        ],
      });
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <fieldset className="space-y-3 rounded border border-stone-200 p-3">
      <legend className="px-1 text-sm font-semibold">Pre-roll ads</legend>
      <p className="text-sm text-stone-600">
        An ad that plays before a video opens. Each condition can have its own, in Conditions.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          How often
          <select
            value={prerolls.every}
            onChange={(event) => update({ every: Number(event.target.value) })}
            className={input}
          >
            <option value={0}>No ads</option>
            <option value={1}>Before every video</option>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Before every {n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`} video
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Skipping
          <select
            value={String(prerolls.skipAfter)}
            onChange={(event) =>
              update({
                skipAfter: event.target.value === "never" ? "never" : Number(event.target.value),
              })
            }
            className={input}
          >
            {[0, 3, 5, 10, 15].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Skip straight away" : `Skip after ${n} seconds`}
              </option>
            ))}
            <option value="never">Can't be skipped</option>
          </select>
        </label>
      </div>
      <ul className="space-y-3">
        {prerolls.ads.map((ad, index) => (
          <li key={ad.id} aria-label={`Ad ${ad.id}`} className="space-y-2 rounded bg-stone-50 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={field}>
                Advertiser
                <input
                  required
                  value={ad.advertiser}
                  onChange={(event) => setAd(index, { ...ad, advertiser: event.target.value })}
                  className={input}
                />
              </label>
              <label className={field}>
                Label
                <input
                  required
                  maxLength={30}
                  value={ad.label}
                  onChange={(event) => setAd(index, { ...ad, label: event.target.value })}
                  className={input}
                />
              </label>
              <label className={field}>
                Visit site goes to (optional)
                <input
                  type="url"
                  value={ad.link ?? ""}
                  placeholder="https://"
                  onChange={(event) => {
                    const { link: _, ...rest } = ad;
                    setAd(index, event.target.value ? { ...rest, link: event.target.value } : rest);
                  }}
                  className={input}
                />
              </label>
            </div>
            {conditions.length > 1 && (
              <p className="flex flex-wrap items-center gap-3 text-sm">
                Plays in:
                {conditions.map((key) => (
                  <label key={key} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={ad.conditions.length === 0 || ad.conditions.includes(key)}
                      onChange={(event) => {
                        const now = ad.conditions.length === 0 ? conditions : ad.conditions;
                        const next = event.target.checked
                          ? [...now, key]
                          : now.filter((item) => item !== key);
                        setAd(index, {
                          ...ad,
                          conditions: next.length === conditions.length ? [] : next,
                        });
                      }}
                    />
                    {key}
                  </label>
                ))}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-3 text-sm">
              Captions
              <label className="cursor-pointer underline">
                {ad.captions ? "Replace captions" : "Add captions (.vtt)"}
                <input
                  type="file"
                  accept=".vtt,text/vtt"
                  aria-label={`${ad.captions ? "Replace" : "Add"} captions for ${ad.id}`}
                  className="sr-only"
                  onChange={(event) => {
                    addCaptions(index, ad, event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              {ad.captions && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    const { captions: _, ...rest } = ad;
                    setAd(index, rest);
                  }}
                >
                  Remove captions
                </button>
              )}
            </p>
            <button
              type="button"
              onClick={() => update({ ads: prerolls.ads.filter((_, i) => i !== index) })}
              className="btn btn-sm btn-danger-quiet"
            >
              Remove this ad
            </button>
          </li>
        ))}
      </ul>
      <label className="btn inline-flex w-fit cursor-pointer">
        {progress !== null
          ? progress < 1
            ? `Uploading... ${Math.round(progress * 100)}%`
            : "Checking the video..."
          : "Add an ad (MP4)"}
        <input
          type="file"
          accept="video/mp4"
          aria-label="Add an ad"
          className="sr-only"
          onChange={(event) => {
            add(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
      {problem && (
        <p role="alert" className="text-sm text-rose-800">
          {problem}
        </p>
      )}
    </fieldset>
  );
}
