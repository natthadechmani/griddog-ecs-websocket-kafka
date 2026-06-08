# Deploy gridDog to ECS Fargate — Beginner Step‑by‑Step

This walks you through deploying all services to **AWS ECS Fargate** so they can
talk to each other, using **MongoDB Atlas** as the database (no EC2 to manage).
Every command is copy‑pasteable. Read the "Concepts" box once, then follow the
steps in order.

> 🔐 **Security first:** never put the Mongo password in a Dockerfile, in
> `environment`, or in git. We put it in **AWS Secrets Manager** and the task
> reads it at runtime. If you shared the password anywhere, rotate it in Atlas
> (Database Access → edit user → Edit Password) before continuing.

---

## Concepts (read once)

| Term | What it is | In this app |
|------|-----------|-------------|
| **Cluster** | A logical group your services run in | `griddog` |
| **Task definition** | A blueprint: which image(s), CPU/mem, env, ports | one per service; `cms` has 2 containers |
| **Task** | A running instance of a task definition | the actual container(s) |
| **Service** | Keeps N tasks running & registers them with the load balancer | `store-api`, `storefront`, `cms` |
| **ALB** (Application Load Balancer) | Public entry point; routes HTTP to tasks | one ALB, 2 listeners |
| **Target group** | A pool of tasks the ALB forwards to + health checks | one per public UI |
| **Security group (SG)** | A virtual firewall | `griddog-alb`, `griddog-tasks` |
| **Service Connect** | ECS's built‑in service discovery — gives services DNS names like `store-api:4000` | how storefront finds store-api |
| **Secrets Manager** | Stores secrets; tasks read them at start | the Mongo URI |

**How the 3 services talk:**
- Browser → **ALB** → `storefront` (port 3000) and `cms-ui` (port 3001).
- `storefront` (server side) → `http://store-api:4000` via **Service Connect**.
- `cms-ui` → `cms-api` over **`localhost:4001`** (same task, no networking needed).
- `store-api` + `cms-api` → **MongoDB Atlas** over the internet (TLS + auth).

```
Internet
   │  :80                         :8080
   ▼                              ▼
 ┌──────────────── ALB (griddog-alb) ────────────────┐
 │  listener :80 → storefront     listener :8080 → cms │
 └─────┬───────────────────────────────────┬──────────┘
       ▼                                    ▼
  storefront:3000                    cms task ┌ cms-ui:3001 ┐
       │ Service Connect                      │   │localhost  │
       ▼                                      │   ▼           │
  store-api:4000                              └ cms-api:4001 ─┘
       │                                          │
       └──────────────► MongoDB Atlas ◄───────────┘
```

---

## Prerequisites

```bash
aws --version           # AWS CLI v2
docker --version        # Docker running
aws sts get-caller-identity   # you are logged in
```

Set shell variables you'll reuse (pick your region):
```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account $AWS_ACCOUNT_ID in $AWS_REGION"
```

---

## Step 0 — Choose your database

### Option A — MongoDB Atlas (recommended, used in this guide)
Nothing to install. You just need:
1. A strong password on your Atlas DB user (rotate the demo one!).
2. **Network access:** Atlas → *Network Access* → *Add IP Address*. For a quick
   demo add `0.0.0.0/0` (allow from anywhere — safe‑ish because Atlas still
   requires user/password + TLS). For production, instead run tasks in private
   subnets behind a NAT Gateway with a fixed Elastic IP and allowlist only that.
3. Your connection string, **with the database name added** and the password
   filled in. Atlas SRV strings have no db in them, so the app uses the
   `MONGO_DB_NAME` env var (set to `griddog` in the task definitions).
   ```
   mongodb+srv://datadog:<NEW_PASSWORD>@grid-mock-mg-db.ml8aotx.mongodb.net/?retryWrites=true&w=majority&appName=grid-mock-mg-db
   ```

### Option B — MongoDB on EC2
Use [`runbook.md`](./runbook.md) section 1 instead, then come back here and use
its `mongodb://user:pass@<private-ip>:27017/griddog` string in Step 2. You'll
also need the tasks and the EC2 in the same VPC with an SG rule on 27017.

---

## Step 1 — Store the Mongo URI in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name griddog/mongo-uri \
  --region "$AWS_REGION" \
  --secret-string 'mongodb+srv://datadog:<NEW_PASSWORD>@grid-mock-mg-db.ml8aotx.mongodb.net/?retryWrites=true&w=majority&appName=grid-mock-mg-db'

# Save its ARN for later:
export SECRET_ARN=$(aws secretsmanager describe-secret --secret-id griddog/mongo-uri \
  --region "$AWS_REGION" --query ARN --output text)
echo "$SECRET_ARN"
```

---

## Step 2 — Create ECR repositories and push images

```bash
for r in griddog-store-api griddog-cms-api griddog-storefront griddog-cms-ui; do
  aws ecr create-repository --repository-name "$r" --region "$AWS_REGION" >/dev/null 2>&1 || true
done

# Build all 4 images and push (script is in this repo)
AWS_ACCOUNT_ID="$AWS_ACCOUNT_ID" AWS_REGION="$AWS_REGION" ./deploy/ecr-build-push.sh
```
> On Apple Silicon this builds `linux/amd64` (Fargate is amd64) — already handled
> by the script's `--platform` flag.

---

## Step 3 — Find your default VPC and subnets

Using the default VPC keeps this simple (its subnets are public, so tasks can
pull from ECR and reach Atlas without a NAT Gateway).

```bash
export VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --region "$AWS_REGION" --query 'Vpcs[0].VpcId' --output text)

export SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID \
  --region "$AWS_REGION" --query 'Subnets[].SubnetId' --output text)
export SUBNET_CSV=$(echo $SUBNETS | tr ' ' ',')

echo "VPC=$VPC_ID"; echo "SUBNETS=$SUBNET_CSV"
```

---

## Step 4 — Create security groups (the firewalls)

```bash
# ALB SG: allow the public in on 80 and 8080
export ALB_SG=$(aws ec2 create-security-group --group-name griddog-alb \
  --description "griddog ALB" --vpc-id $VPC_ID --region "$AWS_REGION" \
  --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 80   --cidr 0.0.0.0/0 --region "$AWS_REGION"
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 8080 --cidr 0.0.0.0/0 --region "$AWS_REGION"

# Tasks SG
export TASK_SG=$(aws ec2 create-security-group --group-name griddog-tasks \
  --description "griddog tasks" --vpc-id $VPC_ID --region "$AWS_REGION" \
  --query GroupId --output text)
# ALB -> storefront(3000) and cms-ui(3001)
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 3000 --source-group $ALB_SG --region "$AWS_REGION"
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 3001 --source-group $ALB_SG --region "$AWS_REGION"
# storefront -> store-api(4000) over Service Connect (tasks talking to each other)
aws ec2 authorize-security-group-ingress --group-id $TASK_SG --protocol tcp --port 4000 --source-group $TASK_SG --region "$AWS_REGION"

echo "ALB_SG=$ALB_SG  TASK_SG=$TASK_SG"
```

---

## Step 5 — IAM execution role (lets ECS pull images, write logs, read the secret)

```bash
# Create the role (skip if you already have ecsTaskExecutionRole)
aws iam create-role --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' 2>/dev/null || true

aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Allow it to read OUR secret (the managed policy above does NOT include this)
aws iam put-role-policy --role-name ecsTaskExecutionRole --policy-name griddog-read-secret \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":\"$SECRET_ARN\"}]}"
```

---

## Step 6 — CloudWatch log groups

```bash
for g in /ecs/griddog-store-api /ecs/griddog-cms /ecs/griddog-storefront; do
  aws logs create-log-group --log-group-name "$g" --region "$AWS_REGION" 2>/dev/null || true
done
```

---

## Step 7 — Create the cluster (with a Service Connect namespace)

```bash
aws ecs create-cluster --cluster-name griddog \
  --service-connect-defaults namespace=griddog \
  --region "$AWS_REGION"
```
This also creates a Cloud Map namespace named `griddog` that Service Connect uses
for DNS like `store-api`.

---

## Step 8 — Fill in the task definitions and register them

The JSON files in `deploy/ecs/` have `<ACCOUNT_ID>`, `<REGION>`, and the secret
ARN as placeholders. Fill them in with `sed` into temp copies, then register:

```bash
mkdir -p /tmp/griddog-td
for f in store-api cms storefront; do
  sed -e "s|<ACCOUNT_ID>|$AWS_ACCOUNT_ID|g" \
      -e "s|<REGION>|$AWS_REGION|g" \
      -e "s|arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:griddog/mongo-uri|$SECRET_ARN|g" \
      "deploy/ecs/$f.taskdef.json" > "/tmp/griddog-td/$f.json"
  aws ecs register-task-definition --cli-input-json "file:///tmp/griddog-td/$f.json" --region "$AWS_REGION" >/dev/null
  echo "registered $f"
done
```
> The secret ARN from `describe-secret` ends in `-AbCdEf`. The `sed` above matches
> the placeholder exactly, so it's replaced with your real ARN including suffix.

---

## Step 9 — Create the load balancer, target groups, and listeners

```bash
# ALB (needs >=2 subnets in different AZs — the default VPC has them)
export ALB_ARN=$(aws elbv2 create-load-balancer --name griddog-alb \
  --type application --subnets $SUBNETS --security-groups $ALB_SG \
  --region "$AWS_REGION" --query 'LoadBalancers[0].LoadBalancerArn' --output text)

export ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN \
  --region "$AWS_REGION" --query 'LoadBalancers[0].DNSName' --output text)

# Target groups (target-type ip is REQUIRED for Fargate/awsvpc)
export TG_STORE=$(aws elbv2 create-target-group --name griddog-storefront \
  --protocol HTTP --port 3000 --vpc-id $VPC_ID --target-type ip \
  --health-check-path / --region "$AWS_REGION" \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

export TG_CMS=$(aws elbv2 create-target-group --name griddog-cms-ui \
  --protocol HTTP --port 3001 --vpc-id $VPC_ID --target-type ip \
  --health-check-path / --region "$AWS_REGION" \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

# Listeners: :80 -> storefront, :8080 -> cms-ui (one ALB, two ports, no domain needed)
aws elbv2 create-listener --load-balancer-arn $ALB_ARN --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_STORE --region "$AWS_REGION" >/dev/null
aws elbv2 create-listener --load-balancer-arn $ALB_ARN --protocol HTTP --port 8080 \
  --default-actions Type=forward,TargetGroupArn=$TG_CMS --region "$AWS_REGION" >/dev/null

echo "Your URLs will be:"
echo "  Storefront: http://$ALB_DNS"
echo "  CMS admin:  http://$ALB_DNS:8080"
```

---

## Step 10 — Create the three services

`store-api` advertises itself via Service Connect; `storefront` is a Service
Connect client AND sits behind the ALB; `cms` just sits behind the ALB.

```bash
NET="awsvpcConfiguration={subnets=[$SUBNET_CSV],securityGroups=[$TASK_SG],assignPublicIp=ENABLED}"

# store-api — internal only, registers DNS name "store-api:4000"
aws ecs create-service --cluster griddog --service-name store-api \
  --task-definition griddog-store-api --desired-count 1 --launch-type FARGATE \
  --network-configuration "$NET" --region "$AWS_REGION" \
  --service-connect-configuration '{"enabled":true,"namespace":"griddog","services":[{"portName":"store-api","clientAliases":[{"port":4000,"dnsName":"store-api"}]}]}' >/dev/null
echo "created store-api"

# storefront — behind ALB :80, and a Service Connect client so it can resolve store-api
aws ecs create-service --cluster griddog --service-name storefront \
  --task-definition griddog-storefront --desired-count 1 --launch-type FARGATE \
  --network-configuration "$NET" --region "$AWS_REGION" \
  --load-balancers targetGroupArn=$TG_STORE,containerName=storefront,containerPort=3000 \
  --service-connect-configuration '{"enabled":true,"namespace":"griddog"}' >/dev/null
echo "created storefront"

# cms — behind ALB :8080 (cms-ui container); cms-api talks over localhost in-task
aws ecs create-service --cluster griddog --service-name cms \
  --task-definition griddog-cms --desired-count 1 --launch-type FARGATE \
  --network-configuration "$NET" --region "$AWS_REGION" \
  --load-balancers targetGroupArn=$TG_CMS,containerName=cms-ui,containerPort=3001 >/dev/null
echo "created cms"
```

Watch them come up (wait until `runningCount` = 1 for each):
```bash
aws ecs describe-services --cluster griddog --services store-api storefront cms \
  --region "$AWS_REGION" --query 'services[].{name:serviceName,running:runningCount,desired:desiredCount}'
```

---

## Step 11 — Seed product data into Atlas (once)

Your local `npm` may block installing `mongodb` (OSV guard), so seed via a
throwaway container:
```bash
docker run --rm -v "$PWD/scripts":/s -w /s \
  -e MONGO_URI='mongodb+srv://datadog:<NEW_PASSWORD>@grid-mock-mg-db.ml8aotx.mongodb.net/?retryWrites=true&w=majority&appName=grid-mock-mg-db' \
  -e MONGO_DB_NAME=griddog \
  node:16-alpine sh -c "npm install mongodb@4 --no-audit --no-fund && node seed.js"
```
Expect: `Seeded 6 products into griddog.products`.

---

## Step 12 — Test

```bash
curl -s "http://$ALB_DNS/api/products" | head -c 300 ; echo      # storefront proxy -> store-api -> Atlas
open "http://$ALB_DNS"          # storefront (macOS; or paste in a browser)
open "http://$ALB_DNS:8080"     # cms admin
```
- Storefront: browse → add to cart → checkout → confirmation.
- CMS: add/edit‑price/delete a product, then refresh the storefront.

---

## Updating a service after a code change

```bash
AWS_ACCOUNT_ID="$AWS_ACCOUNT_ID" AWS_REGION="$AWS_REGION" ./deploy/ecr-build-push.sh
# re-register the changed task def (Step 8) if env/ports changed, then:
aws ecs update-service --cluster griddog --service storefront --force-new-deployment --region "$AWS_REGION"
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Task stuck **PENDING** then **STOPPED** | Can't pull image: needs `assignPublicIp=ENABLED` (default VPC) or a NAT Gateway. Check `aws ecs describe-tasks ... --query 'tasks[].stoppedReason'`. |
| Stopped reason mentions **Secrets Manager** / AccessDenied | Step 5 inline policy missing, or wrong `SECRET_ARN`. |
| ALB returns **503** | No healthy targets: check the target group health, that `TASK_SG` allows the ALB SG on 3000/3001, and health‑check path `/` returns 200. |
| App logs **Mongo connection timeout** | Atlas *Network Access* doesn't allow the task's IP — add `0.0.0.0/0` for the demo (or NAT EIP). |
| Data goes to db **`test`** not `griddog` | `MONGO_DB_NAME=griddog` missing — it's in the task defs; re‑register if you edited them. |
| storefront logs **ECONNREFUSED store-api** | Service Connect not enabled on both services, or `TASK_SG` self‑rule on 4000 missing (Step 4). |
| Logs | `aws logs tail /ecs/griddog-storefront --follow --region "$AWS_REGION"` (also `/ecs/griddog-store-api`, `/ecs/griddog-cms`). |

---

## Tear down (stop paying)

```bash
aws ecs update-service --cluster griddog --service storefront --desired-count 0 --region "$AWS_REGION"
aws ecs update-service --cluster griddog --service cms        --desired-count 0 --region "$AWS_REGION"
aws ecs update-service --cluster griddog --service store-api  --desired-count 0 --region "$AWS_REGION"
for s in storefront cms store-api; do aws ecs delete-service --cluster griddog --service $s --force --region "$AWS_REGION"; done
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN --region "$AWS_REGION"
aws elbv2 delete-target-group --target-group-arn $TG_STORE --region "$AWS_REGION"
aws elbv2 delete-target-group --target-group-arn $TG_CMS --region "$AWS_REGION"
aws ecs delete-cluster --cluster griddog --region "$AWS_REGION"
# then delete the two SGs, the secret, ECR repos, and log groups if you want a clean slate
```
(Atlas keeps running independently — pause/delete the cluster in the Atlas UI if
it's only for this demo.)
