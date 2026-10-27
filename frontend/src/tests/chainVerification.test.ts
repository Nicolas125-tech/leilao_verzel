import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuditNode } from "../types/api.ts";
import {
  sha256Hex,
  verifyChainInBrowser,
} from "../utils/chainVerification.ts";

describe("Verificação Criptográfica Local no Navegador (Zero Trust)", () => {
  it("calcula o hash SHA-256 canônico idêntico ao padrão", async () => {
    const hash = await sha256Hex("casa_de_leiloes_verzel");
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("aprova cadeia vazia com bloco GENESIS", async () => {
    const result = await verifyChainInBrowser("lot-1", "GENESIS", []);
    assert.equal(result.isValid, true);
    assert.equal(result.totalVerified, 0);
    assert.equal(result.tamperedCount, 0);
  });

  it("rejeita cadeia vazia com hash divergente de GENESIS", async () => {
    const result = await verifyChainInBrowser("lot-1", "HASH_INVALIDO", []);
    assert.equal(result.isValid, false);
    assert.equal(result.tamperedCount, 1);
  });

  it("valida encadeamento legítimo de lances com WebCrypto", async () => {
    const lotId = "7a8a25c1-e6d8-4f51-b842-88f5c9e2b111";
    const t1 = "2026-10-24T15:00:00+00:00";
    const t2 = "2026-10-24T15:02:00+00:00";

    const hash1 = await sha256Hex(`${lotId}|1|LIC-1001 (A***o)|100000|${t1}|GENESIS`);
    const hash2 = await sha256Hex(`${lotId}|2|LIC-1002 (B***a)|120000|${t2}|${hash1}`);

    const nodes: AuditNode[] = [
      {
        sequence_number: 1,
        bid_id: "bid-1",
        bidder_masked_name: "LIC-1001 (A***o)",
        amount_cents: 100000,
        created_at_iso: t1,
        previous_hash: "GENESIS",
        expected_previous_hash: "GENESIS",
        stored_hash: hash1,
        recalculated_hash: hash1,
        is_valid: true,
      },
      {
        sequence_number: 2,
        bid_id: "bid-2",
        bidder_masked_name: "LIC-1002 (B***a)",
        amount_cents: 120000,
        created_at_iso: t2,
        previous_hash: hash1,
        expected_previous_hash: hash1,
        stored_hash: hash2,
        recalculated_hash: hash2,
        is_valid: true,
      },
    ];

    const result = await verifyChainInBrowser(lotId, hash2, nodes);
    assert.equal(result.isValid, true);
    assert.equal(result.totalVerified, 2);
    assert.equal(result.tamperedCount, 0);
    assert.equal(result.details[0].isHashMatch, true);
    assert.equal(result.details[1].isHashMatch, true);
  });

  it("detecta adulteração caso o valor do lance seja modificado no banco", async () => {
    const lotId = "7a8a25c1-e6d8-4f51-b842-88f5c9e2b111";
    const t1 = "2026-10-24T15:00:00+00:00";

    const genuineHash = await sha256Hex(`${lotId}|1|LIC-1001 (A***o)|100000|${t1}|GENESIS`);

    const nodes: AuditNode[] = [
      {
        sequence_number: 1,
        bid_id: "bid-1",
        bidder_masked_name: "LIC-1001 (A***o)",
        amount_cents: 999999,
        created_at_iso: t1,
        previous_hash: "GENESIS",
        expected_previous_hash: "GENESIS",
        stored_hash: genuineHash,
        recalculated_hash: genuineHash,
        is_valid: true,
      },
    ];

    const result = await verifyChainInBrowser(lotId, genuineHash, nodes);
    assert.equal(result.isValid, false);
    assert.equal(result.tamperedCount, 1);
    assert.equal(result.details[0].isHashMatch, false);
  });
});
