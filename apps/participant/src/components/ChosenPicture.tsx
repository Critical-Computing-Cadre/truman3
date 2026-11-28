import { useEffect, useRef } from "react";

/** The longest side a preview is drawn at. A phone's photo is several times this. */
const LONGEST_SIDE = 1600;

/**
 * A picture someone has just chosen, shown before it's sent. It's drawn onto the page from the
 * file itself, and never given an address, so nothing they chose is ever read as a link.
 */
export function ChosenPicture({
  file,
  label,
  className,
}: {
  file: File;
  /** What it is, for a screen reader. */
  label: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    // A test's browser stand-in can't decode pictures. There it stays blank.
    if (typeof createImageBitmap !== "function") {
      return;
    }
    let gone = false;
    createImageBitmap(file)
      .then((picture) => {
        const drawing = canvas.current;
        if (!gone && drawing) {
          const scale = Math.min(1, LONGEST_SIDE / Math.max(picture.width, picture.height));
          drawing.width = Math.round(picture.width * scale);
          drawing.height = Math.round(picture.height * scale);
          drawing.getContext("2d")?.drawImage(picture, 0, 0, drawing.width, drawing.height);
        }
        picture.close();
      })
      .catch(() => {
        // Not a picture the browser can read. The server says so when it's sent.
      });
    return () => {
      gone = true;
    };
  }, [file]);
  return <canvas ref={canvas} role="img" aria-label={label} className={className} />;
}
