"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconBuilding,
  IconChart,
  IconChevronDown,
  IconClock,
  IconDashboard,
  IconFile,
  IconLayers,
  IconMessage,
  IconSettings,
  IconShieldCheck,
  IconUsers,
  IconWallet,
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
  activePath,
  period,
}: Props) {
  const allowed = new Set(allowedViewsForRole(role));
  const asideRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const go = (next: AppView) => {
    onView(next);
    onMobileClose();
  };
  const canIntake = ["SUPER_ADMIN", "PAYROLL_PROCESSOR"].includes(role || "");
  const simplifiedInternal = ["PAYROLL_PROCESSOR", "PAYROLL_CONTROLLER"].includes(role || "");
  const clientExperience = role === "CLIENT_USER";
  const employeeServicesActive = ["ewa", "portalAudit", "portalSettings"].includes(view);
  const systemActive = ["integrations", "logs"].includes(view);

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
          <img className="sidebar-brand-logo" src="/assets/proqpay-logo-v2.svg" alt="ProQPay" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sidebar-brand-icon" src="/assets/proqpay-192.png" alt="ProQPay" />
          <button
            type="button"
            className="sidebar-mobile-close"
            aria-label="Tutup navigasi"
            onClick={onMobileClose}
          >
            ✕
          </button>
        </div>

        {clientExperience ? (
          <NavGroup label="Workspace">
            <NavBtn active={view === "dashboard"} icon={<IconDashboard />} title="Home" onClick={() => go("dashboard")} />
            <NavBtn active={view === "operations"} icon={<IconWallet />} title="Payroll" onClick={() => go("operations")} />
            <NavBtn active={view === "reports"} icon={<IconFile />} title="Documents" onClick={() => go("reports")} />
          </NavGroup>
        ) : (
          <>
            <NavGroup label="Overview">
              <NavBtn active={view === "dashboard"} icon={<IconDashboard />} title="Dashboard" onClick={() => go("dashboard")} />
            </NavGroup>

            <NavGroup label={simplifiedInternal ? "Work" : "Payroll Operations"}>
              {allowed.has("clients") && !simplifiedInternal ? (
                <NavBtn active={view === "clients"} icon={<IconBuilding />} title="Clients & Projects" onClick={() => go("clients")} />
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
              {allowed.has("exceptions") ? (
                <NavBtn
                  active={view === "exceptions"}
                  icon={<IconAlertTriangle />}
                  title={simplifiedInternal ? "Issues" : "Data Readiness"}
                  onClick={() => go("exceptions")}
                />
              ) : null}
              {allowed.has("operations") ? (
                <NavBtn
                  active={view === "operations" && activePath !== "data-intake"}
                  icon={<IconClock />}
                  title={simplifiedInternal ? "Payroll" : "Pay Runs"}
                  onClick={() => go("operations")}
                />
              ) : null}
              {allowed.has("payments") ? (
                <NavBtn
                  active={view === "payments"}
                  icon={<IconArrowUpRight />}
                  title={simplifiedInternal ? "Payments" : "Payment Instructions"}
                  onClick={() => go("payments")}
                />
              ) : null}
              {allowed.has("billing") ? (
                <NavBtn
                  active={view === "billing"}
                  icon={<IconWallet />}
                  title={simplifiedInternal ? "Close & Billing" : "Billing & AR"}
                  onClick={() => go("billing")}
                />
              ) : null}
            </NavGroup>

            <NavGroup label={simplifiedInternal ? "Reference & Reports" : "People & Reporting"}>
              {allowed.has("clients") && simplifiedInternal ? (
                <NavBtn active={view === "clients"} icon={<IconBuilding />} title="Clients & Projects" onClick={() => go("clients")} />
              ) : null}
              {allowed.has("employees") ? (
                <NavBtn active={view === "employees"} icon={<IconUsers />} title="Employees" onClick={() => go("employees")} />
              ) : null}
              {allowed.has("reports") ? (
                <NavBtn active={view === "reports"} icon={<IconChart />} title="Reports" onClick={() => go("reports")} />
              ) : null}
            </NavGroup>

            {role === "SUPER_ADMIN" && (allowed.has("ewa") || allowed.has("portalAudit") || allowed.has("portalSettings")) ? (
              <NavGroup
                label="Employee Services"
                collapsible={!compact}
                defaultOpen={false}
                active={employeeServicesActive}
              >
                {allowed.has("ewa") ? (
                  <NavBtn active={view === "ewa"} icon={<IconWallet />} title="Advance Salary" onClick={() => go("ewa")} />
                ) : null}
                {allowed.has("portalSettings") ? (
                  <NavBtn active={view === "portalSettings"} icon={<IconSettings />} title="Portal Settings" onClick={() => go("portalSettings")} />
                ) : null}
                {allowed.has("portalAudit") ? (
                  <NavBtn active={view === "portalAudit"} icon={<IconShieldCheck />} title="Portal Audit" onClick={() => go("portalAudit")} />
                ) : null}
              </NavGroup>
            ) : null}

            {role === "SUPER_ADMIN" ? (
              <NavGroup label="System" collapsible={!compact} defaultOpen={false} active={systemActive}>
                {allowed.has("integrations") ? (
                  <NavBtn active={view === "integrations"} icon={<IconLayers />} title="Integrations" onClick={() => go("integrations")} />
                ) : null}
                <NavBtn active={view === "logs"} icon={<IconShieldCheck />} title="Audit Logs" onClick={() => go("logs")} />
              </NavGroup>
            ) : null}
          </>
        )}

        <div className="sidebar-spacer" />

        <div className="sidebar-utilities" aria-label="Utility">
          {!clientExperience ? (
            <button
              type="button"
              className="sidebar-utility-button sidebar-ida"
              onClick={() => {
                onOpenIda();
                onMobileClose();
              }}
            >
              <IconMessage />
              <span>Ask IDA</span>
            </button>
          ) : null}
          {role === "SUPER_ADMIN" ? (
            <button
              type="button"
              className={`sidebar-utility-button${settingsOpen ? " sidebar-nav-active" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => {
                onSettingsOpen(true);
                onMobileClose();
              }}
            >
              <IconSettings />
              <span>Settings</span>
            </button>
          ) : null}
          <button
            type="button"
            className="sidebar-utility-button"
            onClick={() => {
              onOpenHelp();
              onMobileClose();
            }}
          >
            <IconShieldCheck />
            <span>Support</span>
          </button>
        </div>
      </aside>

      {settingsOpen ? <SettingsModal open onClose={() => onSettingsOpen(false)} role={role} /> : null}
    </>
  );
}

function NavGroup({
  label,
  children,
  collapsible = false,
  defaultOpen = true,
  active = false,
}: {
  label: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  active?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const open = !collapsible || active || expanded;

  return (
    <nav className={`sidebar-group${collapsible ? " sidebar-group-collapsible" : ""}`} aria-label={label}>
      {collapsible ? (
        <button
          type="button"
          className="sidebar-group-toggle"
          aria-expanded={open}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{label}</span>
          <IconChevronDown className={open ? "open" : ""} />
        </button>
      ) : (
        <div className="sidebar-label">{label}</div>
      )}
      <div className="sidebar-group-items" hidden={!open}>
        {children}
      </div>
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
