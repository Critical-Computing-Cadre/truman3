import { useEffect } from "react";

/**
 * Says this page has something of its own along the bottom of a phone's screen, like a box to
 * reply, so the sections that are there on other pages are left out (skins.css, ADRs 106 and 107).
 */
export function useNoTabs(page: "post" | "conversation") {
  useEffect(() => {
    document.documentElement.dataset.page = page;
    return () => {
      delete document.documentElement.dataset.page;
    };
  }, [page]);
}
