# Deploy gridDog to ECS Fargate — AWS Console, step by step

Deploys **storefront**, **store-api**, and **cms** (cms-ui + cms-api in one task) to
ECS Fargate, wired with **Service Connect** (internal service discovery) and an
**Application Load Balancer** (public access, health checks, and **WebSocket**
support for the realtime checkout notification).

Region used throughout: **ap-southeast-1**. Account: **369042512949**. Adjust to yours.

---

## 0. Architecture & port map

```
                         Internet / your IP
        :3000 │                :8080 │                :4000 │
              ▼                      ▼                      ▼
        ┌──────────────────────  ALB: griddog-alb  ──────────────────────┐
        │ listener :3000→TG storefront   :8080→TG cms-ui   :4000→TG store-api │
        └──────┬───────────────────────┬───────────────────────┬──────────┘
               ▼                        ▼                       ▼
        storefront :3000          cms task                 store-api :4000
          │  Next BFF proxy        ├ cms-ui  :3001          (HTTP + socket.io)
          │  /api/* → store-api    └ cms-api :4001 (localhost)     ▲
          ▼  (Service Connect)                                     │ Service Connect
        store-api :4000  ◄──────────────────────────────────────────┘
          │ Kafka produce/consume                browser socket.io ──► ALB :4000 ──► store-api
          ▼
        MongoDB (Atlas)        MSK (Kafka, :9098 IAM)
```

| Service | Container(s) : port | ALB listener | Target group (type IP) | Health check | Service Connect |
|---|---|---|---|---|---|
| storefront | `storefront:3000` | **:3000** | `griddog-storefront` → 3000 | **`/`** | client (resolves `store-api`) |
| cms | `cms-ui:3001` + `cms-api:4001` | **:8080** → cms-ui | `griddog-cms-ui` → 3001 | **`/`** | none (cms-ui→cms-api via `localhost`) |
| store-api | `store-api:4000` | **:4000** (WebSocket) | `griddog-store-api` → 4000 | **`/health`** | **server** (`store-api:4000`) |

> **Health-check paths differ per service** — this bit us repeatedly:
> store-api **has** `/health`; storefront and cms-ui **do not** (use `/`).

---

## 1. Prerequisites

- [ ] **Images in ECR** (`griddog-store-api`, `griddog-storefront`, `griddog-cms-ui`, `griddog-cms-api`) — push via `deploy/ecr-build-push.sh` or `deploy/push-version.sh`.
- [ ] **Secrets Manager:** `griddog/mongo-uri` (Mongo/Atlas conn string) and, if using the Datadog agent, `griddog/dd-api-key`.
- [ ] **MSK cluster Active** (IAM auth, :9098) — grab its **bootstrap string** from *MSK → View client information → Private endpoint (IAM)*.
- [ ] **IAM roles** (Section 2).
- [ ] A **VPC** with ≥2 subnets in different AZs (the default VPC is fine).

---

## 2. IAM roles

**Execution role** (`ecsTaskExecutionRole-Grid`) — used by ECS to pull images, write logs, read secrets:
- Trusted entity: *Elastic Container Service Task*.
- Attach managed **`AmazonECSTaskExecutionRolePolicy`**.
- Add inline policy `griddog-logs` (auto-create log groups):
  ```json
  {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],"Resource":"*"}]}
  ```
- Add inline policy `griddog-read-secret` (read both secrets):
  ```json
  {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"secretsmanager:GetSecretValue","Resource":[
    "arn:aws:secretsmanager:ap-southeast-1:369042512949:secret:griddog/mongo-uri-*",
    "arn:aws:secretsmanager:ap-southeast-1:369042512949:secret:griddog/dd-api-key-*"]}]}
  ```

**Task role** (`datadog-task-role-grid`) — used by the **running store-api app** to reach MSK (IAM) and (optionally) the agent to query ECS:
- Trusted entity: *Elastic Container Service Task*.
- Inline policy (Kafka IAM), replace `<CLUSTER_NAME>`:
  ```json
  {"Version":"2012-10-17","Statement":[
    {"Effect":"Allow","Action":["kafka-cluster:Connect","kafka-cluster:DescribeCluster"],"Resource":"arn:aws:kafka:ap-southeast-1:369042512949:cluster/<CLUSTER_NAME>/*"},
    {"Effect":"Allow","Action":["kafka-cluster:CreateTopic","kafka-cluster:DescribeTopic","kafka-cluster:WriteData","kafka-cluster:ReadData"],"Resource":"arn:aws:kafka:ap-southeast-1:369042512949:topic/<CLUSTER_NAME>/*"},
    {"Effect":"Allow","Action":["kafka-cluster:AlterGroup","kafka-cluster:DescribeGroup"],"Resource":"arn:aws:kafka:ap-southeast-1:369042512949:group/<CLUSTER_NAME>/*"}]}
  ```
- store-api uses this as **Task role**; storefront/cms can leave Task role = None (they make no AWS API calls). All three use `ecsTaskExecutionRole-Grid` as **Execution role**.

---

## 3. Security groups (*EC2 → Security groups*)

Create two. **Tasks SG only ever references other SGs** (no `0.0.0.0/0` needed).

**`griddog-alb`** — inbound from the internet (or **My IP** if your org blocks 0.0.0.0/0):
| Type | Port | Source |
|---|---|---|
| Custom TCP | 3000 | My IP / 0.0.0.0/0 |
| Custom TCP | 8080 | My IP / 0.0.0.0/0 |
| Custom TCP | 4000 | My IP / 0.0.0.0/0 |

**`griddog-tasks`** — inbound (sources are SGs):
| Type | Port | Source | For |
|---|---|---|---|
| Custom TCP | 3000 | `griddog-alb` | storefront (ALB → task + health) |
| Custom TCP | 3001 | `griddog-alb` | cms-ui (ALB → task + health) |
| Custom TCP | 4000 | `griddog-alb` | **store-api socket + health** ← easy to forget |
| Custom TCP | 4000 | `griddog-tasks` | Service Connect (storefront → store-api) |

> cms-api `:4001` needs **no** SG rule — it's reached only over `localhost` inside the cms task.

**MSK SG** — add inbound **TCP 9098 from `griddog-tasks`** (so store-api can reach Kafka over IAM).

---

## 4. ECS cluster + Service Connect namespace

*ECS → Clusters → Create cluster*:
- Name **`griddog`**, Infrastructure **AWS Fargate**.
- Expand **Namespace** → set **`griddog`** (creates the Service Connect / Cloud Map namespace).

---

## 5. Target groups (*EC2 → Target groups → Create*, ×3)

For all: **Target type = IP addresses** (required for Fargate), Protocol **HTTP**, VPC = yours, Protocol version **HTTP1**. **Register no targets** (the ECS service does it). Distinct health-check paths:

| Name | Port | Health check path |
|---|---|---|
| `griddog-storefront` | 3000 | **`/`** |
| `griddog-cms-ui` | 3001 | **`/`** |
| `griddog-store-api` | 4000 | **`/health`** |

---

## 6. Load balancer + listeners (*EC2 → Load balancers*)

Create `griddog-alb` (Application, internet-facing, ≥2 subnets, SG `griddog-alb`) — or reuse it — with **three listeners**:
| Listener | Forward to |
|---|---|
| HTTP **:3000** | `griddog-storefront` |
| HTTP **:8080** | `griddog-cms-ui` |
| HTTP **:4000** | `griddog-store-api` |

**WebSocket:** the ALB supports WebSockets natively on the :4000 listener — no extra setting. If you ever run **>1 store-api task**, enable **stickiness on the `griddog-store-api` target group** (load-balancer cookie) so socket.io's polling handshake stays on one task.

After creation, note the ALB **DNS name** — you'll need it for `SOCKET_URL`.

---

## 7. Task definitions (*ECS → Task definitions → Create new revision*)

All: launch type **FARGATE**, OS **Linux/X86_64**, **Execution role `ecsTaskExecutionRole-Grid`**.
For each container env var that holds a secret, use **Value type = ValueFrom** with the secret ARN.

### 7a. `griddog-store-api`  (CPU 1 vCPU / 2 GB — room for the agent)
- **Task role:** `datadog-task-role-grid`
- **Container `store-api`:**
  - Image `…/griddog-store-api:latest`, essential **yes**
  - Port **4000**, name **`store-api`**, appProtocol **HTTP** (needed for Service Connect)
  - Env:
    ```
    PORT=4000
    MONGO_DB_NAME=griddog
    AWS_REGION=ap-southeast-1
    KAFKA_BROKERS=<MSK IAM bootstrap :9098>
    KAFKA_AUTH=iam
    KAFKA_SSL=true
    KAFKA_TOPIC=griddog-checkouts
    KAFKA_TOPIC_RF=2          # 2-broker MSK → RF can't exceed broker count
    KAFKA_TOPIC_PARTITIONS=3
    DD_SERVICE=griddog-store-api
    DD_ENV=ecs-dev
    DD_TRACE_AGENT_URL=unix:///var/run/datadog/apm.socket
    ```
  - Secret (ValueFrom): `MONGO_URI` = `griddog/mongo-uri` ARN
  - Mount point: source `dd-socket` → `/var/run/datadog`
- **Container `datadog-agent`** (sidecar, optional but recommended):
  - Image `public.ecr.aws/datadog/agent:latest`, essential **no**
  - Env: `DD_SITE=datadoghq.com`, `DD_APM_ENABLED=true`, `ECS_FARGATE=true`, `DD_APM_RECEIVER_SOCKET=/var/run/datadog/apm.socket`
  - Secret (ValueFrom): `DD_API_KEY` = `griddog/dd-api-key` ARN
  - Mount point: source `dd-socket` → `/var/run/datadog`
- **Volume:** add a **Bind mount** named `dd-socket` (Configure at task definition creation).

### 7b. `griddog-cms`  (CPU .5 vCPU / 1 GB; bump to 1/2 if adding the agent)
- Task role: None
- **Container `cms-api`:** image `…/griddog-cms-api:latest`, port **4001**, env `PORT=4001`, `MONGO_DB_NAME=griddog`; secret `MONGO_URI` (ValueFrom).
- **Container `cms-ui`:** image `…/griddog-cms-ui:latest`, port **3001**, env `CMS_API_URL=http://localhost:4001` (same task → localhost). Startup dependency: `cms-api` condition **START**.

### 7c. `griddog-storefront`  (CPU .5 vCPU / 1 GB)
- Task role: None
- **Container `storefront`:** image `…/griddog-storefront:latest`, port **3000**, env:
  ```
  STORE_API_URL=http://store-api:4000      # Service Connect DNS (internal)
  SOCKET_URL=http://<ALB-DNS>:4000         # browser connects socket here (the ALB :4000)
  DD_SERVICE=griddog-storefront
  DD_ENV=ecs-dev
  ```
  (Add a `datadog-agent` sidecar + `dd-socket` volume + `DD_TRACE_AGENT_URL` like 7a if you want storefront BFF traces shipped.)

---

## 8. Services (*ECS → Clusters → griddog → Create*, ×3)

Common: Launch type **FARGATE**, Desired **1**, Networking → your subnets, **Security group = `griddog-tasks`**, **Public IP = Turned on**, **Health check grace period = 120**.

> **Only ONE service may own a Service Connect name.** If a create fails with *"SC service is already used by … namespace"*, an old service still holds `store-api` — delete it (and any leftover **Cloud Map** service of that name in the `griddog` namespace) before retrying.

### 8a. store-api
- Task def `griddog-store-api`. Service name `store-api`.
- **Load balancing:** ALB `griddog-alb` → container **`store-api:4000`** → existing listener **:4000** → target group **`griddog-store-api`**.
- **Service Connect: ON** → **Client and server** → namespace `griddog` → port `store-api`: discovery/DNS **`store-api`**, port **4000**.

### 8b. storefront
- Task def `griddog-storefront`. Service name `storefront`.
- **Load balancing:** ALB → container **`storefront:3000`** → listener **:3000** → TG **`griddog-storefront`**.
- **Service Connect: ON** → **Client side only** → namespace `griddog` (so it can resolve `store-api`).

### 8c. cms
- Task def `griddog-cms`. Service name `cms`.
- **Load balancing:** ALB → container **`cms-ui:3001`** → listener **:8080** → TG **`griddog-cms-ui`**.
- **Service Connect: OFF** (cms-ui↔cms-api is in-task `localhost`).

---

## 9. Verify

1. **Tasks RUNNING** for all three (*cluster → Services*). store-api logs should show: `topic griddog-checkouts created/already exists` → `Kafka producer connected` → `consumer joined group` → `socket.io server initialized` → `store-api listening on 4000`.
2. **Target groups all healthy** (*EC2 → Target groups → Targets*). If unhealthy, see Troubleshooting.
3. **Storefront:** browse `http://<ALB-DNS>:3000` → add to cart → checkout → **Processing… → Done ✅** (the socket.io `checkout:done`).
4. **CMS:** `http://<ALB-DNS>:8080` → add/edit-price/delete a product → reflected in the storefront.
5. **Order persisted:** Mongo `checkouts` has the doc with your `transactionId`.
6. **Datadog:** APM service `griddog-store-api` shows traces; RUM (storefront) sessions correlate via `allowedTracingUrls`.

---

## 10. Troubleshooting (everything we actually hit)

| Symptom | Cause | Fix |
|---|---|---|
| Deploy **rolled back**, task was Running | ALB target unhealthy | check the TG **Targets → reason** (below) |
| Target reason **`[404]`** | wrong **health-check path** | store-api → **`/health`**; storefront/cms-ui → **`/`** |
| Target reason **"Request timed out"** | SG blocks ALB | add **port → from `griddog-alb`** on `griddog-tasks` (esp. **4000**) |
| store-api **crash-loops** at boot | can't reach MSK | MSK SG inbound **9098 from `griddog-tasks`**, task role attached, `KAFKA_AUTH=iam`, correct `:9098` bootstrap |
| Create service: **"SC service already used by … namespace"** | another service owns the SC name | delete old service + leftover **Cloud Map** `store-api` service, then retry |
| Frontend: **400 "transactionId is required"** | old storefront image running | redeploy storefront (Force new deployment) + hard-refresh browser |
| Checkout stuck on **Processing…** in prod | browser can't reach the socket | store-api **must** be on the ALB **:4000** (TG + listener + SG 4000 from `griddog-alb`), and `SOCKET_URL=http://<ALB>:4000` |
| Logs: `topic … Topic creation errors` then `already exists` | topic exists | benign — handled |
| kafkajs `group is rebalancing` during deploy | old+new task in the group briefly | benign |

**Health-check matrix (get this right):**
| Target group | Port | Path | + griddog-tasks inbound |
|---|---|---|---|
| `griddog-store-api` | 4000 | `/health` | 4000 from `griddog-alb` **and** 4000 from `griddog-tasks` |
| `griddog-storefront` | 3000 | `/` | 3000 from `griddog-alb` |
| `griddog-cms-ui` | 3001 | `/` | 3001 from `griddog-alb` |

---

## Updating a service after a code change
```bash
./deploy/push-version.sh latest <service>     # build+push image
```
Then *ECS → service → Update → (new task-def revision if env changed) → ✅ Force new deployment*. `:latest` requires Force new deployment to re-pull.
