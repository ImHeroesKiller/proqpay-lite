"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconDashboard,
  IconUsers,
  IconBuilding,
  IconChart,
  IconSettings,
  IconTerminal,
  IconWallet,
  IconMessage,
  IconFile,
} from "./Icons";

const SettingsModal = dynamic(() => import("./SettingsModal"));

export type AppView =
  | "dashboard"
  | "operations"
  | "exceptions"
  | "payments"
  | "billing"
  | "integrations"
  | "employees"
  | "clients"
  | "reports"
  | "logs"
  | "ewa"
  | "portalAudit"
  | "portalSettings";

const ROLE_VIEWS: Record<string, AppView[]> = {
  SUPER_ADMIN: [
    "dashboard",
    "operations",
    "exceptions",
    "payments",
    "billing",
    "integrations",
    "employees",
    "clients",
    "reports",
    "logs",
    "ewa",
    "portalAudit",
    "portalSettings",
  ],
  PAYROLL_PROCESSOR: [
    "dashboard",
    "operations",
    "exceptions",
    "payments",
    "billing",
    "employees",
    "clients",
    "reports",
  ],
  PAYROLL_CONTROLLER: [
    "dashboard",
    "operations",
    "exceptions",
    "payments",
    "billing",
    "reports",
  ],
  CLIENT_USER: ["dashboard", "operations", "reports"],
};

export function allowedViewsForRole(role?: string) {
  return ROLE_VIEWS[role || ""] || ["dashboard"];
}

type Props = {
  view: AppView;
  onView: (view: AppView) => void;
  onOpenIda: () => void;
  onOpenHelp: () => void;
  role?: string;
  compact?: boolean;
  mobileOpen?: boolean;
  onMobileClose: () => void;
  settingsOpen: boolean;
  onSettingsOpen: (open: boolean) => void;
  lastSyncAt?: number;
  activePath?: "data-intake";
  period?: string;
};

export default function Sidebar({
  view,
  onView,
  onOpenIda,
  onOpenHelp,
  role,
  compact = false,
  mobileOpen = false,
  onMobileClose,
  settingsOpen,
  onSettingsOpen,
  lastSyncAt,
  activePath,
  period,
}: Props) {
  const allowed = new Set(allowedViewsForRole(role));
  const asideRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const go = (next: AppView) => {
    onView(next);
    onMobileClose();
  };
  const canIntake = [
    "SUPER_ADMIN",
    "PAYROLL_PROCESSOR",
  ].includes(role || "");
  const simplifiedInternal = ["PAYROLL_PROCESSOR","PAYROLL_CONTROLLER"].includes(role || "");
  const clientExperience = role === "CLIENT_USER";
  const [serviceState, setServiceState] = useState<"checking" | "connected" | "degraded" | "offline">("checking");
  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setServiceState("offline");
        return;
      }
      setServiceState(result.ready === true ? "connected" : "degraded");
    } catch {
      setServiceState("offline");
    }
  }, []);
  useEffect(() => {
    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), 300_000);
    const visible = () => {
      if (document.visibilityState === "visible") void refreshHealth();
    };
    document.addEventListener("visibilitychange", visible);
    useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = asideRef.current;
    const focusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) || [],
      );
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onMobileClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [mobileOpen, onMobileClose]);

  return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshHealth]);

  return (
    <>
      <button
        type="button"
        className={`sidebar-backdrop${mobileOpen ? " open" : ""}`}
        aria-label="Tutup navigasi"
        onClick={onMobileClose}
      />
      <aside
        ref={asideRef}
        className={`app-sidebar${compact ? " app-sidebar-compact" : ""}${mobileOpen ? " mobile-open" : ""}`}
        aria-label="Navigasi utama"
      >
        <div className="sidebar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="sidebar-brand-logo"
            src="/assets/proqpay-logo-v2.svg"
            alt="ProQPay"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="sidebar-brand-icon"
            src="/assets/proqpay-192.png"
            alt="ProQPay"
          />
          <button
            type="button"
            className="sidebar-mobile-close"
            aria-label="Tutup navigasi"
            onClick={onMobileClose}
          >
            ✕
          </button>
        </div>
        {clientExperience ? <NavGroup label="Workspace">
          <NavBtn
            active={view === "dashboard"}
            icon={<IconDashboard />}
            title="Home"
            onClick={() => go("dashboard")}
          />
          <NavBtn
            active={view === "operations"}
            icon={<IconWallet />}
            title="Payroll"
            onClick={() => go("operations")}
          />
          <NavBtn
            active={view === "reports"}
            icon={<IconFile />}
            title="Documents"
            onClick={() => go("reports")}
          />
        </NavGroup> : <>
        <NavGroup label="Overview">
          <NavBtn
            active={view === "dashboard"}
            icon={<IconDashboard />}
            title="Dashboard"
            onClick={() => go("dashboard")}
          />
        </NavGroup>
        <NavGroup label={simplifiedInternal ? "Work" : "Workflow"}>
          {allowed.has("clients") && !simplifiedInternal ? (
            <NavBtn
              active={view === "clients"}
              icon={<IconBuilding />}
              title="Clients & Projects"
              onClick={() => go("clients")}
            />
          ) : null}
          {canIntake ? (
            <Link
              className={`sidebar-nav-button${activePath === "data-intake" ? " sidebar-nav-active" : ""}`}
              href={period ? `/data-intake?period=${encodeURIComponent(period)}` : "/data-intake"}
              title="Data Intake"
              aria-label="Data Intake"
              aria-current={activePath === "data-intake" ? "page" : undefined}
              onClick={onMobileClose}
            >
              <IconFile />
              <span>Data Intake</span>
            </Link>
          ) : null}
          {allowed.has("exceptions") && role !== "CLIENT_USER" ? (
            <NavBtn
              active={view === "exceptions"}
              icon={<IconMessage />}
              title={simplifiedInternal ? "Issues" : "Data Readiness"}
              onClick={() => go("exceptions")}
            />
          ) : null}
          {allowed.has("operations") ? (
            <NavBtn
              active={view === "operations" && activePath !== "data-intake"}
              icon={<IconWallet />}
              title={role === "CLIENT_USER" ? "Payroll Status" : simplifiedInternal ? "Payroll" : "Pay Runs"}
              onClick={() => go("operations")}
            />
          ) : null}
          {allowed.has("payments") ? (
            <NavBtn
              active={view === "payments"}
              icon={<IconFile />}
              title={
                role === "CLIENT_USER"
                  ? "Payment Status"
                  : simplifiedInternal
                    ? "Payments"
                    : "Payment Instructions"
              }
              onClick={() => go("payments")}
            />
          ) : null}
          {allowed.has("billing") ? (
            <NavBtn
              active={view === "billing"}
              icon={<IconWallet />}
              title={role === "CLIENT_USER" ? "Invoices" : simplifiedInternal ? "Close & Billing" : "Billing & AR"}
              onClick={() => go("billing")}
            />
          ) : null}
        </NavGroup>
        <NavGroup label={simplifiedInternal ? "Reference & Reports" : "People & Insight"}>
          {allowed.has("clients") && simplifiedInternal ? (
            <NavBtn
              active={view === "clients"}
              icon={<IconBuilding />}
              title="Clients & Projects"
              onClick={() => go("clients")}
            />
          ) : null}
          {allowed.has("reports") ? (
            <NavBtn
              active={view === "reports"}
              icon={<IconChart />}
              title="Reports"
              onClick={() => go("reports")}
            />
          ) : null}
          {allowed.has("employees") ? (
            <NavBtn
              active={view === "employees"}
              icon={<IconUsers />}
              title="Employees"
              onClick={() => go("employees")}
            />
          ) : null}
        </NavGroup>
        {role === "SUPER_ADMIN" && (allowed.has("ewa") ||
        allowed.has("portalAudit") ||
        allowed.has("portalSettings")) ? (
          <NavGroup label="Employee Portal">
            {allowed.has("ewa") ? (
              <NavBtn
                active={view === "ewa"}
                icon={<IconWallet />}
                title="Advance Salary"
                onClick={() => go("ewa")}
              />
            ) : null}
            {allowed.has("portalSettings") ? (
              <NavBtn
                active={view === "portalSettings"}
                icon={<IconSettings />}
                title="Portal Settings"
                onClick={() => go("portalSettings")}
              />
            ) : null}
            {allowed.has("portalAudit") ? (
              <NavBtn
                active={view === "portalAudit"}
                icon={<IconTerminal />}
                title="Portal Audit"
                onClick={() => go("portalAudit")}
              />
            ) : null}
          </NavGroup>
        ) : null}
        {role === "SUPER_ADMIN" ? (
          <NavGroup label="Administration">
            {allowed.has("integrations") ? (
              <NavBtn
                active={view === "integrations"}
                icon={<IconTerminal />}
                title="Integrations"
                onClick={() => go("integrations")}
              />
            ) : null}
            <NavBtn
              active={view === "logs"}
              icon={<IconTerminal />}
              title="Audit Logs"
              onClick={() => go("logs")}
            />
            <NavBtn
              active={settingsOpen}
              icon={<IconSettings />}
              title="Settings"
              onClick={() => {
                onSettingsOpen(true);
                onMobileClose();
              }}
            />
          </NavGroup>
        ) : null}
        </>}
        <div className="sidebar-spacer" />
        {!clientExperience ? <button
          type="button"
          className="sidebar-ida"
          onClick={() => {
            onOpenIda();
            onMobileClose();
          }}
        >
          <IconMessage />
          <span>Ask IDA</span>
        </button> : null}
        <div className="sidebar-system-meta">
          <span>
            <i className={`sidebar-health-dot sidebar-health-${serviceState}`} />
            Production · {serviceState === "connected"
              ? "Connected"
              : serviceState === "degraded"
                ? "Degraded"
                : serviceState === "offline"
                  ? "Unavailable"
                  : "Checking"}
          </span>
          <small>ProQPay · {syncLabel(lastSyncAt, now)}</small>
          <button
            type="button"
            onClick={() => {
              onOpenHelp();
              onMobileClose();
            }}
          >
            Support
          </button>
        </div>
      </aside>
      {settingsOpen ? <SettingsModal
        open
        onClose={() => onSettingsOpen(false)}
        role={role}
      /> : null}
    </>
  );
}

function NavGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <nav className="sidebar-group" aria-label={label}>
      <div className="sidebar-label">{label}</div>
      {children}
    </nav>
  );
}
function NavBtn({
  icon,
  title,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      type="button"
      onClick={onClick}
      className={`sidebar-nav-button${active ? " sidebar-nav-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span>{title}</span>
    </button>
  );
}
function syncLabel(value?: number, now = Date.now()) {
  if (!value) return "Belum sinkron";
  const minutes = Math.max(0, Math.round((now - value) / 60000));
  return minutes < 1 ? "Sync baru saja" : `Sync ${minutes}m lalu`;
}
