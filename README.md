# gridDog — 3-Tier Datadog Merch Store (ECS Fargate demo)

A minimal, containerized 3-tier e-commerce demo for selling Datadog merch.
Built to be run locally with Docker Compose and deployed to **AWS ECS Fargate**
with **MongoDB self-hosted on EC2**.

> Demo code — intentionally minimal. No payment processing, minimal validation,
> and **no auth on the CMS**. See "Hardening" below before any real use.

## Stack (pinned)

- Node 16 · TypeScript 4.7.4
- **Next.js 10.1.3** (storefront, cms-ui) — pages router
- **NestJS 7.0.0** (store-api, cms-api)
- **MongoDB 8.0.23** — via the native `mongodb` v4 driver (not mongoose, for
  server-8.0 compatibility)

## Services

| Dir          | Tech       | Port | Role                                            |
|--------------|------------|------|-------------------------------------------------|
| `storefront` | Next.js    | 3000 | Customer store: browse → cart → checkout        |
| `store-api`  | NestJS     | 4000 | Read products, write checkouts (no payment)     |
| `cms-ui`     | Next.js    | 3001 | Admin UI: create / edit-price / delete products |
| `cms-api`    | NestJS     | 4001 | Product CRUD                                     |
| (mongo)      | MongoDB    | 27017| Shared `products` + `checkouts` collections     |

Both Next apps proxy browser calls `/api/*` to their API via a catch-all API
route (`pages/api/[...path].ts`) that forwards to a **runtime** env var —
`STORE_API_URL` / `CMS_API_URL`. (We avoid Next 10 `rewrites()` for this because
Next 10 bakes rewrite destinations at build time; the API route reads the env
var per request, so one image works in any environment.) On ECS, `cms-ui` and
`cms-api` share one task and talk over `localhost`.

```
storefront ─/api→ store-api ─┐
cms-ui ────/api→ cms-api ────┼─→ MongoDB
                             ┘
```

## Run locally

Requires Docker.

```bash
cp .env.example .env
docker compose up --build        # starts mongo + 4 services

# in another terminal, seed sample products (uses host MONGO_URI from .env)
npm install && npm run seed
```

Then open:
- Storefront → http://localhost:3000
- CMS admin → http://localhost:3001

Quick API checks:
```bash
curl localhost:4000/health      # {"ok":true}
curl localhost:4001/health      # {"ok":true}
curl localhost:4000/products    # seeded list
```

End-to-end: add items in the storefront → checkout (name/email) → confirmation.
In the CMS, change a price or add a product, then refresh the storefront to see
it reflected (same `products` collection).

### Running a single service without Docker
```bash
cd store-api && npm install && npm run build && MONGO_URI=mongodb://localhost:27017/griddog npm start
cd storefront && npm install && STORE_API_URL=http://localhost:4000 npm run dev
```

## Deploy to AWS

- **New to ECS? Start here:** **[deploy/DEPLOY-ECS-STEPBYSTEP.md](deploy/DEPLOY-ECS-STEPBYSTEP.md)**
  — fully copy‑pasteable, uses **MongoDB Atlas** (no EC2), explains every concept
  and how the services discover each other (Service Connect + ALB).
- **MongoDB on EC2 instead of Atlas:** [deploy/runbook.md](deploy/runbook.md).

Building blocks:
- Build & push images: `deploy/ecr-build-push.sh`
- Task definitions: `deploy/ecs/*.taskdef.json`
  (`cms.taskdef.json` declares **two containers**: `cms-ui` + `cms-api`)

### Database config (Atlas vs EC2)
Both APIs read `MONGO_URI` and optionally `MONGO_DB_NAME`. Atlas `mongodb+srv://`
strings have no database in the path, so set `MONGO_DB_NAME=griddog` (already
wired into the task definitions and the seed script). For the EC2 string
(`...:27017/griddog`) the name is taken from the URI.

## Data model

```
products:  { _id, name, description, price /* cents */, imageUrl, stock }
checkouts: { _id, items: [{ productId, name, price, qty }], total, customer:{name,email}, createdAt }
```

## Hardening (not done — demo)

- Add auth to cms-ui/cms-api (ALB OIDC / private ALB).
- HTTPS via ACM on the ALB; lock down the MongoDB security group.
- Add real validation, payment, and inventory decrement on checkout.
