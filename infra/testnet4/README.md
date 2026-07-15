# Testnet4 stack (Docker Compose)

A portable **bitcoind + ord --index-sats** testnet4 stack for live protocol verification. It runs anywhere Docker is available (Linux host, VM, or cloud box).

| Service | Purpose | Host port |
|---------|---------|-----------|
| `bitcoind` | Bitcoin Core, testnet4, `txindex` | 48332 (RPC) |
| `ord` | `ord --index-sats` (built @ ord `1ad3f64` / 0.27.1) | 8080 (HTTP) |
| Data | Docker volumes | `bitcoind-data`, `ord-data` |

An explorer (`btc-rpc-explorer`) is intentionally omitted — protocol gates only need **bitcoind + ord --index-sats**.

## Disk / RAM budget

Budget **≥ 80 GB disk** and **≥ 8 GB RAM** (~14 GB bitcoind + ~9 GB ord with all index flags, plus headroom).

First sync (IBD + ord sat index) takes **hours**, so run this on a **persistent host** — an ephemeral / idle-auto-stopping VM will not finish the sync.

## Quick start

```bash
cd infra/testnet4
cp .env.example .env
# edit BITCOIN_RPC_PASSWORD
# keep bitcoin.conf rpcpassword in sync OR override via bitcoind -rpcpassword (compose uses conf file)
docker compose up -d --build
curl -sS http://127.0.0.1:8080/status
```

Point the reference implementation at it:

```bash
export SAT_ASSET_ORD_BASE_URL=http://127.0.0.1:8080
npm test   # re-runs the suite against the live node
```

## Security

- Never commit `.env`.
- Bind RPC to private network only in production-like clouds (firewall 48332/8080 to your IP).
- Testnet4 only — no mainnet keys on this stack.
