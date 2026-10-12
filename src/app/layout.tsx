import type { Metadata } from "next";
// G1 CSS cascade contract: tokens -> legacy global -> premium -> shell ->
// shared UI -> payroll/payment -> final interaction polish -> domain CSS.
// Keep import order; see scripts/check-css-architecture.mjs.
import "./styles/tokens.css";
import "./globals.css";
import "./styles/premium.css";
import "./styles/shell.css";
import "./styles/shared-ui.css";
import "./styles/operations.css";
import "./polish.css";
import "./styles/polish-dashboard.css";
import "./styles/polish-directory.css";
import "./styles/polish-data-operations.css";
import "./styles/polish-payruns.css";
import "./styles/polish-billing.css";
import "./styles/polish-people-reports.css";
import "./employee-services.css";
import "./audit-console.css";
import "./e2pay-wallet.css";
import PwaRegister from "@/components/PwaRegister";


export const metadata: Metadata = {
  title: "ProQPay — AI Payroll OS",
  description:
    "Conversation-first AI Payroll Operating System with IDA AI Assistant",
  applicationName: "ProQPay",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/assets/proqpay-48.png", sizes: "48x48", type: "image/png" },
      { url: "/assets/proqpay-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      {
        url: "/assets/proqpay-apple-180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "ProQPay" },
};

export const viewport = {
  themeColor: "#061434",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
