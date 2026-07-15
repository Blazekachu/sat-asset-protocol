# Vorflux playbook — sat-asset-protocol

How to connect this repo to [Vorflux](https://vorflux.com/) and run a **testnet4 bitcoind + ord** stack so agents can pass live gates (not only mocked unit tests).

## 0. Prerequisites

1. This repo on GitHub (done after first push).
2. Vorflux account with **GitHub** connected.
3. Prefer also connecting **DigitalOcean** or **AWS** (Vorflux lists both under integrations) for a **persistent** node.

## 1. What Vorflux’s own machine can and cannot do

| Fact (from Vorflux pricing / product) | Implication for `/btcfullord` |
|--------------------------------------|-------------------------------|
| Dedicated VM clones your repo and can run a full stack during a session | Agents *can* `docker compose up` during an active job |
| Compute **auto-stops after 1 hour idle** | IBD + ord `--index-sats` (hours) will die if the session goes idle |
| Sizes Small→Hyper (~2–32 vCPU, 8–128 GiB) | Large (8 vCPU / 32 GiB) is enough **if** disk ≥ ~80 GB is available |
| Browser QA / video proof | Useful for UIs; **not** a substitute for `curl /status` + PSBT tests |
| Integrations: GitHub + AWS / DO / K8s | Best place for a **24/7** testnet4 node is a cloud box Vorflux configures — not the ephemeral agent VM |

**Short answer:** yes, you can run the stack in Vorflux’s world — but **not only on the idle-stopping coding VM**. Use Vorflux to **provision and maintain a persistent DO/AWS droplet**, then point every coding session at that `ORD_BASE_URL`.

## 2. Easiest Vorflux-only path (recommended)

### A. One persistent testnet4 box (do this first)

Open a Vorflux session on this repo with a task like:

```text
Read VORFLUX.md and infra/testnet4/README.md.

Goal: provision a persistent DigitalOcean (preferred) or AWS VM:
- Ubuntu 24.04
- 8 GB RAM minimum (16 GB better)
- 100 GB SSD
- Docker + Docker Compose installed
- Deploy infra/testnet4 (build ord Dockerfile, start bitcoind + ord)
- Open firewall only to my IP / Vorflux runners for ports 8080 (ord) and optionally 48332
- Wait until curl ORD_BASE_URL/status returns sat_index true (or document sync %)
- Store ORD_BASE_URL and RPC secrets in Vorflux / repo GitHub Actions secrets — never commit .env

Do not use the ephemeral agent workspace as the only place for IBD.
```

That droplet **is** your cloud `/btcfullord`.

### B. Coding sessions use the remote ord

For implementer / Bitcoin-engineer issues:

```text
ORD_BASE_URL=https://<your-droplet-or-tailscale>:8080
Run protocol tests that hit live ord. Prefer mocked unit tests in CI; live tests against the droplet.
```

### C. Optional: short-lived stack on the agent VM

Only for quick smoke tests if the droplet is down:

```text
cd infra/testnet4 && docker compose up -d --build
```

Expect to **lose sync progress** when the VM auto-stops after idle. Fine for “does compose start?”, not for “are we at tip?”.

## 3. Map local `/btcfullord` → Vorflux

| Local skill / path | Vorflux equivalent |
|--------------------|--------------------|
| `/btcfullord` PowerShell windows on `F:\` | `infra/testnet4/docker-compose.yml` on a DO/AWS box |
| `verify.ps1` | `curl -sS $ORD_BASE_URL/status` + `bitcoin-cli getblockchaininfo` in the droplet |
| Sessions 05 / 07–10 live gates | Vorflux issues that require live `ORD_BASE_URL` |
| Sessions 01–04 docs | Vorflux PRs with no Bitcoin stack |

## 4. Suggested first GitHub issues for Vorflux

1. **infra:** Deploy `infra/testnet4` to DO/AWS; document `ORD_BASE_URL`.
2. **ci:** GitHub Actions — `npm test` / node test runner with mocked ord.
3. **sync:** Align ROADMAP checkboxes with actual `src/` + failing live tests.
4. **gate:** Session 05 PSBT vectors against live testnet4.
5. **review:** Security pass on `src/psbt.ts` (human still merges).

## 5. What still is not “Vorflux only”

- Wallet sighash truth (Xverse / UniSat / Leather extensions) — human + browser wallet.
- Marketplace partner adoption — human BD.
- Mainnet `--index-sats` (TB-scale) — out of scope for this harness; stay on testnet4.

## 6. Cost sketch

- Vorflux agent VM (Large ~$0.85/hr) while actively coding — fine.
- Leaving Large on for multi-hour IBD — works only if the session stays **non-idle**; still worse than a cheap always-on droplet.
- DigitalOcean ~8 GB / 100 GB droplet — typically cheaper for 24/7 bitcoind+ord than burning Vorflux compute hours.
