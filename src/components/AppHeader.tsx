"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChangePasswordModal } from "@/components/AuthViews";
import { listOperatingDashboard } from "@/lib/operating-model-api";
import { allowedViewsForRole, type AppView } from "./Sidebar";
import { IconBell, IconChevronDown, IconMenu, IconSearch } from "./Icons";

type HeaderActor = {
  id: string;
  name?: string;
  email: string;
  role: string;
  authMode?: string;
  clientIds?: string[] | null;
};
type Props = {
  period: string;
  periods: string[];
  view: AppView;
  clientCount: number | null;
  onPeriodChange: (period: string) => void;
  onNavigate: (view: AppView) => void;
  onHelp: () => void;
  onMenu: () => void;
  actor: HeaderActor;
};
const VIEW_LABELS: Record<AppView, string> = {
  dashboard: "Dashboard",
  operations: "Pay Runs",
  exceptions: "Action Center",
  payments: "Payment Control",
  billing: "Billing & AR",
  integrations: "Integrations",
  employees: "Employees",
  clients: "Clients & Projects",
  reports: "Reports",
  logs: "Audit Logs",
  ewa: "Advance Salary",
  portalSettings: "Portal Settings",
};
function viewLabel(view:AppView, role:string) {
  if (role === "CLIENT_USER") {
    const clientLabels:Partial<Record<AppView,string>>={
      dashboard:"Home",
      operations:"Payroll",
      reports:"Documents",
      exceptions:"Payroll",
      payments:"Payroll",
      billing:"Documents",
    };
    return clientLabels[view] || VIEW_LABELS[view];
  }
  const simplifiedInternal=["PAYROLL_PROCESSOR","PAYROLL_CONTROLLER"].includes(role);
  if (!simplifiedInternal) return VIEW_LABELS[view];
  const labels:Partial<Record<AppView,string>>={
    operations:"Payroll",
    exceptions:"Issues",
    payments:"Payments",
    billing:"Close & Billing",
  };
  return labels[view] || VIEW_LABELS[view];
}

const SEARCH_ITEMS: Array<{ label: string; keywords: string; view: AppView }> =
  [
    {
      label: "Dashboard",
      keywords: "home control tower ringkasan",
      view: "dashboard",
    },
    {
      label: "Pay Runs",
      keywords: "payroll submission proses",
      view: "operations",
    },
    {
      label: "Action Center",
      keywords: "exception blocker approval",
      view: "exceptions",
    },
    {
      label: "Payment Control",
      keywords: "payment instruction proof reconciliation",
      view: "payments",
    },
    {
      label: "Billing & AR",
      keywords: "invoice billing piutang finance",
      view: "billing",
    },
    {
      label: "Integrations",
      keywords: "payment gateway e2pay api endpoint connected apps monitoring",
      view: "integrations",
    },
    {
      label: "Advance Salary",
      keywords: "ewa advance gaji borongan cair",
      view: "ewa",
    },
    {
      label: "Portal Settings",
      keywords: "banner iklan ewa fee plafond tenure ess portal",
      view: "portalSettings",
    },
    {
      label: "Audit Logs",
      keywords: "audit log login ess portal security payment billing integration gateway api",
      view: "logs",
    },
    { label: "Employees", keywords: "karyawan rekening", view: "employees" },
    { label: "Clients & Projects", keywords: "klien project", view: "clients" },
    { label: "Reports", keywords: "laporan payment", view: "reports" },
  ];

export default function AppHeader({
  period,
  periods,
  view,
  clientCount,
  onPeriodChange,
  onNavigate,
  onHelp,
  onMenu,
  actor,
}: Props) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [alerts, setAlerts] = useState({
    issues: 0,
    clientActions: 0,
    payrollApprovals: 0,
    paymentApprovals: 0,
    invoiceApprovals: 0,
  });
  const [alertsState, setAlertsState] = useState<"loading" | "ready" | "error">("loading");
  const shellRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const user = { ...actor, name: actor.name || actor.email.split("@")[0] };
  const refreshAlerts = useCallback(async () => {
    setAlertsState("loading");
    try {
      const result = await listOperatingDashboard(undefined, period);
      const submissions = result.submissions || [];
      const paymentInstructions = result.paymentInstructions || [];
      const openCount = submissions.reduce(
        (sum, row) => sum + Number(row.open_exception_count || 0),
        0,
      );
      const clientActionCount = submissions.reduce(
        (sum, row) => sum + Number(row.client_action_count || 0),
        0,
      );
      const payrollApprovals = submissions.filter(
        (row) => row.state === "CONTROLLER_REVIEW",
      ).length;
      const paymentApprovals = paymentInstructions.filter(
        (row) => row.status === "PAYMENT_APPROVAL_PENDING",
      ).length;
      const invoiceApprovals = submissions.filter(
        (row) => row.invoice_status === "UNDER_REVIEW",
      ).length;
      const clientApprovals = submissions.filter(
        (row) => row.state === "CLIENT_APPROVAL_PENDING",
      ).length;

      if (actor.role === "PAYROLL_PROCESSOR") {
        setAlerts({
          issues: Math.max(0, openCount - clientActionCount),
          clientActions: 0,
          payrollApprovals: 0,
          paymentApprovals: 0,
          invoiceApprovals: 0,
        });
      } else if (actor.role === "PAYROLL_CONTROLLER") {
        setAlerts({
          issues: 0,
          clientActions: 0,
          payrollApprovals,
          paymentApprovals,
          invoiceApprovals,
        });
      } else if (actor.role === "CLIENT_USER") {
        setAlerts({
          issues: 0,
          clientActions: clientActionCount + clientApprovals,
          payrollApprovals: 0,
          paymentApprovals: 0,
          invoiceApprovals: 0,
        });
      } else {
        setAlerts({
          issues: openCount,
          clientActions: 0,
          payrollApprovals,
          paymentApprovals,
          invoiceApprovals,
        });
      }
      setAlertsState("ready");
    } catch {
      setAlertsState("error");
    }
  }, [actor.role, period]);
  useEffect(() => {
    void refreshAlerts();
    const refresh=()=>void refreshAlerts();
    const timer=window.setInterval(refresh,60_000);
    window.addEventListener('focus',refresh);
    window.addEventListener('proqpay:operating-cache-invalidated',refresh);
    return()=>{
      window.clearInterval(timer);
      window.removeEventListener('focus',refresh);
      window.removeEventListener('proqpay:operating-cache-invalidated',refresh);
    };
  }, [refreshAlerts]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
        setAlertsOpen(false);
        setSearchOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        setAlertsOpen(false);
        setSearchOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    setSearchIndex(0);
  }, [query, searchOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = profileRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) || [],
      );
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setProfileOpen(false);
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
      document.removeEventListener("keydown", onKeyDown);
      (accountButtonRef.current || previous)?.focus();
    };
  }, [profileOpen]);

  const matches = useMemo(() => {
    const allowed = new Set(allowedViewsForRole(actor.role));
    return SEARCH_ITEMS.filter(
      (item) =>
        allowed.has(item.view) &&
        `${item.label} ${item.keywords}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ).slice(0, 5);
  }, [actor.role, query]);
  const totalAlerts =
    alerts.issues +
    alerts.clientActions +
    alerts.payrollApprovals +
    alerts.paymentApprovals +
    alerts.invoiceApprovals;
  async function logout() {
    setAccountOpen(false);
    if (actor.authMode === "access") {
      window.location.replace("/cdn-cgi/access/logout");
      return;
    }
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
    } finally {
      window.location.replace("/");
    }
  }
  return (
    <>
      <header className="app-header">
        <div className="header-context">
          <button
            type="button"
            className="header-menu-button"
            aria-label="Buka navigasi"
            onClick={onMenu}
          >
            <IconMenu aria-hidden="true" />
          </button>
          <div>
            <span>
              ProQPay /{" "}
              {clientCount == null
                ? "Client scope"
                : clientCount === 1
                  ? "1 Client"
                  : `${clientCount} Clients`}
            </span>
            <strong>{viewLabel(view, actor.role)}</strong>
          </div>
        </div>
        <div className="header-actions" ref={shellRef}>
          <label className="header-period">
            <span>Period</span>
            <select
              aria-label="Global payroll period"
              value={period}
              onChange={(event) => onPeriodChange(event.target.value)}
            >
              {periods.map((item) => (
                <option key={item} value={item}>
                  {item === "ALL" ? "All periods" : item}
                </option>
              ))}
            </select>
          </label>
          <div className="header-search">
            <button
              type="button"
              aria-label="Cari modul"
              aria-expanded={searchOpen}
              aria-controls="header-search-results"
              onClick={() => {
                setSearchOpen((open) => !open);
                setAlertsOpen(false);
                setAccountOpen(false);
              }}
            >
              <IconSearch aria-hidden="true" /> <span>Search</span>
            </button>
            {searchOpen ? (
              <div
                id="header-search-results"
                className="header-popover search-popover"
              >
                <input
                  autoFocus
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="header-search-options"
                  aria-expanded="true"
                  aria-activedescendant={matches[searchIndex] ? `header-search-${matches[searchIndex].view}` : undefined}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari modul atau pekerjaan…"
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setSearchIndex((current) => matches.length ? (current + 1) % matches.length : 0);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setSearchIndex((current) => matches.length ? (current - 1 + matches.length) % matches.length : 0);
                    } else if (event.key === "Enter" && matches[searchIndex]) {
                      onNavigate(matches[searchIndex].view);
                      setSearchOpen(false);
                      setQuery("");
                    }
                  }}
                />
                <div id="header-search-options" role="listbox" aria-label="Hasil pencarian modul">
                  {matches.map((item, index) => (
                    <button
                      id={`header-search-${item.view}`}
                      type="button"
                      role="option"
                      aria-selected={index === searchIndex}
                      className={index === searchIndex ? "header-search-active" : undefined}
                      key={item.view}
                      onMouseEnter={() => setSearchIndex(index)}
                      onClick={() => {
                        onNavigate(item.view);
                        setSearchOpen(false);
                        setQuery("");
                      }}
                    >
                      <strong>{viewLabel(item.view, actor.role)}</strong>
                      <small>{item.keywords}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="header-alerts">
            <button
              type="button"
              aria-label={
                alertsState === "error"
                  ? "Work queue tidak tersedia"
                  : `${totalAlerts} pekerjaan membutuhkan perhatian`
              }
              aria-expanded={alertsOpen}
              onClick={() => {
                setAlertsOpen((open) => !open);
                setSearchOpen(false);
                setAccountOpen(false);
              }}
            >
              <IconBell aria-hidden="true" />
              {alertsState === "ready" && totalAlerts ? <b>{totalAlerts}</b> : null}
            </button>
            {alertsOpen ? (
              <div className="header-popover" role="status" aria-live="polite">
                <span>WORK QUEUE</span>
                {alertsState === "loading" ? <small>Refreshing work queue…</small> : null}
                {alertsState === "error" ? <>
                  <small role="status">Work queue unavailable. Status pekerjaan belum dapat dipastikan.</small>
                  <button type="button" onClick={() => void refreshAlerts()}>
                    <strong>Try again</strong>
                  </button>
                </> : null}
                {alertsState === "ready" && alerts.issues ? <button
                  type="button"
                  onClick={() => {
                    onNavigate("exceptions");
                    setAlertsOpen(false);
                  }}
                >
                  <strong>Issues</strong>
                  <b>{alerts.issues}</b>
                </button> : null}
                {alertsState === "ready" && alerts.clientActions ? <button
                  type="button"
                  onClick={() => {
                    onNavigate("operations");
                    setAlertsOpen(false);
                  }}
                >
                  <strong>Action required</strong>
                  <b>{alerts.clientActions}</b>
                </button> : null}
                {alertsState === "ready" && alerts.payrollApprovals ? <button
                  type="button"
                  onClick={() => {
                    onNavigate("operations");
                    setAlertsOpen(false);
                  }}
                >
                  <strong>Payroll approval</strong>
                  <b>{alerts.payrollApprovals}</b>
                </button> : null}
                {alertsState === "ready" && alerts.paymentApprovals ? <button
                  type="button"
                  onClick={() => {
                    onNavigate("payments");
                    setAlertsOpen(false);
                  }}
                >
                  <strong>Payment approval</strong>
                  <b>{alerts.paymentApprovals}</b>
                </button> : null}
                {alertsState === "ready" && alerts.invoiceApprovals ? <button
                  type="button"
                  onClick={() => {
                    onNavigate("billing");
                    setAlertsOpen(false);
                  }}
                >
                  <strong>Invoice approval</strong>
                  <b>{alerts.invoiceApprovals}</b>
                </button> : null}
                {alertsState === "ready" && !totalAlerts ? <small>No action required</small> : null}
              </div>
            ) : null}
          </div>
          <button type="button" className="header-icon-button" onClick={onHelp}>
            Help
          </button>
          <div className="header-account">
            <button
              ref={accountButtonRef}
              type="button"
              aria-expanded={accountOpen}
              onClick={() => {
                setAccountOpen((open) => !open);
                setSearchOpen(false);
                setAlertsOpen(false);
              }}
            >
              <i>{user.name.slice(0, 1).toUpperCase()}</i>
              <span>
                <strong>{user.name}</strong>
                <small>{actor.role.replaceAll("_", " ")}</small>
              </span>
              <IconChevronDown className="header-chevron" aria-hidden="true" />
            </button>
            {accountOpen ? (
              <div className="header-popover account-popover">
                <div>
                  <strong>{user.email}</strong>
                  <small>{clientCount == null ? "Canonical client scope" : `${clientCount} client scope`}</small>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(true);
                    setAccountOpen(false);
                  }}
                >
                  Profile
                </button>
                {["database", "session"].includes(actor.authMode || "") ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordOpen(true);
                      setAccountOpen(false);
                    }}
                  >
                    Change password
                  </button>
                ) : null}
                <button type="button" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {profileOpen ? (
        <div
          className="profile-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setProfileOpen(false);
          }}
        >
          <div
            ref={profileRef}
            className="profile-card"
            role="dialog"
            aria-modal="true"
            aria-label="User profile"
          >
            <span>USER PROFILE</span>
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            <p>{actor.role.replaceAll("_", " ")}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setProfileOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      {passwordOpen ? (
        <ChangePasswordModal
          forced={false}
          onClose={() => setPasswordOpen(false)}
        />
      ) : null}
    </>
  );
}
