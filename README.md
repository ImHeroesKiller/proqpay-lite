# ProQPay Lite

**AI Payroll Operating System** — Conversation-first payroll platform with IDA AI Assistant.

Built with **Next.js 16** (July 2026).

## Features

- Conversation-first UX powered by IDA (AI Payroll Manager)
- Two-section dashboard: Global Snapshot + Client Detail
- Interactive Indonesia administrative map
- Payroll calculation (BPJS, PPh 21, UMR)
- Invoice & AR monitoring
- Payment instruction generation (BCA, Mandiri, BNI, BRI, etc.)
- Role-based access (Super Admin, HR, Payroll, Finance, Director, Viewer)
- Clean modern 2026 white + colorful SaaS design

## Tech Stack

- Next.js 16 (App Router + Static Export)
- React 19
- TypeScript
- CSS Variables design system
- localStorage persistence (demo)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to GitHub Pages

This project is configured for static export (`output: 'export'`).

GitHub Actions will automatically build and deploy to GitHub Pages on every push to `main`.

**Live demo:** https://imheroeskiller.github.io/proqpay-lite/

## Project Structure

```
src/
  app/           # Next.js App Router
  components/    # UI components
  lib/           # database, ida-engine, dashboard renderer
  styles/        # global CSS
```

## License

MIT
