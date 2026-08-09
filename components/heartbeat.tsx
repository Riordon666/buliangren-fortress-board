"use client";

import { useEffect } from "react";

export function Heartbeat() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === "visible") {
        void fetch("/api/heartbeat", { method: "POST", cache: "no-store" });
      }
    };
    ping();
    const timer = window.setInterval(ping, 30_000);
    window.addEventListener("focus", ping);
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", ping);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

  return null;
}

