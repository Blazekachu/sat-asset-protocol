# PSBT Test Vectors

Validated on testnet4 on 2026-07-12.

Scope:
- ADR-0005 `sat-for-BTC only`
- ADR-0006 canonical 2-bump fill
- ADR-0007 offset-0 listing precondition

## Environment

- `bitcoind` RPC: `127.0.0.1:48332`
- `ord` HTTP: `http://127.0.0.1:8080`
- `ord` version: `0.27.1`
- `sat index`: enabled

## Vectors

- `vectors/listing-seller.json`
  - Off-chain seller listing PSBT.
  - Signed live against testnet4 seller UTXO with `SIGHASH_SINGLE|ANYONECANPAY`.
  - Unsigned txid: `9cd26c5ced2fb897f266af0d3bdc275315d9644fd7db3791a6f23ff25f7746d2`

- `vectors/fill-buyer-2bump.json`
  - Canonical 2-bump buyer fill PSBT.
  - Parent funding tx broadcast: `209e0ab7966fec80992ba1a66bfc3543628027c6dd90a9c73593c4b9f33b5436`
  - Fill tx broadcast: `20a9e92e0ca04a895b88ddff6f909115c1f6966dbff11eb5d5a51297290331ef`
  - Node proof: both txids present in local testnet4 mempool on 2026-07-12.

- `vectors/invalid-offset-nonzero.json`
  - ADR-0007 rejection case.
  - Uses confirmed output `eb6b02195e1705cbf339f0d52a2641474044a8e7ff8e0dfb4b18f2795c07014a:1`.
  - `ord` reports first sat in the first range as `102955507979764`.
  - Targeting `102955507979765` yields offset `1`, so listing must be rejected.

## Validation Notes

- The seller listing vector is off-chain by design and was validated by signing a live PSBT against a real testnet4 UTXO.
- The fill vector was executed by broadcasting both the parent funding tx and the final fill tx to testnet4.
- Re-check on 2026-07-12 after ord recovery:
  - `/status` returned `unrecoverably_reorged: false`
  - `ord /output/20a9e92e0ca04a895b88ddff6f909115c1f6966dbff11eb5d5a51297290331ef:1` returned `indexed: true` with `confirmations: 1`
  - `ord /output/20a9e92e0ca04a895b88ddff6f909115c1f6966dbff11eb5d5a51297290331ef:0` returned `indexed: true` with `confirmations: 1`
- ADR-0007 proof used confirmed ord output `eb6b02195e1705cbf339f0d52a2641474044a8e7ff8e0dfb4b18f2795c07014a:1`.

## Phase 2 Gate

- Result: `PASS`
- Ready for Session 07: yes
- Blockers to clear before heavier implementation work:
  - None from Session 05.
