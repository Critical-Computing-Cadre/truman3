export interface DeviceSummary {
  device: "phone" | "tablet" | "desktop" | "unknown";
  browser: string;
}

/**
 * Reduces a browser's user agent to a coarse summary. The full string can help identify a
 * specific person, so it isn't stored.
 */
export function summarizeDevice(userAgent: string | undefined): DeviceSummary {
  if (!userAgent) {
    return { device: "unknown", browser: "unknown" };
  }

  let device: DeviceSummary["device"] = "desktop";
  if (
    /iPad|Tablet/i.test(userAgent) ||
    (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))
  ) {
    device = "tablet";
  } else if (/Mobi|iPhone|Android/i.test(userAgent)) {
    device = "phone";
  }

  let browser = "other";
  if (/Edg\//.test(userAgent)) {
    browser = "Edge";
  } else if (/Firefox\/|FxiOS\//.test(userAgent)) {
    browser = "Firefox";
  } else if (/Chrome\/|CriOS\//.test(userAgent)) {
    browser = "Chrome";
  } else if (/Safari\//.test(userAgent)) {
    browser = "Safari";
  }

  return { device, browser };
}
