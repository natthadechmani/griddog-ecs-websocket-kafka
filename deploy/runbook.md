# gridDog — AWS ECS Fargate Deployment Runbook

This deploys the 4 service images to **ECS Fargate** and points them at a
**MongoDB 8.0.23 instance running on EC2**.

```
Internet ──ALB──▶ storefront (3000) ──▶ store-api (4000) ─┐
         └─ALB──▶ cms task: cms-ui (3001) ──localhost──▶  │
                                       cms-api (4001) ─────┼──▶ MongoDB on EC2 (27017)
                                                           ┘
```

Services and images:

| Service     | Image repo              | Port | Notes                                   |
|-------------|-------------------------|------|-----------------------------------------|
| storefront  | griddog-storefront      | 3000 | public; proxies /api → store-api        |
| store-api   | griddog-store-api       | 4000 | internal; products read + checkout      |
| cms-ui      | griddog-cms-ui          | 3001 | public; proxies /api → localhost:4001   |
| cms-api     | griddog-cms-api         | 4001 | **same task as cms-ui**; product CRUD   |

`cms-ui` and `cms-api` are two containers in **one** task definition
(`ecs/cms.taskdef.json`) and talk over `localhost` (shared awsvpc netns).

---

## 1. MongoDB on EC2

1. Launch an EC2 instance (Amazon Linux 2023, e.g. `t3.small`) in the VPC you'll
   use for ECS. Give it a **security group `sg-mongo`**.
2. Install MongoDB 8.0.23 (Amazon Linux 2023 example):
   ```bash
   sudo tee /etc/yum.repos.d/mongodb-org-8.0.repo >/dev/null <<'EOF'
   [mongodb-org-8.0]
   name=MongoDB Repository
   baseurl=https://repo.mongodb.org/yum/amazon/2023/mongodb-org/8.0/x86_64/
   gpgcheck=1
   enabled=1
   gpgkey=https://pgp.mongodb.com/server-8.0.asc
   EOF
   sudo yum install -y mongodb-org-8.0.23
   sudo systemctl enable --now mongod
   ```
3. Bind to the private IP and enable auth in `/etc/mongod.conf`:
   ```yaml
   net:
     port: 27017
     bindIp: 127.0.0.1,<EC2_PRIVATE_IP>
   security:
     authorization: enabled
   ```
4. Create the app user/db, then restart `mongod`:
   ```bash
   mongosh <<'EOF'
   use admin
   db.createUser({ user: "griddog", pwd: "CHANGE_ME", roles: [{ role: "readWrite", db: "griddog" }] })
   EOF
   sudo systemctl restart mongod
   ```
   Connection string:
   `mongodb://griddog:CHANGE_ME@<EC2_PRIVATE_IP>:27017/griddog?authSource=admin`
5. **Security group:** on `sg-mongo`, allow inbound TCP **27017 only from the ECS
   tasks' security group** (`sg-ecs`). Do not open 27017 to the internet.

Store the connection string in Secrets Manager (referenced by the task defs):
```bash
aws secretsmanager create-secret --name griddog/mongo-uri \
  --secret-string 'mongodb://griddog:CHANGE_ME@<EC2_PRIVATE_IP>:27017/griddog?authSource=admin'
```

## 2. ECR repositories + push images

```bash
for r in griddog-store-api griddog-cms-api griddog-storefront griddog-cms-ui; do
  aws ecr create-repository --repository-name "$r" >/dev/null
done

AWS_ACCOUNT_ID=<ACCOUNT_ID> AWS_REGION=<REGION> ./deploy/ecr-build-push.sh
```
> Images are built `--platform linux/amd64` (Fargate is amd64; matters if you build on an Apple Silicon Mac).

## 3. ECS cluster + networking

1. Create a Fargate cluster (`griddog`) in the **same VPC** as the EC2 Mongo.
2. Create a **Cloud Map / Service Connect namespace** `griddog.local` so the
   storefront can resolve `store-api.griddog.local`.
3. Security groups:
   - `sg-ecs` — attached to all tasks. Outbound to `sg-mongo:27017`.
   - `sg-alb` — ALB; inbound 80/443 from the internet.
   - `sg-ecs` inbound from `sg-alb` on 3000 (storefront) and 3001 (cms-ui).

## 4. Register task definitions

Edit the 3 JSONs in `deploy/ecs/` and replace `<ACCOUNT_ID>` and `<REGION>`
(and the secret ARN). Then:
```bash
aws ecs register-task-definition --cli-input-json file://deploy/ecs/store-api.taskdef.json
aws ecs register-task-definition --cli-input-json file://deploy/ecs/cms.taskdef.json
aws ecs register-task-definition --cli-input-json file://deploy/ecs/storefront.taskdef.json
```
Create the log groups first (or enable `awslogs-create-group`):
```bash
for g in /ecs/griddog-store-api /ecs/griddog-cms /ecs/griddog-storefront; do
  aws logs create-log-group --log-group-name "$g" || true
done
```

## 5. Create services + ALB

1. **ALB** in public subnets with `sg-alb`. Two target groups:
   - `tg-storefront` → port 3000, health check path `/`
   - `tg-cms` → port 3001, health check path `/`
   Listener rules route by host/path (e.g. `shop.example.com` → storefront,
   `cms.example.com` → cms-ui).
2. **store-api service** — no ALB; register it in Service Connect as
   `store-api` (port 4000) so storefront resolves `store-api.griddog.local:4000`.
3. **storefront service** — attach to `tg-storefront`; `STORE_API_URL` already
   points at the Service Connect DNS in the task def.
4. **cms service** — attach the **cms-ui container** (port 3001) to `tg-cms`.
   `cms-api` needs no target group; only its sibling reaches it on
   `localhost:4001`.

All services: Fargate, `sg-ecs`, private subnets (with NAT for ECR pulls) or
public subnets with `assignPublicIp=ENABLED`.

## 6. Seed product data (once)

From a host that can reach the EC2 Mongo (e.g. the EC2 box itself, or via a
bastion / VPN):
```bash
MONGO_URI='mongodb://griddog:CHANGE_ME@<EC2_PRIVATE_IP>:27017/griddog?authSource=admin' \
  npm install && npm run seed
```

## 7. Verify

- `https://shop.example.com` → product grid loads → add to cart → checkout →
  confirmation page.
- `https://cms.example.com` → create/edit-price/delete a product → refresh the
  storefront and confirm the change.
- ECS console: the `griddog-cms` task shows **both** containers `RUNNING`.
- CloudWatch: `/ecs/griddog-*` log groups show startup + request logs;
  store-api/cms-api log "Connected to MongoDB" (no connection timeouts).

## Notes / hardening (out of scope for the demo)
- No auth on cms-ui/cms-api — put them behind ALB auth (Cognito/OIDC) or a
  private ALB before any real exposure.
- Use HTTPS (ACM cert on the ALB) and restrict `sg-mongo` tightly.
- Consider splitting cms-ui/cms-api into separate services if they need to
  scale independently.
