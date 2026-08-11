import type { Metadata } from 'next';
import './globals.css';
import PwaRegister from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'ProQPay Lite — AI Payroll OS',
  description: 'Conversation-first AI Payroll Operating System with IDA AI Assistant',
  applicationName: 'ProQPay Lite',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/assets/proqpay-mark.svg', type: 'image/svg+xml' }],
    shortcut: '/assets/proqpay-mark.svg',
    apple: '/assets/proqpay-mark.svg',
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'ProQPay' },
};

export const viewport = { themeColor: '#4f46e5', width: 'device-width', initialScale: 1 };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}<PwaRegister /></body>
    </html>
  );
}
