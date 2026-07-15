# ADR-0013: Attestation Signature Scheme (Ed25519)

**Status:** Accepted  
**Date:** 2026-07-13  
**Deciders:** Phase 2b Session 09b Protocol Implementer  
**Research:** [0008-collection-predicates-and-attestations.md](./0008-collection-predicates-and-attestations.md), [../PROTOCOL_SPEC_v1.md](../PROTOCOL_SPEC_v1.md), [../Open Questions.md](../Open%20Questions.md)

---

## Context

ADR-0008 requires signed attestations and explicit separation of:

- `verified: true` for trustless Rodarmor math predicates, and
- `attested: true` for off-chain issuer statements.

However, the v1 spec left the attestation signature algorithm unspecified (OPEN-5 in
`PROTOCOL_SPEC_v1.md`). Phase 2b requires implementation of signature verification.

Without a fixed signature scheme and canonical payload encoding, implementations can accept
incompatible signatures for the same claim.

## Decision

**v1 attestations use Ed25519 signatures over a canonical UTF-8 JSON payload.**

Canonical payload format:

```json
{
  "subject_sat": "<decimal string>",
  "claim": "<string>",
  "expires_at": "<ISO8601 string or null>"
}
```

Rules:

1. `subject_sat` is serialized as a decimal string (not a JSON number).
2. Field order is fixed exactly as shown above.
3. Signature input bytes are the UTF-8 bytes of the canonical JSON string.
4. `issuer_pubkey` is base64-encoded SPKI DER Ed25519 public key bytes.
5. `signature` is base64-encoded Ed25519 signature bytes.

The protocol verifies signature integrity only. It does not adjudicate claim truth (ADR-0008).

## Rationale

- Ed25519 verification is available in the Node 24 runtime with no external crypto dependency.
- Fixed canonical serialization prevents cross-implementation ambiguity.
- The chosen encoding is compact and unambiguous for HTTP JSON transport.
- This resolves OPEN-5 for the Phase 2 reference implementation.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| secp256k1 ECDSA/Schnorr | Viable long-term, but requires extra implementation choices for key encoding and signature format in this TypeScript runtime |
| BIP-322 message signatures | Better Bitcoin-wallet alignment, but larger scope than needed for Phase 2b signature-only verification |
| "Any algorithm accepted" | Non-interoperable and unverifiable across implementations |

## Consequences

### Positive
- Interoperable attestation verification behavior across implementations.
- Deterministic test vectors for valid and invalid signatures.

### Negative
- Existing attestations signed with non-Ed25519 schemes are not valid under this v1 rule.

## Compliance

- `POST /v1/attestations` MUST reject signatures that fail Ed25519 verification.
- `GET /v1/attestations/{sat_number}` returns stored attestations that already passed signature
  verification at ingest.
- Verification remains signature-only; claim truth is out of scope.

## References

- [ADR-0008](./0008-collection-predicates-and-attestations.md)
- [PROTOCOL_SPEC_v1.md §7](../PROTOCOL_SPEC_v1.md)
- [Open Questions.md Q19–Q20](../Open%20Questions.md)
