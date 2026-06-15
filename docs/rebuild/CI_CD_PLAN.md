# CI / CD Plan

> Status: **DRAFT v1.0** • Owner: Coding Engineer (DevOps) + QA agent
> The audit found CI exists but only packages artifacts. This plan turns CI into a real gate, and adds real CD.

---

## 1. The current state (audit summary)

- `.github/workflows/ci.yml` exists.
- It does lint, typecheck, test, and "build" — but the "build" is just `node ../build-landing.cjs` (broken) plus artifact packaging.
- No real deploy. The build artifacts are not pushed anywhere; they're just uploaded as workflow artifacts.
- No environment promotion, no staging, no canary.
- No `dependabot.yml` / `renovate.json`.
- No branch protection rules documented.

## 2. The target pipeline

```
PR opened          ┌──────────────────────────────────┐
                   │ 1. Lint                          │
                   │ 2. Typecheck                     │
                   │ 3. Unit + Integration tests      │
                   │ 4. Migrations test (fresh DB)    │
                   │ 5. Coverage gate                 │
                   │ 6. Security check (see §6)       │
                   │ 7. Build (landing + service)     │
                   │ 8. E2E tests (Playwright)        │
                   └──────────────────────────────────┘
                              │
                              ▼
PR merged to main  ┌──────────────────────────────────┐
                   │ 9. Build production image(s)     │
                   │ 10. Push to staging              │
                   │ 11. Smoke test on staging        │
                   │ 12. Notify owner (manual promote)│
                   └──────────────────────────────────┘
                              │
                       (owner clicks "promote")
                              │
                              ▼
                   ┌──────────────────────────────────┐
                   │ 13. Promote to production        │
                   │ 14. Smoke test on production     │
                   │ 15. Tag release                  │
                   └──────────────────────────────────┘
```

**Hard rule:** Nothing deploys to production without the owner clicking a button. Auto-deploys are off.

## 3. CI workflow (`.github/workflows/ci.yml`)

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm --prefix landing-page ci
      - run: npm --prefix service-agent ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm --prefix service-agent ci
      - run: npm --prefix service-agent run typecheck

  test-unit:
    runs-on: ubuntu-latest
    services:
      sqlite: { image: alpine, options: --privileged }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm --prefix service-agent ci
      - run: npm --prefix service-agent run test:unit
      - run: npm --prefix service-agent run test:coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: service-agent/coverage/

  test-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm --prefix service-agent ci
      - run: npm --prefix service-agent run test:integration

  test-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm --prefix service-agent ci
      - run: npm --prefix service-agent run test:migrations

  test-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm --prefix landing-page ci
      - run: npm --prefix service-agent ci
      - run: npx playwright install --with-deps chromium webkit
      - run: npm run test:e2e

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm audit --audit-level=high
      - run: npm --prefix service-agent run audit --audit-level=high
      - run: npm --prefix landing-page run audit --audit-level=high
      - run: node scripts/security-check.js

  build:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test-unit, test-integration, test-migrations, test-e2e, security]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm --prefix landing-page ci && npm --prefix service-agent ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: |
            dist/
            landing-page/dist/
            service-agent/dist/
```

**Sequencing:** the `build` job depends on every other job. PRs get a green ✅ or red ❌; no "build passed but tests failed" nonsense.

## 4. CD workflow (`.github/workflows/deploy.yml`)

Two environments: `staging` (auto on main) and `production` (manual approval).

```yaml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment: { description: 'staging|production', required: true }

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist/, retention-days: 14 }

  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - name: Deploy to staging
        run: ./scripts/deploy.sh staging dist/
      - name: Smoke test
        run: ./scripts/smoke.sh https://staging.carshine.example

  deploy-production:
    needs: build
    if: github.event_name == 'workflow_dispatch' && inputs.environment == 'production'
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://carshine.example
    steps:
      - uses: actions/download-artifact@v4
        with: { name: dist, path: dist/ }
      - name: Deploy to production
        run: ./scripts/deploy.sh production dist/
      - name: Smoke test
        run: ./scripts/smoke.sh https://carshine.example
      - name: Tag release
        run: |
          git tag "v$(date +%Y%m%d-%H%M%S)"
          git push origin --tags
```

**Owner-only environment protection:** GitHub Settings → Environments → `production` → Required reviewers: owner.

## 5. Deploy target — small enough to start simple

For M0, the deploy target is a single VPS (or a small container host) running:
- Node 20 process under `systemd` (or `pm2`)
- Caddy or Nginx reverse proxy + Let's Encrypt
- SQLite file on disk (backed up nightly to S3-compatible storage)

We do **not** start with Kubernetes, Docker Swarm, or a multi-AZ setup. The audit's "no real production deployment" is solved by this lean stack. We can move to containers in M1.

**Backup:**
- Nightly: `cp database.sqlite backup-$(date +%Y%m%d).sqlite` + upload to S3-compatible.
- Retention: 30 daily, 12 monthly.
- Restore tested monthly with a runbook.

## 6. Security checks (in CI, see `SECURITY_PLAN.md` §6)

`scripts/security-check.js` runs in the `security` job. Output: pass/fail, with a clear message for each check.

## 7. Branch protection

GitHub Settings → Branches → Branch protection rules for `main`:
- Require a pull request before merging
- Require approvals: 1 (Codex or MiniMax)
- Dismiss stale pull request approvals when new commits are pushed
- Require status checks to pass before merging: `lint`, `typecheck`, `test-unit`, `test-integration`, `test-migrations`, `test-e2e`, `security`, `build`
- Require linear history
- Do not allow force pushes
- Do not allow deletions

## 8. Dependabot / Renovate

`renovate.json` (preferred — more configurable):
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:base"],
  "schedule": ["before 9am on monday"],
  "packageRules": [
    { "matchUpdateTypes": ["patch", "minor"], "automerge": true },
    { "matchUpdateTypes": ["major"], "labels": ["breaking"] }
  ]
}
```

Security PRs are immediate, not weekly.

## 9. Observability (lightweight for M0)

- `service-agent/logger.js` writes structured JSON to `service-agent.log`.
- The `/health` endpoint returns `{ status, db, uptime, providers, lastError }`.
- A daily cron posts a heartbeat to a healthcheck URL (e.g. healthchecks.io) so we know the process is alive even when no traffic hits it.
- Langfuse traces cover the AI orchestrator. (Already present, see `AGENT_TOOLS_PLAN.md` §7.)
- No full APM in M0 (Datadog / New Relic). Add in M1 if/when the volume justifies it.

## 10. Local dev — bring it all together

`README.md` is updated to reflect the rebuild:

```bash
git clone <repo>
cd carshine-redsea
cp service-agent/.env.example service-agent/.env   # fill in
npm ci
npm --prefix landing-page ci
npm --prefix service-agent ci
npm run db:migrate
npm run db:seed                              # dev only
npm run dev                                  # boots landing + service
npm test                                     # service-agent tests
npm run test:e2e                             # Playwright (requires dev servers running)
```

`npm run dev` is a `concurrently` that boots:
- `landing-page` (Vite dev server, port 5173)
- `service-agent` (Express, port 5000)

## 11. Acceptance for the CI/CD plan

- Every PR runs the full 8-job matrix and reports status per job.
- A green PR can be merged; a red PR cannot.
- Merging to `main` deploys to staging automatically.
- Promoting to production requires owner click; the workflow fails closed if the env protection is misconfigured.
- A nightly backup of `database.sqlite` lands in the backup bucket; restore is documented.
- `npm audit --audit-level=high` is clean across all sub-packages.
- `git tag` shows a release tag after every production deploy.

## 12. Open questions

| # | Question | Owner | Due |
|---|---|---|---|
| Q1 | Host: Hetzner, DigitalOcean, or existing host? | Owner | Day 1 |
| Q2 | Container or bare-metal in M0? | Coding Engineer | Day 3 |
| Q3 | Slack/email notifications for failed CI? | Coding Engineer | Day 3 |
| Q4 | Do we need a `release` branch for hotfixes, or fast-forward from main? | Coding Engineer | Day 5 |
