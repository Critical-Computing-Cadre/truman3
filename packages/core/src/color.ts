/** A community's color. Only this form is accepted, so nothing else can reach a style. */
export const ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** How bright a color is to the eye, by the WCAG formula. */
function luminance(hex: string): number {
  const channel = (start: number) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** How far apart two colors are, by the WCAG formula, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * What to write on top of a community's color. Whichever of black or white stands out more always
 * reaches at least 4.5 to 1, which is why a study can pick any color. Don't use an accent as text on
 * the page, since nothing checks that.
 */
export function textOnAccent(accent: string): "#000000" | "#ffffff" {
  return contrast(accent, "#ffffff") >= contrast(accent, "#000000") ? "#ffffff" : "#000000";
}
