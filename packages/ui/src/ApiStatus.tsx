import { healthResponseSchema } from "@truman3/core";
import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "unreachable";

const LABELS: Record<Status, string> = {
  checking: "Checking API…",
  connected: "API connected",
  unreachable: "API unreachable",
};

/** Shows whether this app can reach the API. */
export function ApiStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => {
        healthResponseSchema.parse(body);
        setStatus("connected");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus("unreachable");
        }
      });

    return () => controller.abort();
  }, []);

  return <p role="status">{LABELS[status]}</p>;
}
