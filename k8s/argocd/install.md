# ArgoCD GitOps Setup

## Install ArgoCD into the cluster

```bash
# 1. Create namespace and install ArgoCD
kubectl apply -f k8s/argocd/namespace.yaml
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# 2. Wait for ArgoCD to be ready
kubectl wait --for=condition=available --timeout=120s deployment/argocd-server -n argocd

# 3. Get the initial admin password
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d && echo

# 4. Port-forward to access the ArgoCD UI locally
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Open https://localhost:8080 — login with admin / <password from step 3>
```

## Bootstrap the App-of-Apps

```bash
# Login to ArgoCD CLI
argocd login localhost:8080 --insecure --username admin

# Apply the root app-of-apps — this registers all child apps
kubectl apply -f k8s/argocd/app-of-apps.yaml

# Trigger initial sync of the app-of-apps
argocd app sync aura-vault-app-of-apps

# The child apps (staging + production) are now registered.
# Staging will auto-sync; production waits for manual approval.
```

## Sync Behaviour

| Environment | Namespace          | Sync Mode                        |
|-------------|--------------------|----------------------------------|
| Staging     | `aura-vault-staging` | Automatic on every `main` push |
| Production  | `aura-vault`        | Manual via ArgoCD UI/CLI        |

### Manually sync production

```bash
# Via CLI
argocd app sync aura-vault-production

# Or in the ArgoCD UI:
# Apps → aura-vault-production → Sync → Synchronize
```

## Rollback via ArgoCD History

```bash
# List available revisions
argocd app history aura-vault-production

# Rollback to a specific revision (ID shown by 'history' command)
argocd app rollback aura-vault-production <revision-id>

# Monitor rollback status
argocd app wait aura-vault-production --sync
```

## Grafana Sync-Status Dashboard

ArgoCD notification annotations on each Application manifest
(`notifications.argoproj.io/subscribe.*`) feed sync events to Grafana.
The existing `monitoring/grafana/dashboards/system-health.json` dashboard
can be extended with an ArgoCD datasource panel to visualise sync status.
