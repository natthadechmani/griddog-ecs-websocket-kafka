# gridDog Load Test — Datadog ON vs OFF

Load-test the products API and compare latency/throughput with Datadog
(dd-trace + agent) **on** vs **off**. Same URL and same k6 command for both runs —
only the store-api **task-definition revision** changes between them.

## 1. Install k6
```bash
brew install k6
k6 version
```

## 2. Get your target URL
The public path: ALB → storefront (Next proxy) → store-api → Atlas.
```bash
# ALB DNS: EC2 console → Load balancers → griddog-alb → DNS name
export TARGET="http://<ALB-DNS>/api/products"
curl -s "$TARGET" | head -c 200    # sanity check: should return the products JSON
```

## 3. Find the ceiling (R_max)
```bash
k6 run -e TARGET="$TARGET" products-ramp.js
```
Read the summary: the highest ramp step where `http_req_failed` ≈ 0 and `p(95)`
is still acceptable is your sustainable rate, **R_max**. Pick ~70% of it as RATE below.
> If max RPS plateaus while Datadog shows store-api CPU near idle, you've hit your
> laptop's uplink, not the service. Rerun from an EC2/CloudShell in ap-southeast-1
> for a true ceiling.

## 4. Steady A/B run (do this for BOTH variants, same RATE)
```bash
k6 run -e TARGET="$TARGET" -e RATE=70 -e DURATION=2m products-load.js
```
Record from the summary: `http_reqs` rate, `http_req_duration` p50/p90/p95/p99,
`http_req_failed` %, and dropped iterations. Run it **twice** per variant; discard
the first (warm-up).

## 5. Switching variants (the only thing that changes)
The store-api image is identical for both — dd-trace is baked in but only loads
when `NODE_OPTIONS` requires it. Keep two task-definition revisions of
`griddog-store-api`:

| | OFF (baseline) | ON (Datadog) |
|---|---|---|
| `NODE_OPTIONS` env | `""` | `--require dd-trace/init` |
| `datadog-agent` sidecar | removed | present, `DD_APM_ENABLED=true`, `DD_SERVICE=store-api` |
| image / task CPU-mem | same | same |

Switch in the console: *ECS → Clusters → griddog → store-api service → **Update*** →
set **Revision** to the desired one → ✅ **Force new deployment** → Update.
**Wait until the new task is RUNNING + target healthy, then ~30s warm-up** before
running k6.

Order: deploy OFF → ramp + steady → deploy ON → ramp + steady.

## 6. While the ON run is going — look in Datadog
- **APM → Services → store-api**: latency (p50/p95/p99), throughput, errors; open a
  trace to see the Nest/Express + `mongodb` find spans (the flame graph).
- **Infrastructure / ECS**: the store-api task CPU & memory (app + agent) for the
  same time window — did the agent steal CPU under load?
- The OFF run has none of this — that's half the point of the comparison.

## 7. Results

### Test environment
- **store-api task: 0.25 vCPU / 0.5 GB**, desired-count = 1. storefront task likewise single/small.
- Load from a **laptop → public ALB** in ap-southeast-1 (internet RTT ~40–70 ms floor).
- Path under test: ALB :3000 → storefront (Next proxy) → store-api → MongoDB Atlas.
- k6 `constant-arrival-rate`, products query returns 6 docs.

### Baseline capacity curve (Datadog OFF — no agent, no tracer)
90 s steady runs at each rate:

| Offered RATE | Achieved RPS | p50 | p95 | p99 | Errors | Verdict |
|---|---|---|---|---|---|---|
| 50 | 50 | 69 ms | 259 ms | 396 ms | 0% | healthy ✅ |
| 75 | 75 | 69 ms | 260 ms | 379 ms | 0% | healthy ✅ |
| 100 | 100 | 135 ms | 499 ms | 711 ms | 0% | at the edge ⚠️ |
| 130 | ~116 | 3.66 s | 4.53 s | 5.17 s | 0%* | saturated cliff ❌ (924 dropped) |

\* requests still returned 200 but queued for seconds; k6 hit the VU cap and dropped iterations.

**Baseline R_max ≈ 100 rps**, with a sharp saturation cliff between 100 and 130 rps. Bandwidth was never the limit (~190 KB/s) — the ceiling is CPU on the single 0.25 vCPU Node tasks.

### Head-to-head @ 60 rps, 10 min (same rate, same everything except Datadog)

| Metric | OFF (no agent) | ON (agent + dd-trace) | Δ |
|---|---|---|---|
| Achieved RPS | 60 | **43** (couldn't sustain) | −28% |
| p50 latency | 61 ms | **10.53 s** | ~170× |
| p95 latency | 195 ms | **14.65 s** | ~75× |
| p99 latency | 304 ms | **15.01 s** | ~49× |
| Error rate | 0% | **3.74%** | +3.74 pp |
| Dropped iterations | 0 | **9,595** | — |

### Ramp comparison (10→150 rps over 6 stages)

| Ramp (same shape) | OFF (no agent) | ON (agent + dd-trace) |
|---|---|---|
| Error rate | 0% | **55.45%** (7,078 / 12,763 failed) |
| p95 latency | ~4.0 s | **16.41 s** |
| Completed RPS | ~54 | ~44 |
| Dropped iterations | low | 2,537 |

Under the ramp, OFF degrades gracefully (slow but still 200s); ON **collapses into majority errors** — the CPU-starved app can no longer complete requests.

### Conclusion: this is CPU starvation, not dd-trace overhead
On a **0.25 vCPU** task the Node app already consumed most of the quarter-core at 60 rps (healthy at 195 ms p95). Adding the **datadog-agent sidecar** — which shares the same task CPU — starved the event loop, collapsing throughput below 60 rps and pushing latency into the 10–15 s range. The effective capacity ceiling dropped from ~100 rps to **< 60 rps**.

dd-trace's *inherent* per-request cost on a 6-doc query is sub-millisecond; a ~75× p95 blow-up is the **agent competing for CPU on an undersized task**, exactly the "Datadog-on, same small box" failure mode.

### Recommendation / next step (fair comparison)
- **Right-size the task: 1 vCPU / 2 GB** (use the *same* size for OFF and ON) so the app keeps its CPU and the agent has headroom.
- Optionally pin the agent container: `cpu: 128`, `memoryReservation: 256` so it can never starve the app.
- Re-run 60 rps both ways — the gap should collapse to a small, honest delta (likely a few ms at p95). Then re-find R_max on the larger task.
- **Real lesson worth keeping:** adding observability to an under-provisioned container can tip it over — size for the agent, don't bolt it on for free.

## 8. CPU utilization analysis & right-sizing math

Task limit: **0.25 vCPU = 250 millicores (mC)**. Observed CPU% saturates at 100% under load → the % is **relative to the 0.25 vCPU allocation**, so `1% = 2.5 mC`.

### Measured CPU
| State | OFF (no agent) | ON (agent + APM) | Δ |
|---|---|---|---|
| Idle (avg) | **5.56%** ≈ 13.9 mC | **12.57%** ≈ 31.4 mC | **+7.0 pp ≈ +17.5 mC** |
| @ 60 rps | **~69%** ≈ 172.5 mC | **100%** (pegged/saturated) | hit the 250 mC ceiling |

(Idle averages: OFF = mean(5.32, 6.71, 5.29, 5.25, 5.24) = 5.56%; ON = mean(13.35, 12.55, 11.73, 12.17, 11.81, 13.78) = 12.57%.)

### What the agent + APM actually costs
**At idle:** the agent + tracer add **~17.5 mC** (7 percentage points of the quarter-core) just sitting there — ~2.3× the app's own idle (13.9 → 31.4 mC). Small in absolute cores, but **7% of this tiny task gone before serving a single request.**

**Per-request app cost (OFF):** going idle→60 rps adds `172.5 − 13.9 = 158.6 mC` for 60 req/s →
**≈ 2.64 mC of CPU per request** (≈ 2.6 ms of one core).

**Under load (ON):** at 60 rps the task pegs at 100% and collapses, so the true demand is *capped and unmeasurable* — but we can bound it. App work alone needs 172.5 mC; total demand clearly **≥ 250 mC**, so:
```
agent + APM load-time cost  ≥  250 − 172.5  =  77.5 mC at 60 rps   (≈ +45% on top of the app)
```
That's ~4× the agent's *idle* cost — trace processing scales with request volume. So per request, Datadog adds **≥ ~1.3 mC/req** (`77.5 / 60`), i.e. roughly **+45–50% CPU per request** (a lower bound, since saturation hid the rest).

> Why 60 rps was fine OFF but melted ON: OFF demand at 60 rps = 172.5 mC (69% of 250, 31% headroom). ON demand = 172.5 + ≥77.5 = **≥250 mC = the entire task** → queue builds, latency → 10–15 s, then errors. The agent didn't add "a little latency," it **ate the headroom the app needed.**

### Sizing to hit 100 rps at 30–50% CPU
Extrapolate demand linearly (`idle + rps × per-request`), including Datadog:
```
per-request:  app 2.64 mC  +  Datadog ≥1.3 mC  ≈ 3.95 mC/req
idle:         app 13.9 mC  +  agent 17.5 mC     = 31.4 mC
demand @100 rps (ON)  ≈  31.4 + 100 × 3.95  ≈  425 mC  ≈ 0.43 vCPU
```
Solve `allocation = demand / target-utilization`:

| Target CPU% @ 100 rps | Required vCPU (mC) | Nearest Fargate size |
|---|---|---|
| 50% | 425 / 0.50 ≈ 850 mC | **1 vCPU** (→ 41%) |
| 40% | 425 / 0.40 ≈ 1060 mC | **1 vCPU** (→ 41%) |
| 30% | 425 / 0.30 ≈ 1415 mC | **2 vCPU** (→ 21%) |

**Recommendation: size store-api to `1 vCPU / 2 GB`.**
- At 100 rps with agent + APM it lands at **~41% CPU** — squarely in your 30–50% target, with headroom for bursts.
- `0.5 vCPU` is **not enough**: 425 / 512 ≈ **83%** at 100 rps (no headroom — you'd be back near the cliff).
- Want to sit nearer 20–30% / absorb spikes → `2 vCPU / 4 GB`.
- These Datadog figures are **lower bounds** (the 60 rps ON run was capped), so treat 1 vCPU as the floor; it still leaves room to ~50% if real overhead is a bit higher.

### Important caveats
- **Two bottlenecks in the path.** Requests go ALB → **storefront (Next proxy, also 0.25 vCPU)** → store-api. Sizing only store-api will just move the ceiling to the storefront task. To truly hit 100 rps end-to-end, **size the storefront task similarly** (or load-test store-api directly).
- **Memory pairing:** Fargate requires ≥2 GB for 1 vCPU and ≥4 GB for 2 vCPU — so memory comes along for free; the agent's ~256 MB is no longer a squeeze.
- **Pin the agent** (`cpu: 128`, `memoryReservation: 256`) so even if it gets busy it can't starve the app again.
- Numbers are from laptop→Singapore; absolute latency includes ~40–70 ms RTT, but the **CPU math is server-side and unaffected** by that.

## Notes
- The products query is tiny (6 docs), so per-request work is small; on a *properly sized* task, expect dd-trace overhead in the **sub-ms to low-ms** range at p99. The big story above was *capacity/contention*, not tracer cost.
- Keep laptop, network, RATE, and **task size** identical between runs or the delta isn't meaningful (the 0.25 vCPU size is what made the agent so destructive here).
- `constant-arrival-rate` offers the same load to both variants regardless of response speed — that's why the latency comparison is fair.
