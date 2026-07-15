# Testnet4 stack (Vorflux / Linux) — portable `/btcfullord`

This folder is the **cloud-portable** equivalent of the local Windows launcher
`F:\Users\akhil\Main\testnet4` (`/btcfullord`).

| Local (Windows) | This folder (Linux / Vorflux) |
|-----------------|-------------------------------|
| `start-bitcoind.ps1` | `docker compose` service `bitcoind` |
| `start-ord.ps1` | `docker compose` service `ord` (built @ ord `1ad3f64` / 0.27.1) |
| Ports 48332 / 8080 | Same host ports |
| Data on `F:\` | Docker volumes `bitcoind-data`, `ord-data` |

Explorer (`btc-rpc-explorer`) is optional and omitted here — protocol gates only need **bitcoind + ord --index-sats**.

## Disk / RAM budget

Measured on the local workstation (2026-07): ~14 GB bitcoind + ~9 GB ord with all index flags.
Plan for **≥ 80 GB disk** and **≥ 8 GB RAM** (Vorflux Large or a DO/AWS box with 8 GiB+).

First sync (IBD + ord index) takes **hours**. Do **not** rely on an idle-auto-stop agent VM for that — see [VORFLUX.md](../../VORFLUX.md).

## Quick start

```bash
cd infra/testnet4
cp .env.example .env
# edit BITCOIN_RPC_PASSWORD
# keep bitcoin.conf rpcpassword in sync OR override via bitcoind -rpcpassword (compose uses conf file)
docker compose up -d --build
curl -sS http://127.0.0.1:8080/status
```

Point the protocol at:

```bash
export ORD_BASE_URL=http://127.0.0.1:8080
```

## Security

- Never commit `.env`.
- Bind RPC to private network only in production-like clouds (firewall 48332/8080 to Vorflux / your IP).
- Testnet4 only — no mainnet keys on this stack.
