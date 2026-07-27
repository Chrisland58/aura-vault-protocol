# Kubernetes Configuration — Aura Vault Protocol

This directory contains Kubernetes manifests for deploying and operating the Aura Vault Protocol in a production cluster.

## Directory Layout

```
k8s/
└── disruption/
    ├── backend-pdb.yaml      # PodDisruptionBudget for the backend API
    ├── frontend-pdb.yaml     # PodDisruptionBudget for the Next.js frontend
    ├── postgresql-pdb.yaml   # PodDisruptionBudget for the PostgreSQL primary
    └── redis-pdb.yaml        # PodDisruptionBudget for Redis cache
```

---

## Pod Disruption Budgets (PDBs)

A **PodDisruptionBudget** tells the Kubernetes eviction API the minimum number of pods that must remain available during a *voluntary disruption* — such as a node drain (`kubectl drain`), cluster upgrade, or autoscaler scale-down. Kubernetes will refuse to evict a pod if doing so would violate the budget, ensuring the workload stays available throughout the operation.

> PDBs only apply to **voluntary** disruptions. Involuntary disruptions (hardware failure, OOM kill) are not covered.

All PDBs in this project are in the `aura-vault` namespace.

### Workload Summary

| Workload   | PDB Manifest               | `minAvailable` | Selector Labels                        |
|------------|----------------------------|----------------|----------------------------------------|
| Backend    | `backend-pdb.yaml`         | 1              | `app: backend`                         |
| Frontend   | `frontend-pdb.yaml`        | 1              | `app: frontend`                        |
| PostgreSQL | `postgresql-pdb.yaml`      | 1              | `app: postgresql`, `role: primary`     |
| Redis      | `redis-pdb.yaml`           | 1              | `app: redis`                           |

### backend-pdb

Keeps at least **1 backend API pod** running at all times during disruptions. Deployments should target ≥ 2 replicas in production so a node drain can proceed without waiting indefinitely.

```yaml
# k8s/disruption/backend-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: backend-pdb
  namespace: aura-vault
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: backend
```

### frontend-pdb

Keeps at least **1 frontend pod** available. The Next.js frontend is stateless and can tolerate short rolling restarts, but this PDB ensures zero-downtime node maintenance.

```yaml
# k8s/disruption/frontend-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: frontend-pdb
  namespace: aura-vault
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: frontend
```

### postgresql-pdb

Protects the **primary PostgreSQL pod** from eviction. The selector targets `role: primary` specifically so that replica pods are unaffected and can be restarted freely.

```yaml
# k8s/disruption/postgresql-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: postgresql-pdb
  namespace: aura-vault
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: postgresql
      role: primary
```

> Your PostgreSQL pods must carry the `role: primary` label for this PDB to match. If you use a Helm chart (e.g. Bitnami), verify that label is applied to the primary StatefulSet pod.

### redis-pdb

Keeps at least **1 Redis pod** available. If you run Redis in sentinel/cluster mode with multiple replicas, consider increasing `minAvailable` accordingly.

```yaml
# k8s/disruption/redis-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: redis-pdb
  namespace: aura-vault
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: redis
```

---

## Applying PDBs

Create the `aura-vault` namespace if it does not already exist, then apply all PDB manifests:

```bash
# Create namespace
kubectl create namespace aura-vault

# Apply all PDBs at once
kubectl apply -f k8s/disruption/

# Or apply individually
kubectl apply -f k8s/disruption/backend-pdb.yaml
kubectl apply -f k8s/disruption/frontend-pdb.yaml
kubectl apply -f k8s/disruption/postgresql-pdb.yaml
kubectl apply -f k8s/disruption/redis-pdb.yaml
```

---

## Verifying PDBs

### List all PDBs in the namespace

```bash
kubectl get pdb -n aura-vault
```

Expected output:

```
NAME             MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS   AGE
backend-pdb      1               N/A               1                     5m
frontend-pdb     1               N/A               1                     5m
postgresql-pdb   1               N/A               0                     5m
redis-pdb        1               N/A               1                     5m
```

> `ALLOWED DISRUPTIONS` is `(replicas - minAvailable)`. PostgreSQL shows 0 if only 1 replica is running — meaning the node drain will block until the primary is rescheduled elsewhere.

### Describe a specific PDB

```bash
kubectl describe pdb backend-pdb -n aura-vault
```

### Verify node drain behaviour

To confirm PDBs are respected during a node drain:

```bash
# 1. Identify the node running a protected pod
kubectl get pods -n aura-vault -o wide

# 2. Attempt to drain the node (add --ignore-daemonsets if needed)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# Expected: drain blocks or evicts other pods while keeping PDB-protected
# pods running until replacements are scheduled on other nodes.
# You will see a message like:
#   "Cannot evict pod as it would violate the pod's disruption budget."
# Kubernetes retries eviction until the budget allows it.

# 3. Monitor pod rescheduling
kubectl get pods -n aura-vault -w

# 4. Uncordon the node after drain completes
kubectl uncordon <node-name>
```

---

## Production Recommendations

- **Replica count**: PDBs with `minAvailable: 1` only protect you if you run at least **2 replicas**. With a single replica, a drain will block indefinitely waiting for a replacement pod. Set `replicas: 2` (or more) for backend, frontend, and redis in production.
- **PostgreSQL HA**: For true HA, run PostgreSQL with a streaming replica (e.g. via Patroni or the Bitnami HA chart) so the primary PDB can be satisfied while the primary is migrated.
- **maxUnavailable alternative**: If you prefer percentage-based budgets, swap `minAvailable` for `maxUnavailable: 1` on stateless workloads (backend, frontend). This is equivalent for 2-replica deployments.
- **Monitoring**: Set up alerts on `kube_poddisruptionbudget_status_disruptions_allowed == 0` in Prometheus to detect when a workload is at capacity and any disruption would be blocked.
