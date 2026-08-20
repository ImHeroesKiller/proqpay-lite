import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import PwaRegister from '@/components/PwaRegister';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ProQPay Lite — AI Payroll OS',
  description: 'Conversation-first AI Payroll Operating System with IDA AI Assistant',
  applicationName: 'ProQPay Lite',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/assets/proqpay-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/assets/proqpay-192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/assets/proqpay-apple-180.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'ProQPay' },
};

export const viewport = { themeColor: '#061434', width: 'device-width', initialScale: 1 };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className={inter.className}>{children}<PwaRegister /></body>
    </html>
  );
}
