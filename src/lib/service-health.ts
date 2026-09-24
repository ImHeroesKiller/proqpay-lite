"use client";

import { useCallback, useEffect, useState } from "react";

export type ServiceCheck = {
  key: string;
  label: string;
  status: "ok" | "warning" | "error";
  message: string;
  action?: string;
};

export type ServiceHealth = {
  status?: string;
  ready?: boolean;
  checks?: ServiceCheck[];
};

let cachedHealth: ServiceHealth | null = null;
let inflight: Promise<ServiceHealth> | null = null;
const listeners = new Set<(health: ServiceHealth) => void>();

function publish(health: ServiceHealth) {
  cachedHealth = health;
  listeners.forEach((listener) => listener(health));
}

export async function refreshServiceHealth(): Promise<ServiceHealth> {
  if (inflight) return inflight;
  inflight = fetch("/api/health", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
    .then(async (response) => {
      const result = (await response.json().catch(() => ({}))) as ServiceHealth;
      if (!response.ok) {
        return {
          status: "error",
          ready: false,
          checks: [{
            key: "health",
            label: "Koneksi layanan",
            status: "error",
            message: "Health-check mengembalikan status tidak siap.",
          }],
        } satisfies ServiceHealth;
      }
      return result;
    })
    .catch(() => ({
      status: "error",
      ready: false,
      checks: [{
        key: "network",
        label: "Koneksi layanan",
        status: "error",
        message: "Health-check tidak dapat dihubungi.",
        action: "Periksa koneksi internet atau deployment Cloudflare Pages.",
      }],
    } satisfies ServiceHealth))
    .then((health) => {
      publish(health);
      return health;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useServiceHealth(pollMs = 300_000) {
  const [health, setHealth] = useState<ServiceHealth | null>(cachedHealth);
  const refresh = useCallback(() => refreshServiceHealth(), []);

  useEffect(() => {
    const listener = (next: ServiceHealth) => setHealth(next);
    listeners.add(listener);
    if (cachedHealth) setHealth(cachedHealth);
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollMs);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      listeners.delete(listener);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pollMs, refresh]);

  return { health, refresh };
}

export function serviceState(health: ServiceHealth | null) {
  if (!health) return "checking" as const;
  if (health.ready === true) return "connected" as const;
  if ((health.checks || []).some((item) => item.status === "error")) return "offline" as const;
  return "degraded" as const;
}
