import { createPublicKey, verify } from "node:crypto";

import type { AttestationRecord } from "./listing-types.ts";

interface CanonicalAttestationPayload {
  subject_sat: string;
  claim: string;
  expires_at: string | null;
}

export function canonicalAttestationPayload(input: {
  subject_sat: number;
  claim: string;
  expires_at: string | null;
}): string {
  const payload: CanonicalAttestationPayload = {
    subject_sat: input.subject_sat.toString(),
    claim: input.claim,
    expires_at: input.expires_at,
  };

  return JSON.stringify(payload);
}

export function verifyAttestationSignature(input: {
  subject_sat: number;
  claim: string;
  expires_at: string | null;
  issuer_pubkey: string;
  signature: string;
}): boolean {
  try {
    const message = Buffer.from(
      canonicalAttestationPayload({
        subject_sat: input.subject_sat,
        claim: input.claim,
        expires_at: input.expires_at,
      }),
      "utf8",
    );
    const signature = Buffer.from(input.signature, "base64");
    const publicKeyDer = Buffer.from(input.issuer_pubkey, "base64");
    const publicKey = createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });

    return verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}

export function createAttestationRecord(input: {
  attestation_id: string;
  subject_sat: number;
  claim: string;
  issuer_pubkey: string;
  signature: string;
  expires_at: string | null;
  created_at: string;
}): AttestationRecord {
  return {
    attestation_id: input.attestation_id,
    subject_sat: input.subject_sat,
    claim: input.claim,
    issuer_pubkey: input.issuer_pubkey,
    signature: input.signature,
    expires_at: input.expires_at,
    created_at: input.created_at,
  };
}
