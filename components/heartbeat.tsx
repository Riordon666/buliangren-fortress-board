"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function Heartbeat() {
  const router = useRouter();
  const lastPackageRevision = useRef<string | null>(null);
  useEffect(() => {
    const ping = async () => {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/heartbeat", { method: "POST", cache: "no-store" });
          if (!response.ok) return;
          const result = await response.json() as { packageRevision?: string };
          if (result.packageRevision && lastPackageRevision.current && result.packageRevision !== lastPackageRevision.current) {
            router.refresh();
          }
          if (result.packageRevision) lastPackageRevision.current = result.packageRevision;
        } catch {
          // 网络恢复后，下一次心跳会自动补上在线状态与发包状态。
        }
      }
    };
    void ping();
    const runPing = () => { void ping(); };
    const timer = window.setInterval(runPing, 60_000);
    window.addEventListener("focus", runPing);
    document.addEventListener("visibilitychange", runPing);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", runPing);
      document.removeEventListener("visibilitychange", runPing);
    };
  }, [router]);

  return null;
}
