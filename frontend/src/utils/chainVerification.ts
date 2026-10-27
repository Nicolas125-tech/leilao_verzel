import type { AuditNode } from "../types/api.ts";

export interface NodeVerificationDetail {
  sequenceNumber: number;
  computedHash: string;
  storedHash: string;
  isHashMatch: boolean;
  isLinkMatch: boolean;
}

export interface ClientVerificationResult {
  isValid: boolean;
  totalVerified: number;
  tamperedCount: number;
  durationMs: number;
  details: NodeVerificationDetail[];
  errorMessage?: string;
}

export async function sha256Hex(message: string): Promise<string> {
  const subtle = (globalThis.crypto || window.crypto)?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto API indisponível neste navegador.");
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyChainInBrowser(
  lotId: string,
  headHash: string,
  nodes: AuditNode[],
): Promise<ClientVerificationResult> {
  const startTime = performance.now();

  if (nodes.length === 0) {
    const isGenesis = headHash === "GENESIS";
    return {
      isValid: isGenesis,
      totalVerified: 0,
      tamperedCount: isGenesis ? 0 : 1,
      durationMs: Math.round(performance.now() - startTime),
      details: [],
      errorMessage: isGenesis
        ? undefined
        : "Lote vazio mas o hash de topo diverge de GENESIS.",
    };
  }

  const details: NodeVerificationDetail[] = [];
  let tamperedCount = 0;
  let expectedPrev = "GENESIS";

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLinkMatch =
      node.previous_hash === expectedPrev &&
      node.sequence_number === i + 1;

    const canonicalPayload = `${lotId}|${node.sequence_number}|${node.bidder_masked_name}|${node.amount_cents}|${node.created_at_iso}|${node.previous_hash}`;
    const computedHash = await sha256Hex(canonicalPayload);
    const isHashMatch = computedHash === node.stored_hash;

    if (!isLinkMatch || !isHashMatch) {
      tamperedCount++;
    }

    details.push({
      sequenceNumber: node.sequence_number,
      computedHash,
      storedHash: node.stored_hash,
      isHashMatch,
      isLinkMatch,
    });

    expectedPrev = node.stored_hash;
  }

  const lastNode = nodes[nodes.length - 1];
  const isHeadMatch = lastNode.stored_hash === headHash;
  if (!isHeadMatch) {
    tamperedCount++;
  }

  const durationMs = Math.round(performance.now() - startTime);

  return {
    isValid: tamperedCount === 0,
    totalVerified: nodes.length,
    tamperedCount,
    durationMs,
    details,
    errorMessage:
      tamperedCount > 0
        ? `Detectadas ${tamperedCount} inconsistências criptográficas na cadeia.`
        : undefined,
  };
}
