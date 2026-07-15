import {
  assertOutputAboveDust,
  classifyScript,
  dustThresholdForScript,
  DustValidationError,
} from "./dust.ts";

export const PSBT_MAGIC = Buffer.from("70736274ff", "hex");

const DEFAULT_MIN_RELAY_FEE_SAT_PER_VB = 3;
const DEFAULT_BUMP_SIZE_SATS = 600;

/**
 * Optional dust policy for the v1 canonical fill PSBT paths. Defaults match the
 * protocol config defaults (min-relay fee 3 sat/vB, 600-sat bumps) so existing
 * callers/tests that omit it keep the ADR-0006 canonical behavior. psbt.ts does
 * NOT read process.env — callers thread these in from ProtocolConfig.
 */
export interface DustPolicy {
  minRelayFeeSatPerVb?: number;
  bumpSizeSats?: number;
}

/**
 * Raised when a PSBT fails a structural or canonical-invariant validation in
 * {@link validateCanonicalTwoBumpFillPsbt}. Exported so the server can map it to
 * HTTP 400 without importing listing-service concerns. Dust-specific failures
 * throw {@link DustValidationError} from ./dust.ts instead.
 */
export class PsbtValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PsbtValidationError";
  }
}

interface ReaderState {
  readonly buffer: Buffer;
  offset: number;
}

export interface ParsedPsbtInput {
  outpoint: string;
  sequence: number;
  sighashType: number | null;
  partialSigCount: number;
  witnessUtxoValue: number | null;
  witnessUtxoScriptPubkeyHex: string | null;
}

export interface ParsedPsbtOutput {
  value: number;
  scriptPubkeyHex: string;
}

export interface ParsedPsbt {
  inputs: ParsedPsbtInput[];
  outputs: ParsedPsbtOutput[];
}

export interface ParsedListingPsbt {
  inputOutpoint: string;
  input0HasPartialSig: boolean;
  input0SighashType: number | null;
  outputValues: number[];
  input0WitnessUtxoValue: number | null;
  input0WitnessUtxoScriptPubkeyHex: string | null;
}

export interface TemplateInput {
  outpoint: string;
  valueSats: number;
  scriptPubkeyHex: string;
}

export interface BuyerFillTemplateParams {
  sellerOutpoint: string;
  sellerInputValueSats: number;
  sellerInputScriptPubkeyHex: string;
  listingPriceSats: number;
  bumpInputs: TemplateInput[];
  fundingInputs: TemplateInput[];
  buyerBumpScriptPubkeyHex: string;
  buyerAssetScriptPubkeyHex: string;
  buyerChangeScriptPubkeyHex: string;
  buyerChangeValueSats: number;
}

function ensureRemaining(reader: ReaderState, length: number): void {
  if (reader.offset + length > reader.buffer.length) {
    throw new Error("Invalid PSBT: truncated payload");
  }
}

function readUInt8(reader: ReaderState): number {
  ensureRemaining(reader, 1);
  const value = reader.buffer.readUInt8(reader.offset);
  reader.offset += 1;
  return value;
}

function readUInt32LE(reader: ReaderState): number {
  ensureRemaining(reader, 4);
  const value = reader.buffer.readUInt32LE(reader.offset);
  reader.offset += 4;
  return value;
}

function readUInt64LE(reader: ReaderState): number {
  ensureRemaining(reader, 8);
  const value = Number(reader.buffer.readBigUInt64LE(reader.offset));
  reader.offset += 8;
  return value;
}

function readSlice(reader: ReaderState, length: number): Buffer {
  ensureRemaining(reader, length);
  const value = reader.buffer.subarray(reader.offset, reader.offset + length);
  reader.offset += length;
  return value;
}

function readVarInt(reader: ReaderState): number {
  const first = readUInt8(reader);
  if (first < 0xfd) {
    return first;
  }

  if (first === 0xfd) {
    ensureRemaining(reader, 2);
    const value = reader.buffer.readUInt16LE(reader.offset);
    reader.offset += 2;
    return value;
  }

  if (first === 0xfe) {
    return readUInt32LE(reader);
  }

  ensureRemaining(reader, 8);
  const value = Number(reader.buffer.readBigUInt64LE(reader.offset));
  reader.offset += 8;
  return value;
}

export function encodeVarInt(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Cannot encode negative or non-integer varint");
  }

  if (value < 0xfd) {
    return Buffer.from([value]);
  }

  if (value <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer.writeUInt8(0xfd, 0);
    buffer.writeUInt16LE(value, 1);
    return buffer;
  }

  if (value <= 0xffffffff) {
    const buffer = Buffer.alloc(5);
    buffer.writeUInt8(0xfe, 0);
    buffer.writeUInt32LE(value, 1);
    return buffer;
  }

  const buffer = Buffer.alloc(9);
  buffer.writeUInt8(0xff, 0);
  buffer.writeBigUInt64LE(BigInt(value), 1);
  return buffer;
}

function decodeOutpoint(buffer: Buffer): string {
  if (buffer.length !== 36) {
    throw new Error("Invalid outpoint payload");
  }

  const txid = Buffer.from(buffer.subarray(0, 32)).reverse().toString("hex");
  const vout = buffer.readUInt32LE(32);
  return `${txid}:${vout}`;
}

function encodeOutpoint(outpoint: string): Buffer {
  const [txidHex, voutText] = outpoint.split(":");
  if (!txidHex || !voutText) {
    throw new Error(`Invalid outpoint: ${outpoint}`);
  }

  if (!/^[0-9a-fA-F]{64}$/.test(txidHex)) {
    throw new Error(`Invalid txid in outpoint: ${outpoint}`);
  }

  const vout = Number.parseInt(voutText, 10);
  if (!Number.isInteger(vout) || vout < 0) {
    throw new Error(`Invalid vout in outpoint: ${outpoint}`);
  }

  const outpointBuffer = Buffer.alloc(36);
  Buffer.from(txidHex, "hex").reverse().copy(outpointBuffer, 0);
  outpointBuffer.writeUInt32LE(vout, 32);
  return outpointBuffer;
}

function parseUnsignedTransaction(transaction: Buffer): {
  inputs: Array<{ outpoint: string; sequence: number }>;
  outputs: ParsedPsbtOutput[];
} {
  const reader: ReaderState = { buffer: transaction, offset: 0 };

  readUInt32LE(reader);
  let hasWitness = false;
  if (reader.offset + 2 <= reader.buffer.length) {
    const marker = reader.buffer[reader.offset];
    const flag = reader.buffer[reader.offset + 1];
    if (marker === 0x00 && flag === 0x01) {
      hasWitness = true;
      reader.offset += 2;
    }
  }

  const inputCount = readVarInt(reader);
  const inputs: Array<{ outpoint: string; sequence: number }> = [];
  for (let index = 0; index < inputCount; index += 1) {
    const outpoint = decodeOutpoint(readSlice(reader, 36));
    const scriptLength = readVarInt(reader);
    readSlice(reader, scriptLength);
    const sequence = readUInt32LE(reader);
    inputs.push({ outpoint, sequence });
  }

  const outputCount = readVarInt(reader);
  const outputs: ParsedPsbtOutput[] = [];
  for (let index = 0; index < outputCount; index += 1) {
    const value = readUInt64LE(reader);
    const scriptLength = readVarInt(reader);
    const scriptPubkeyHex = readSlice(reader, scriptLength).toString("hex");
    outputs.push({ value, scriptPubkeyHex });
  }

  if (hasWitness) {
    for (let inputIndex = 0; inputIndex < inputCount; inputIndex += 1) {
      const stackItemCount = readVarInt(reader);
      for (let stackIndex = 0; stackIndex < stackItemCount; stackIndex += 1) {
        const stackItemLength = readVarInt(reader);
        readSlice(reader, stackItemLength);
      }
    }
  }

  readUInt32LE(reader);

  if (reader.offset !== reader.buffer.length) {
    throw new Error("Invalid unsigned transaction in PSBT");
  }

  return { inputs, outputs };
}

function parseWitnessUtxo(raw: Buffer): { value: number; scriptPubkeyHex: string } {
  const reader: ReaderState = { buffer: raw, offset: 0 };
  const value = readUInt64LE(reader);
  const scriptLength = readVarInt(reader);
  const scriptPubkeyHex = readSlice(reader, scriptLength).toString("hex");

  if (reader.offset !== raw.length) {
    throw new Error("Invalid witness_utxo payload");
  }

  return { value, scriptPubkeyHex };
}

function parseMap(reader: ReaderState): Array<{ key: Buffer; value: Buffer }> {
  const entries: Array<{ key: Buffer; value: Buffer }> = [];

  while (true) {
    const keyLength = readVarInt(reader);
    if (keyLength === 0) {
      break;
    }

    const key = readSlice(reader, keyLength);
    const valueLength = readVarInt(reader);
    const value = readSlice(reader, valueLength);
    entries.push({ key, value });
  }

  return entries;
}

function parsePsbtStructure(psbtBase64: string): {
  unsignedTx: Buffer;
  inputMaps: Array<Array<{ key: Buffer; value: Buffer }>>;
  outputMaps: Array<Array<{ key: Buffer; value: Buffer }>>;
} {
  const buffer = Buffer.from(psbtBase64, "base64");
  if (buffer.length < PSBT_MAGIC.length || !buffer.subarray(0, PSBT_MAGIC.length).equals(PSBT_MAGIC)) {
    throw new Error("PSBT must start with magic bytes");
  }

  const reader: ReaderState = { buffer, offset: PSBT_MAGIC.length };
  const globalEntries = parseMap(reader);
  const unsignedTxEntry = globalEntries.find((entry) => entry.key.length === 1 && entry.key[0] === 0x00);

  if (!unsignedTxEntry) {
    throw new Error("PSBT missing unsigned transaction");
  }

  const unsignedTransaction = parseUnsignedTransaction(unsignedTxEntry.value);
  const inputMaps: Array<Array<{ key: Buffer; value: Buffer }>> = [];
  for (let index = 0; index < unsignedTransaction.inputs.length; index += 1) {
    inputMaps.push(parseMap(reader));
  }

  const outputMaps: Array<Array<{ key: Buffer; value: Buffer }>> = [];
  for (let index = 0; index < unsignedTransaction.outputs.length; index += 1) {
    outputMaps.push(parseMap(reader));
  }

  return {
    unsignedTx: unsignedTxEntry.value,
    inputMaps,
    outputMaps,
  };
}

function parsePsbtUnsignedOnly(psbtBase64: string): {
  inputs: Array<{ outpoint: string; sequence: number }>;
  outputs: ParsedPsbtOutput[];
} {
  const buffer = Buffer.from(psbtBase64, "base64");
  if (buffer.length < PSBT_MAGIC.length || !buffer.subarray(0, PSBT_MAGIC.length).equals(PSBT_MAGIC)) {
    throw new Error("PSBT must start with magic bytes");
  }

  const reader: ReaderState = { buffer, offset: PSBT_MAGIC.length };
  const globalEntries = parseMap(reader);
  const unsignedTxEntry = globalEntries.find((entry) => entry.key.length === 1 && entry.key[0] === 0x00);
  if (!unsignedTxEntry) {
    throw new Error("PSBT missing unsigned transaction");
  }

  return parseUnsignedTransaction(unsignedTxEntry.value);
}

/**
 * Return the raw serialized unsigned transaction bytes from the PSBT global-map
 * `0x00` entry. Reuses the structure parser so the returned buffer is exactly
 * the version + inputs + outputs + locktime serialization stored in the PSBT.
 * Used for byte-identical comparison between an offer and its accept PSBT.
 */
export function unsignedTxBytes(psbtBase64: string): Buffer {
  const structure = parsePsbtStructure(psbtBase64);
  return Buffer.from(structure.unsignedTx);
}

/**
 * True when a sighash type is SIGHASH_ALL-equivalent for validation purposes.
 * Both SIGHASH_DEFAULT (`0x00`, Taproot 64-byte key-sig) and SIGHASH_ALL
 * (`0x01`) commit to all inputs and outputs, so consumers treat them as
 * equivalent. `null` (no sighash present) is not considered equivalent.
 */
export function isSighashAllEquivalent(sighashType: number | null): boolean {
  return sighashType === 0x00 || sighashType === 0x01;
}

export function parsePsbt(psbtBase64: string): ParsedPsbt {
  const structure = parsePsbtStructure(psbtBase64);
  const unsignedTransaction = parseUnsignedTransaction(structure.unsignedTx);

  const inputs: ParsedPsbtInput[] = unsignedTransaction.inputs.map((input, index) => {
    const inputEntries = structure.inputMaps[index] ?? [];

    let sighashType: number | null = null;
    let partialSigCount = 0;
    let witnessUtxoValue: number | null = null;
    let witnessUtxoScriptPubkeyHex: string | null = null;

    for (const entry of inputEntries) {
      const keyType = entry.key[0];
      if (keyType === 0x02) {
        partialSigCount += 1;
        if (entry.value.length > 0 && sighashType === null) {
          sighashType = entry.value[entry.value.length - 1] ?? null;
        }
      } else if (keyType === 0x03 && entry.value.length >= 4) {
        sighashType = entry.value.readUInt32LE(0);
      } else if (keyType === 0x13) {
        // PSBT_IN_TAP_KEY_SIG (BIP371): a Taproot key-path signature. A 65-byte
        // signature carries an explicit sighash byte as its last byte; a
        // 64-byte signature implies SIGHASH_DEFAULT (0x00). Sats overwhelmingly
        // live in P2TR, so a present tap-key-sig counts as a partial signature.
        partialSigCount += 1;
        if (sighashType === null) {
          sighashType = entry.value.length === 65 ? (entry.value[64] ?? 0x00) : 0x00;
        }
      } else if (keyType === 0x01) {
        const witnessUtxo = parseWitnessUtxo(entry.value);
        witnessUtxoValue = witnessUtxo.value;
        witnessUtxoScriptPubkeyHex = witnessUtxo.scriptPubkeyHex;
      }
    }

    return {
      outpoint: input.outpoint,
      sequence: input.sequence,
      sighashType,
      partialSigCount,
      witnessUtxoValue,
      witnessUtxoScriptPubkeyHex,
    };
  });

  return {
    inputs,
    outputs: unsignedTransaction.outputs,
  };
}

export function parseListingPsbt(psbtBase64: string): ParsedListingPsbt {
  const parsed = parsePsbt(psbtBase64);
  const firstInput = parsed.inputs[0];
  if (!firstInput) {
    throw new Error("Listing PSBT must include input 0");
  }

  return {
    inputOutpoint: firstInput.outpoint,
    input0HasPartialSig: firstInput.partialSigCount > 0,
    input0SighashType: firstInput.sighashType,
    outputValues: parsed.outputs.map((output) => output.value),
    input0WitnessUtxoValue: firstInput.witnessUtxoValue,
    input0WitnessUtxoScriptPubkeyHex: firstInput.witnessUtxoScriptPubkeyHex,
  };
}

export function encodeUInt32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

export function encodeUInt64LE(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function encodeScript(scriptPubkeyHex: string): Buffer {
  if (!/^[0-9a-fA-F]*$/.test(scriptPubkeyHex) || scriptPubkeyHex.length % 2 !== 0) {
    throw new Error(`Invalid script pubkey hex: ${scriptPubkeyHex}`);
  }

  const script = Buffer.from(scriptPubkeyHex, "hex");
  return Buffer.concat([encodeVarInt(script.length), script]);
}

export function buildUnsignedTransaction(
  inputOutpoints: string[],
  outputValuesAndScripts: Array<{ valueSats: number; scriptPubkeyHex: string }>,
): Buffer {
  const parts: Buffer[] = [encodeUInt32LE(2), encodeVarInt(inputOutpoints.length)];

  for (const outpoint of inputOutpoints) {
    parts.push(encodeOutpoint(outpoint));
    parts.push(Buffer.from([0x00]));
    parts.push(encodeUInt32LE(0xfffffffd));
  }

  parts.push(encodeVarInt(outputValuesAndScripts.length));
  for (const output of outputValuesAndScripts) {
    parts.push(encodeUInt64LE(output.valueSats));
    parts.push(encodeScript(output.scriptPubkeyHex));
  }

  parts.push(encodeUInt32LE(0));
  return Buffer.concat(parts);
}

export function encodeMapEntry(key: Buffer, value: Buffer): Buffer {
  return Buffer.concat([encodeVarInt(key.length), key, encodeVarInt(value.length), value]);
}

export function encodeWitnessUtxoMap(valueSats: number, scriptPubkeyHex: string): Buffer {
  const payload = Buffer.concat([encodeUInt64LE(valueSats), encodeScript(scriptPubkeyHex)]);
  return encodeMapEntry(Buffer.from([0x01]), payload);
}

export function buildBuyerFillTemplatePsbt(
  params: BuyerFillTemplateParams,
  dustPolicy: DustPolicy = {},
): {
  psbtBase64: string;
  inputOutpoints: string[];
  outputValues: number[];
} {
  const minRelayFeeSatPerVb =
    dustPolicy.minRelayFeeSatPerVb ?? DEFAULT_MIN_RELAY_FEE_SAT_PER_VB;

  if (params.bumpInputs.length !== 2) {
    throw new Error("Canonical template requires exactly 2 bump inputs");
  }

  if (params.fundingInputs.length < 1) {
    throw new Error("Canonical template requires at least 1 funding input");
  }

  const inputOutpoints = [
    params.bumpInputs[0].outpoint,
    params.bumpInputs[1].outpoint,
    params.sellerOutpoint,
    ...params.fundingInputs.map((input) => input.outpoint),
  ];

  const bumpPassthroughValue =
    params.bumpInputs[0].valueSats + params.bumpInputs[1].valueSats;
  const outputValues = [
    bumpPassthroughValue,
    params.sellerInputValueSats,
    params.listingPriceSats,
    params.buyerChangeValueSats,
  ];

  const outputs = [
    { valueSats: bumpPassthroughValue, scriptPubkeyHex: params.buyerBumpScriptPubkeyHex },
    { valueSats: params.sellerInputValueSats, scriptPubkeyHex: params.buyerAssetScriptPubkeyHex },
    { valueSats: params.listingPriceSats, scriptPubkeyHex: params.sellerInputScriptPubkeyHex },
    { valueSats: params.buyerChangeValueSats, scriptPubkeyHex: params.buyerChangeScriptPubkeyHex },
  ];

  for (const output of outputs) {
    assertOutputAboveDust(output.scriptPubkeyHex, output.valueSats, minRelayFeeSatPerVb);
  }

  const unsignedTransaction = buildUnsignedTransaction(inputOutpoints, outputs);

  const inputMaps: Buffer[] = [
    encodeWitnessUtxoMap(params.bumpInputs[0].valueSats, params.bumpInputs[0].scriptPubkeyHex),
    encodeWitnessUtxoMap(params.bumpInputs[1].valueSats, params.bumpInputs[1].scriptPubkeyHex),
    encodeWitnessUtxoMap(params.sellerInputValueSats, params.sellerInputScriptPubkeyHex),
    ...params.fundingInputs.map((input) => encodeWitnessUtxoMap(input.valueSats, input.scriptPubkeyHex)),
  ].map((mapEntry) => Buffer.concat([mapEntry, Buffer.from([0x00])]));

  const outputMaps: Buffer[] = outputs.map(() => Buffer.from([0x00]));
  const globalMap = Buffer.concat([
    encodeMapEntry(Buffer.from([0x00]), unsignedTransaction),
    Buffer.from([0x00]),
  ]);

  const psbt = Buffer.concat([PSBT_MAGIC, globalMap, ...inputMaps, ...outputMaps]);

  return {
    psbtBase64: psbt.toString("base64"),
    inputOutpoints,
    outputValues,
  };
}

export function validateCanonicalTwoBumpFillPsbt(
  fillPsbtBase64: string,
  listingOutpoint: string,
  listingPriceSats: number,
  dustPolicy: DustPolicy = {},
): { sellerInputIndex: number; buyerInputCount: number } {
  const minRelayFeeSatPerVb =
    dustPolicy.minRelayFeeSatPerVb ?? DEFAULT_MIN_RELAY_FEE_SAT_PER_VB;
  const bumpSizeSats = dustPolicy.bumpSizeSats ?? DEFAULT_BUMP_SIZE_SATS;

  const parsed = parsePsbtUnsignedOnly(fillPsbtBase64);

  if (parsed.inputs.length < 4) {
    throw new PsbtValidationError("Canonical 2-bump fill must include 4+ inputs");
  }

  const sellerInputIndex = parsed.inputs.findIndex((input) => input.outpoint === listingOutpoint);
  if (sellerInputIndex !== 2) {
    throw new PsbtValidationError("Canonical 2-bump fill must place seller input at index 2");
  }

  if (parsed.outputs.length < 4) {
    throw new PsbtValidationError("Canonical 2-bump fill must include 4+ outputs");
  }

  if (parsed.outputs[0]?.value !== 2 * bumpSizeSats) {
    throw new PsbtValidationError("Output 0 must be canonical 1200-sat bump passthrough");
  }

  if (parsed.outputs[2]?.value !== listingPriceSats) {
    throw new PsbtValidationError("Output 2 must pay listing price to seller");
  }

  for (const output of parsed.outputs) {
    if (classifyScript(output.scriptPubkeyHex) === "op_return") {
      continue;
    }

    const threshold = dustThresholdForScript(output.scriptPubkeyHex, minRelayFeeSatPerVb);
    if (output.value < threshold) {
      throw new DustValidationError(
        `output value ${output.value} below dust threshold ${threshold}`,
      );
    }
  }

  const buyerInputCount = parsed.inputs.length - 1;
  return { sellerInputIndex, buyerInputCount };
}
