import { useMutation } from "@tanstack/react-query";
import { Avatar } from "@truman3/ui";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

export interface ProfileFields {
  username: string;
  name: string;
  location: string;
  bio: string;
}

/** A picture they've just chosen, to show before it's saved. */
function usePreview(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);
  return url;
}

/** Looks like a button, and opens the phone's or computer's own way of choosing a picture. */
const CHOOSE =
  "cursor-pointer rounded-full bg-stone-200 px-4 py-2 text-sm font-semibold focus-within:outline-2";

/** The form for someone's profile, both when first filling it in and when changing it later. */
export function ProfileForm({
  initial,
  pictureUrl,
  bannerUrl,
  submitLabel,
  save,
  children,
}: {
  initial: ProfileFields;
  /** Their picture now, if they already have a profile to change. */
  pictureUrl?: { url: string | null; seed: string };
  /** Their banner now, on a layout whose profiles have one. Leave out where they don't. */
  bannerUrl?: { url: string | null };
  submitLabel: string;
  save: (fields: ProfileFields & { picture?: File; banner?: File }) => Promise<void>;
  /** Anything to put beside the save button. */
  children?: ReactNode;
}) {
  const [fields, setFields] = useState(initial);
  const [picture, setPicture] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const picturePreview = usePreview(picture);
  const bannerPreview = usePreview(banner);

  const saving = useMutation({
    mutationFn: () =>
      save({ ...fields, ...(picture ? { picture } : {}), ...(banner ? { banner } : {}) }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    saving.mutate();
  };

  const change = (field: keyof ProfileFields, value: string) =>
    setFields({ ...fields, [field]: value });

  const field = "rounded border border-stone-300 px-3 py-2 text-base";
  const labelClass = "flex flex-col gap-1 font-medium";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className={labelClass}>
        Username
        <input
          required
          pattern="[A-Za-z0-9_.\-]{1,30}"
          title="Letters, numbers, dots, dashes, and underscores"
          value={fields.username}
          onChange={(event) => change("username", event.target.value)}
          className={field}
        />
      </label>
      <label className={labelClass}>
        Name
        <input
          required
          value={fields.name}
          onChange={(event) => change("name", event.target.value)}
          className={field}
        />
      </label>
      <label className={labelClass}>
        Location
        <input
          value={fields.location}
          onChange={(event) => change("location", event.target.value)}
          className={field}
        />
      </label>
      <label className={labelClass}>
        Bio
        <textarea
          rows={3}
          value={fields.bio}
          onChange={(event) => change("bio", event.target.value)}
          className={field}
        />
      </label>
      <label className={labelClass}>
        Profile picture
        <span className="text-sm font-normal text-stone-500">
          Optional. If you skip it, one is made for you.
        </span>
        <span className="mt-1 flex items-center gap-4">
          {(pictureUrl || picturePreview) && (
            <Avatar
              seed={pictureUrl?.seed ?? fields.username}
              url={picturePreview ?? pictureUrl?.url ?? null}
              size="h-16 w-16"
            />
          )}
          <span className={CHOOSE}>
            {picture || pictureUrl?.url ? "Change photo" : "Choose a photo"}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setPicture(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </span>
        </span>
      </label>
      {bannerUrl && (
        <label className={labelClass}>
          Banner
          <span className="text-sm font-normal text-stone-500">
            Optional. A wide picture across the top of your profile.
          </span>
          {(bannerPreview ?? bannerUrl.url) && (
            <img
              src={bannerPreview ?? bannerUrl.url ?? ""}
              alt=""
              className="h-20 w-full rounded object-cover"
            />
          )}
          <span className={`${CHOOSE} mt-1 self-start`}>
            {banner || bannerUrl.url ? "Change banner" : "Choose a banner"}
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setBanner(event.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </span>
        </label>
      )}
      {saving.error && (
        <p role="alert" className="text-sm text-rose-700">
          {saving.error.message}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving.isPending}
          className="flex-1 rounded bg-accent-fill py-2.5 font-medium text-on-accent disabled:opacity-40"
        >
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}
