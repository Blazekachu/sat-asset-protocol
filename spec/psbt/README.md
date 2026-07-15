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

### Sat-for-sat (v2, ADR-0014) — unit/synthetic pending testnet4 spike

These two vectors cover the mirrored 2-bump sat-for-sat swap (ADR-0014). Unlike
the ADR-0005/0006/0007 vectors above, they are **synthetic unit fixtures**
(`"network": "synthetic-unit"`), produced by `buildSatForSatOfferPsbt` with
hand-injected `SIGHASH_ALL` partial signatures. They are **not** broadcast:
live testnet4 validation is the deferred spike (`SAT_FOR_SAT_SPIKE.md` §7 GO
gate, esp. E3 foreign-input wallet signing), which requires a persistent
`ord`+`bitcoind` host and cannot run in an ephemeral VM. It is tracked as an
ADR-0014 follow-up, not a merge gate.

- `vectors/sat-for-sat-offer.json`
  - Mirrored 2-bump **offer** PSBT. Party A offers sat X for party B's sat Y.
  - Input order: `[0] A_bump, [1] A_asset (X@0), [2] B_bump, [3] B_asset (Y@0), [4] fee_funding`.
  - Output order (FIFO): `[0] A_change, [1] B_ordinals (X→B@0), [2] B_change, [3] A_ordinals (Y→A@0), [4] fee_payer_change`.
  - Offerer A has signed inputs `[0,1,4]` (`SIGHASH_ALL`); accepter B's inputs
    `[2,3]` are unsigned. Output values are computed to preserve the FIFO
    offset-0 invariant.

- `vectors/sat-for-sat-accept.json`
  - Fully-signed **accept** PSBT whose unsigned transaction is **byte-identical**
    to the offer (the atomicity/tamper gate) with all 5 inputs signed
    (`SIGHASH_ALL`). Real P2TR wallets sign these inputs with a
    `PSBT_IN_TAP_KEY_SIG` (`0x13`); both `SIGHASH_DEFAULT` (`0x00`) and
    `SIGHASH_ALL` (`0x01`) are treated as SIGHASH_ALL-equivalent.

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
