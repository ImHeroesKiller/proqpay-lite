# Deploy ProQPay Lite → Cloudflare Pages

## 1. Buat project

1. Buka https://dash.cloudflare.com → **Workers & Pages**
2. **Create** → **Pages** → **Connect to Git**
3. Pilih repo `ImHeroesKiller/proqpay-lite`
4. Build settings:

| Field | Value |
|-------|--------|
| Framework preset | None / Next.js (static) |
| Build command | `npm run build` |
| Build output directory | `out` |
| Root directory | `/` (default) |
| Node version | `22` (Environment variable `NODE_VERSION=22`) |

5. **Save and Deploy**

## 2. Environment variables

**Settings → Environment variables → Production** (dan Preview jika perlu):

| Name | Value |
|------|--------|
| `DATABASE_URL` | Connection string Postgres/Neon (`postgresql://...`) |
| `NODE_VERSION` | `22` |

**Important:** Jangan set `GITHUB_PAGES=true` (itu hanya untuk GitHub Pages).

Setelah menambah env → **Retry deployment**.

## 3. Cek API

Setelah live (mis. `https://proqpay-lite.pages.dev`):

```bash
curl https://YOUR-SUBDOMAIN.pages.dev/api/health
```

Harusnya: `"status":"ok","database":"connected"`

Init tabel:

```bash
curl -X POST https://YOUR-SUBDOMAIN.pages.dev/api/schema
```

## 4. Struktur Functions

```
functions/
  api/
    health.js      → GET  /api/health
    schema.js      → GET|POST /api/schema
    employees.js   → GET|POST /api/employees
```

Driver: `@neondatabase/serverless` (Worker-compatible).

## 5. Custom domain (opsional)

Pages → Custom domains → Add `proqpay.yourdomain.com`
