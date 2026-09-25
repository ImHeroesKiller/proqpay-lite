"use client";

import { useEffect, useState } from "react";
import packageInfo from "../../package.json";
import { serviceStateLabel, useServiceHealth } from "@/lib/service-health";

type Props = {
  lastSyncAt?: number;
  onSupport: () => void;
};

const BUILD_SHA =
  process.env.NEXT_PUBLIC_BUILD_SHA ||
  process.env.NEXT_PUBLIC_CF_PAGES_COMMIT_SHA ||
  "";

function syncLabel(value: number | undefined, now: number) {
  if (!value) return "Belum sinkron";
  const minutes = Math.max(0, Math.round((now - value) / 60000));
  return minutes < 1 ? "Sync baru saja" : `Sync ${minutes}m lalu`;
}

export default function AppFooter({ lastSyncAt, onSupport }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const { health } = useServiceHealth();
  const stateLabel = serviceStateLabel(health);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const version = `v${packageInfo.version}`;
  const build = BUILD_SHA ? BUILD_SHA.slice(0, 7) : "";

  return (
    <footer className="app-footer" aria-label="Informasi aplikasi">
      <span>
        <strong>ProQPay</strong>
        <i aria-hidden="true">·</i>
        Production · {stateLabel}
        <i aria-hidden="true">·</i>
        {version}{build ? ` · ${build}` : ""}
      </span>
      <span>{syncLabel(lastSyncAt, now)}</span>
      <button type="button" onClick={onSupport}>Support</button>
    </footer>
  );
}
