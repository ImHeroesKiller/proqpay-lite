# ProQPay Lite

**AI Payroll Operating System** — Conversation-first payroll platform with IDA AI Assistant.

Built with **Next.js 16** · static export for **Cloudflare Pages** with Pages Functions.

## Production

| Host | URL | Build |
|------|-----|-------|
| Cloudflare Pages | `https://proqpay-lite.pages.dev/` | `npm run build` → `out` |

## Features

- Two-section dashboard: Global Snapshot + Client Detail
- Metric cards + searchable popup
- Region distribution, client detail, AI insight, timeline
- Floating **Ask IDA** untuk analisis dan payroll; Payment Instruction hanya melalui workflow canonical
- Immutable Payment Instruction snapshot, maker-checker, PDF, dan bank export BCA/Mandiri/BRI/BNI/custom
- Payroll calc (BPJS + PPh 21) with Neon-backed operational persistence
- Period / bundling filters, Settings modal

## Local development

```bash
npm install
npm run dev
```

## Deploy to Cloudflare Pages

Repository `ImHeroesKiller/proqpay-lite` terhubung ke Cloudflare Pages. Push ke
`main` memicu build production dengan Node.js 22, command `npm run build`, dan
output directory `out`. Jangan set `GITHUB_PAGES=true`.

Konfigurasi environment, Cloudflare Access, binding rate limiter, dan smoke test
tersedia di [CLOUDFLARE.md](./CLOUDFLARE.md).

## Project structure

```
src/app/          # Next.js App Router
src/components/   # UI
src/lib/          # database, ida-simple, format, events
functions/api/    # Cloudflare Pages Functions
db/migrations/   # additive PostgreSQL migrations
```

## License

MIT
