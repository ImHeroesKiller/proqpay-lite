# ProQPay Lite

**AI Payroll Operating System** — Conversation-first payroll platform with IDA AI Assistant.

Built with **Next.js 16** · deployed on **GitHub Pages**.

## Live demo

https://imheroeskiller.github.io/proqpay-lite/

## Features (GitHub Pages build)

- Two-section dashboard: **Global Snapshot** + **Client Detail**
- Metric cards (Employees, Clients, Payroll, Outstanding) + searchable popup
- Region distribution chart
- Client detail: employee table, area, billing, AI insight, activity timeline
- Floating **Ask IDA** mini-chat (rule-based)
- IDA commands: `help`, `status`, `hitung payroll`, `daftar karyawan`, `outstanding`, `UMR Jakarta`, …
- Payroll calculation (BPJS + PPh 21) with localStorage persistence
- Settings modal (org, period, role)
- Clean 2026 white + indigo SaaS design

> Gemini / full LLM intent is prepared in code but **not** enabled on static Pages (API key would not be safe in the browser).

## Tech Stack

- Next.js 16 (App Router + `output: 'export'`)
- React 19 + TypeScript
- CSS variables design system
- localStorage demo database

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000

Optional Gemini (local only):

```bash
cp .env.example .env.local
# add GEMINI_API_KEY=...
```

## GitHub Pages setup (one-time)

1. Repo **Settings** → **Pages**
2. **Source**: GitHub Actions
3. Push to `main` → workflow builds `out/` and deploys

Workflow: `.github/workflows/deploy.yml`  
`GITHUB_PAGES=true` ensures `basePath=/proqpay-lite`.

## Project structure

```
src/
  app/            # layout, page, globals.css
  components/     # Sidebar, IdaFab, MetricCard, ClientDetail, …
  lib/            # database, format, ida-simple, gemini (optional), events
```

## License

MIT
