# gridDog — 3-Tier Datadog Merch Store (ECS Fargate demo)

A minimal, containerized 3-tier e-commerce demo for selling Datadog merch.
Built to be run locally with Docker Compose and deployed to **AWS ECS Fargate**
with **MongoDB self-hosted on EC2**.

> Demo code — intentionally minimal. No payment processing, minimal validation,
> and **no auth on the CMS**. See "Hardening" below before any real use.

## Stack (pinned)

- Node 16 · TypeScript 4.7.4
- **Next.js 10.1.3** (storefront, cms-ui) — pages router
- **NestJS** — `cms-api` on 7.0.0; `store-api` on **7.6.18** (bumped so `dd-trace`
  installs without a peer-dependency conflict)
- **MongoDB 8.0.23** — via the native `mongodb` v4 driver (not mongoose, for
  server-8.0 compatibility)
- **Kafka** (apache/kafka 4.2.0, KRaft, 3 brokers) — checkout events on topic
  `griddog-checkouts`; **kafkajs** producer/consumer in `store-api`
- **socket.io v4** — realtime `checkout:done` notification to the browser
- **dd-trace** (Datadog APM) — `store-api` + `storefront`, started via
  `NODE_OPTIONS=--require dd-trace/init`

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

> **Node version:** the apps are pinned to **Node 16** (see Dockerfiles). A bare
> `next build` on a very new host Node (e.g. 18+/20+/26) can fail inside Next 10's
> bundled `postcss` with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Build via Docker (which
> uses `node:16-alpine`) or `nvm use 16` for local, non-Docker builds.

## Local run & test with Kafka + Datadog tracing (verified)

The checkout path is **event-driven** and **traced with `dd-trace`**:

```
browser ─POST /api/checkout→ storefront BFF proxy ─→ store-api /checkout
   → Kafka (griddog-checkouts) → consumer → MongoDB → socket.io "checkout:done" → browser
```

APM spans/tags were added along this flow (all tags share a `checkout.*` naming
scheme so a single trace can be filtered by `checkout.transaction_id`):

- **storefront BFF proxy** (`storefront/pages/api/[...path].ts`) — buffers the
  request body and tags `checkout.request_body`, `checkout.request_body_bytes`,
  `checkout.transaction_id` (for `POST /checkout`); non-checkout routes use `bff.*` tags.
- **store-api** (`store-api/src/checkout/checkout.service.ts`) — tags
  `checkout.request_body`, `checkout.transaction_id`, `checkout.items`,
  `checkout.customer`, `checkout.total`, `checkout.status`, `checkout.created_at`.
- **store-api realtime** (`store-api/src/realtime/realtime.service.ts`) — creates
  `socket.io` spans for `subscribe` / `emit checkout:done` with `checkout.*` tags.

> Both `store-api` and `storefront` start the tracer via
> `NODE_OPTIONS=--require dd-trace/init` (in their Dockerfiles / `start` scripts).
> `store-api` was bumped to **NestJS 7.6.18** so `dd-trace` installs cleanly
> (the old `7.0.0` pin had an incompatible `@nestjs/core` peer on `@nestjs/common@^6`).

### 1. Start Kafka (creates the shared `kafka_default` network)

The main stack joins the Kafka cluster's compose network, so bring Kafka up **first**:

```bash
cd kafka
EC2_PRIVATE_IP=127.0.0.1 docker compose up -d     # 3 brokers (KRaft), RF=3
docker compose ps                                 # kafka1/2/3 should be Up
```

### 2. Build & start the main stack

```bash
cd ..                          # repo root
docker compose build           # builds all 4 images on node:16-alpine
docker compose up -d           # mongo + store-api + storefront + cms-api + cms-ui
docker compose ps              # all services Up
```

Seed sample products (host needs Node + the repo deps):

```bash
npm install && npm run seed
```

### 3. Test

**Health & reads:**
```bash
curl -s localhost:4000/health                       # {"ok":true}
curl -s localhost:4000/products | head -c 200        # seeded products
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/products   # BFF proxy → 200
curl -s localhost:3000/api/config                    # {"socketUrl":"http://localhost:4000"}
```

**Full end-to-end checkout** (socket subscribe → POST → Kafka → consumer → `checkout:done`):
```bash
BASE=http://localhost:4000 node kafka/e2e-checkout.js
# socket connected ...
# POST /checkout -> 202 {"transactionId":"e2e-...","total":9998,"status":"processing"}
# RECEIVED checkout:done -> {"transactionId":"e2e-...","total":9998,"status":"done"}
```

**Checkout through the storefront BFF proxy** (exercises the buffered-body proxy):
```bash
TXN="bff-$(date +%s)"
curl -s -w "\nHTTP %{http_code}\n" -X POST localhost:3000/api/checkout \
  -H 'Content-Type: application/json' \
  -d "{\"transactionId\":\"$TXN\",\"items\":[{\"productId\":\"x\",\"name\":\"Hoodie\",\"price\":4999,\"qty\":2}],\"customer\":{\"name\":\"BFF\",\"email\":\"bff@x.com\"}}"
# -> HTTP 202
```

**Verify the pipeline persisted the order:**
```bash
docker compose logs store-api --tail 20 | grep -E 'produced|consuming|persisted'
docker compose exec -T mongo mongosh griddog --quiet \
  --eval 'printjson(db.checkouts.find().sort({createdAt:-1}).limit(1).toArray())'
```

Or click through the UI: **http://localhost:3000** → add to cart → checkout → watch
it move from *Processing…* to *Done ✅* (that transition is the socket.io `checkout:done`).

> **Seeing the traces in Datadog:** this compose has **no Datadog Agent**, so
> `dd-trace` builds spans but cannot export them (it logs connection-refused to the
> agent — harmless for functionality). To ship traces, add a `datadog-agent` service
> with `DD_API_KEY` and point the apps at it via `DD_AGENT_HOST` / `DD_TRACE_AGENT_URL`.

### 4. Teardown

```bash
docker compose down            # from repo root — stops the main stack
cd kafka && docker compose down # stops the Kafka cluster (optional)
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
