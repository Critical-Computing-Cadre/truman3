import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Message } from "./Message.tsx";

/** Where a researcher's "try it" link lands. It signs in as the test participant, then starts. */
export function PilotPage() {
  const { token } = useParams({ from: "/pilot/$token" });
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    fetch("/api/pilot-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).then((response) => {
      if (response.ok) {
        navigate({ to: "/", replace: true });
      } else {
        setFailed(true);
      }
    });
  }, [token, navigate]);

  return failed ? <Message title="This link doesn't work." /> : null;
}
