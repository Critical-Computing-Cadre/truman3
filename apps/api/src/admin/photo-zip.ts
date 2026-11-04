import type { Storage } from "@truman3/storage";
import type { ParticipantPhoto } from "@truman3/study-export";
import { Zip, ZipPassThrough } from "fflate";

const MANIFEST_HEADER = "file,participant_id,kind,content_id\n";

/**
 * A zip of these photos, one small piece at a time, so it needs no more memory for a thousand photos
 * than for one. They're stored as they are, since photos don't compress. It ends with photos.csv,
 * which ties each one to the data, and leaves out any file that's gone. See ADR 16.
 */
export async function* zipPhotos(
  storage: Pick<Storage, "get">,
  photos: readonly ParticipantPhoto[],
): AsyncGenerator<Uint8Array> {
  const ready: Uint8Array[] = [];
  const zip = new Zip((error, data) => {
    if (error) {
      throw error;
    }
    ready.push(data);
  });

  let manifest = MANIFEST_HEADER;
  for (const photo of photos) {
    const file = await storage.get(photo.key);
    if (!file) {
      continue;
    }
    const entry = new ZipPassThrough(photo.key);
    zip.add(entry);
    const reader = file.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      entry.push(value, false);
      yield* ready.splice(0);
    }
    entry.push(new Uint8Array(0), true);
    yield* ready.splice(0);
    manifest += `${photo.key},${photo.participantId},${photo.kind},${photo.contentId}\n`;
  }

  const list = new ZipPassThrough("photos.csv");
  zip.add(list);
  list.push(new TextEncoder().encode(manifest), true);
  zip.end();
  yield* ready.splice(0);
}

/** The same, as what a response can send. It stops reading if the browser goes away. */
export function photoZipStream(storage: Pick<Storage, "get">, photos: readonly ParticipantPhoto[]) {
  const pieces = zipPhotos(storage, photos);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await pieces.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    async cancel() {
      await pieces.return(undefined);
    },
  });
}
