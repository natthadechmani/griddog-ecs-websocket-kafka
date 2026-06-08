# 3-Broker Kafka (KRaft) on One Host

A 3-broker Kafka cluster in **KRaft mode** (no ZooKeeper) on a single host, for
the gridDog demo. Simulates HA — RF=3, 3-voter controller quorum, **survives 1
broker loss** — but it is **NOT true HA**: one host/EC2 instance is still a
single point of failure.

## Run

**On the EC2 host:**
```bash
export EC2_PRIVATE_IP=$(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)
docker compose up -d
```

**Local test (this machine):**
```bash
EC2_PRIVATE_IP=127.0.0.1 docker compose up -d
```

## Ports & listeners

| Broker | node id | host port (EXTERNAL) | INTERNAL (compose net) | CONTROLLER |
|---|---|---|---|---|
| kafka1 | 1 | `9092` | `kafka1:19092` | `kafka1:9093` |
| kafka2 | 2 | `9093` | `kafka2:19092` | `kafka2:9093` |
| kafka3 | 3 | `9094` | `kafka3:19092` | `kafka3:9093` |

Three listeners per broker:
- **CONTROLLER** — KRaft quorum traffic (the 3 voters elect a metadata leader).
- **INTERNAL** — broker-to-broker replication, addressed by compose service name
  (`kafkaN:19092`). Only reachable *inside* the compose network.
- **EXTERNAL** — for remote clients; advertised as **`${EC2_PRIVATE_IP}:909x`**.

## ⚠️ The listener gotcha (read this)

A client always connects to one bootstrap address, then Kafka hands it back the
**advertised** address of every broker and the client reconnects to those. So
*who* can reach the advertised address matters:

- **EXTERNAL is advertised as `${EC2_PRIVATE_IP}:9092/9093/9094`.** That only
  works from somewhere that can route to those host ports — i.e. the **EC2 host
  itself or a remote client** (your Fargate task). 
- **From *inside* a broker container, `127.0.0.1:9093` is NOT broker 2** — it's
  that container's own loopback. So a client run inside `kafka1` that gets the
  EXTERNAL addresses can't reach the leaders on brokers 2 & 3 → it hangs with
  `Connection to node 2/3 could not be established`.
- **Fix for in-container/CLI tests:** bootstrap to the **INTERNAL** listener so
  metadata returns reachable `kafkaN:19092` addresses:
  ```bash
  docker exec kafka1 /opt/kafka/bin/kafka-console-producer.sh \
    --bootstrap-server kafka1:19092 --topic <t>
  ```
- **If you set `EC2_PRIVATE_IP=localhost`/`127.0.0.1`, cross-host clients break** —
  they'd be told to connect to *their own* localhost. On EC2 it must be the
  instance's **private IP**.

## How your Fargate app connects

Bootstrap servers = the EC2 **private IP** on all three external ports:
```
<EC2_PRIVATE_IP>:9092,<EC2_PRIVATE_IP>:9093,<EC2_PRIVATE_IP>:9094
```
Security group on the EC2 host: allow inbound **TCP 9092–9094 from the Fargate
tasks' security group** (not the internet). Same VPC (or routable).

## Verified locally (this setup)

- **KRaft quorum:** 3 voters `[1,2,3]`, leader elected, follower lag 0.
- **Topic `griddog-test`** created `RF=3, partitions=3` → `Isr: 1,2,3` on every
  partition.
- **Produce/consume** (via INTERNAL listener) round-trips 3 messages.
- **Broker-loss test:** stopped `kafka2` → partition leaders re-elected, ISR
  shrank to 2 (e.g. `Isr: 1,3`), `min.insync.replicas=2` still satisfied →
  **produce/consume kept working**. Restarted `kafka2` → **ISR healed to
  `[1,2,3]`** automatically.

### Repro the failover test
```bash
docker stop kafka2
docker exec kafka1 /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka1:19092 --describe --topic griddog-test
# produce/consume still works with 2/3 brokers...
docker start kafka2     # ISR heals back to 1,2,3
```

## Durability knobs (already set)
`RF=3`, `min.insync.replicas=2`, `acks=all` (use on the producer) means a write
is acked only when ≥2 replicas have it → no data loss on a single broker failure.
The offsets and transaction-state topics are also RF=3.

## Caveats
- **Single host = SPOF.** Losing the EC2 instance loses all 3 brokers. For real
  HA, run brokers on 3 separate hosts/AZs.
- **Shared disk/CPU/RAM.** All 3 brokers contend for one instance's resources —
  size the instance accordingly (Kafka likes RAM + fast disk).
- Data persists in named volumes `kafka{1,2,3}-data`; `docker compose down -v`
  wipes them (and resets the cluster).

## Teardown
```bash
docker compose down        # keep data
docker compose down -v     # also delete the volumes (fresh cluster next time)
```
