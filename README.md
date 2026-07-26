# ProQPay Lite

**AI Payroll Operating System** — Conversation-first payroll platform with IDA AI Assistant.

Built with **Next.js 16** · static export for **Netlify** & **GitHub Pages**.

## Deploy targets

| Host | URL pattern | Config |
|------|-------------|--------|
| **Netlify** (recommended) | `https://yoursite.netlify.app` | `netlify.toml` — root path |
| GitHub Pages | `https://imheroeskiller.github.io/proqpay-lite/` | `GITHUB_PAGES=true` + `basePath` |

## Features

- Two-section dashboard: Global Snapshot + Client Detail
- Metric cards + searchable popup
- Region distribution, client detail, AI insight, timeline
- Floating **Ask IDA** (rule-based): `help`, `status`, `hitung payroll`, `ajukan approval`, `buat payment instruction`, …
- Payroll calc (BPJS + PPh 21) + localStorage
- Period / bundling filters, Settings modal

## Local development

```bash
npm install
npm run dev
```

## Deploy to Netlify

### Option A — Connect GitHub (recommended)

1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
2. Pilih repo `ImHeroesKiller/proqpay-lite`
3. Build settings (auto from `netlify.toml`):
   - **Build command:** `npm run build`
   - **Publish directory:** `out`
4. Deploy — jangan set `GITHUB_PAGES`

### Option B — Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

## GitHub Pages

Settings → Pages → Source: **GitHub Actions**.  
Workflow sets `GITHUB_PAGES=true` so assets use `/proqpay-lite/`.

## Project structure

```
src/app/          # Next.js App Router
src/components/   # UI
src/lib/          # database, ida-simple, format, events
netlify.toml      # Netlify build
```

## License

MIT
