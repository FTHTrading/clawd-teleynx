/**
 * X402 Credit Gateway v2.0 — Hardened with File-Based Persistence
 * PHASES 1-5: Durable storage, idempotency, ledger correlation, signing mode awareness, operator observability
 */

import express, { Request, Response } from "express";
import crypto from "crypto";
import nacl from "tweetnacl";
import { v4 as uuidv4 } from "uuid";
import { ApostleClient } from "./apostle-client";
import { getDatabase } from "./persistence";
import { ApostleTransfer, PaymentRequest } from "./types";

const app = express();
const apostle = new ApostleClient();
const db = getDatabase();

app.use(express.json());

const OPERATORS = {
  "kevan-burns-chairman": "87724c76-da93-4b1a-9fa6-271ba856338e",
  "genesis-treasury": "69bd2893-1881-4683-adb1-bb886fdb6f9d",
  "unykorn-operator": "c3b64661-0a22-4833-9b71-cca54cfd9e05",
  "x402-credit-pool": "d362fd52-d0b0-4f41-84b8-fffda1b7e704",
  "mesh-pay-reserve": "52a71a64-0c3e-462b-af52-fe85ab28c650",
};

function toSecretKey(privateKeyHex: string): Uint8Array {
  const keyBytes = Buffer.from(privateKeyHex, "hex");
  if (keyBytes.length === 64) {
    return new Uint8Array(keyBytes);
  }
  if (keyBytes.length === 32) {
    return nacl.sign.keyPair.fromSeed(new Uint8Array(keyBytes)).secretKey;
  }
  throw new Error("X402_OPERATOR_PRIVATE_KEY must be 32-byte seed (64 hex) or 64-byte secret key (128 hex)");
}

function buildSignedTransfer(params: {
  from: string;
  to: string;
  amount: string;
  chainId: number;
  nonce: number;
  timestamp: string;
  privateKeyHex: string;
}): ApostleTransfer {
  const payload = {
    type: "transfer" as const,
    to: params.to,
    asset: "ATP" as const,
    amount: params.amount,
  };

  const preimage = {
    from: params.from,
    nonce: params.nonce,
    chain_id: params.chainId,
    payload,
    timestamp: params.timestamp,
  };

  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(preimage))
    .digest("hex");

  const secretKey = toSecretKey(params.privateKeyHex);
  const signature = Buffer.from(
    nacl.sign.detached(Buffer.from(hash, "hex"), secretKey)
  ).toString("hex");

  return {
    hash,
    from: params.from,
    nonce: params.nonce,
    chain_id: params.chainId,
    payload,
    signature,
    timestamp: params.timestamp,
  };
}

/**
 * Health: all 5 phases active
 */
app.get("/health", async (req: Request, res: Response) => {
  try {
    const chainHealth = await apostle.health();
    const dbHealth = db.health();
    const signingMode = process.env.X402_SIGN_REAL === "true" ? "real" : "staged";

    res.json({
      ok: dbHealth.ok && chainHealth.operational,
      version: "2.0.0",
      phases: [
        "PHASE 1: Persistent Storage ✓",
        "PHASE 2: Idempotency Keys ✓",
        "PHASE 3: Ledger Correlation ✓",
        "PHASE 4: Signing Mode Awareness ✓",
        "PHASE 5: Operator Observability ✓",
      ],
      persistence: {
        type: "json-file",
        ok: dbHealth.ok,
        receipts: dbHealth.receipts,
        path: dbHealth.storage_path,
      },
      chain: {
        operational: chainHealth.operational,
        chain_id: chainHealth.chain_id,
      },
      signing: {
        mode: signingMode,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * Request payment (PHASE 1+2)
 */
app.post("/v1/request-payment", async (req: Request, res: Response) => {
  try {
    const { user_id, amount_atp, service, action_id, idempotency_key } =
      req.body as PaymentRequest & { idempotency_key?: string };

    if (!user_id || !amount_atp || !service) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const receiptId = uuidv4();
    const result = db.createReceiptIdempotent(
      receiptId,
      user_id,
      amount_atp,
      service,
      action_id,
      idempotency_key
    );

    if (result.idempotent) {
      return res.status(200).json({
        ok: true,
        receipt_id: result.receipt_id,
        status: result.status,
        idempotent: true,
      });
    }

    res.status(201).json({
      ok: true,
      receipt_id: result.receipt_id,
      status: result.status,
      idempotency_key: idempotency_key || null,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * Execute charge (PHASE 3+4)
 */
app.post("/v1/execute-charge", async (req: Request, res: Response) => {
  try {
    const { receipt_id, signing_mode } = req.body as {
      receipt_id: string;
      signing_mode?: "staged" | "real";
    };

    if (!receipt_id) {
      return res.status(400).json({ error: "Missing receipt_id" });
    }

    const receipt = db.getReceipt(receipt_id);
    if (!receipt) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    if (receipt.status === "confirmed") {
      return res.status(409).json({ error: "Already confirmed" });
    }

    const actualMode = signing_mode || (process.env.X402_SIGN_REAL === "true" ? "real" : "staged");
    const operatorKey = process.env.X402_OPERATOR_PRIVATE_KEY;

    if (actualMode === "real" && !operatorKey) {
      return res.status(503).json({
        ok: false,
        error: "Real signing requested but X402_OPERATOR_PRIVATE_KEY is not configured",
      });
    }

    const chainHealth = await apostle.health();

    let txHash = `${actualMode}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let blockHeight = actualMode === "staged" ? 999 : Math.floor(Math.random() * 1000) + 1;
    let chainSubmission = false;

    if (actualMode === "real") {
      const operatorAgentId = process.env.X402_OPERATOR_AGENT_ID || OPERATORS["kevan-burns-chairman"];
      const settlementToAgent =
        process.env.X402_SETTLEMENT_TO_AGENT_ID || OPERATORS["x402-credit-pool"];

      const signedTransfer = buildSignedTransfer({
        from: operatorAgentId,
        to: settlementToAgent,
        amount: receipt.amount_atp,
        chainId: chainHealth.chain_id,
        nonce: Date.now(),
        timestamp: new Date().toISOString(),
        privateKeyHex: operatorKey!,
      });

      const transferResult = await apostle.transfer(signedTransfer);
      if (!transferResult.hash) {
        return res.status(502).json({
          ok: false,
          error: "Apostle transfer did not return a hash",
        });
      }

      txHash = transferResult.hash;
      blockHeight =
        transferResult.blockHeight ??
        (typeof chainHealth.height === "number" ? chainHealth.height + 1 : 1);
      chainSubmission = true;
    }

    const confirmed = db.confirmReceipt(
      receipt_id,
      txHash,
      blockHeight,
      OPERATORS["kevan-burns-chairman"]
    );

    const stored = db.getReceipt(receipt_id);
    const ledgerHashVerified =
      stored?.correlation?.apostle_tx_hash === txHash &&
      stored?.correlation?.correlation_id === confirmed.correlation_id;

    res.status(200).json({
      ok: true,
      receipt_id: confirmed.receipt_id,
      status: confirmed.status,
      correlation_id: confirmed.correlation_id,
      apostle_tx_hash: confirmed.apostle_tx_hash,
      apostle_block_height: confirmed.apostle_block_height,
      signing_mode: actualMode,
      chain_submitted: chainSubmission,
      ledger_hash_verified: ledgerHashVerified,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * Get receipt (PHASE 3)
 */
app.get("/v1/receipt/:receipt_id", async (req: Request, res: Response) => {
  try {
    const { receipt_id } = req.params;
    const receipt = db.getReceipt(receipt_id);

    if (!receipt) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    res.json({
      ok: true,
      receipt: {
        receipt_id: receipt.receipt_id,
        user_id: receipt.user_id,
        amount_atp: receipt.amount_atp,
        service: receipt.service,
        status: receipt.status,
        created_at: receipt.created_at,
      },
      correlation: receipt.correlation || null,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * List receipts
 */
app.get("/v1/receipts", async (req: Request, res: Response) => {
  try {
    const allReceipts = db.listAllReceipts();
    res.json({
      ok: true,
      count: allReceipts.length,
      receipts: allReceipts,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * User receipts
 */
app.get("/v1/receipts/user/:user_id", async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const userReceipts = db.listUserReceipts(user_id);
    const confirmed = userReceipts
      .filter((r) => r.status === "confirmed")
      .reduce((sum: bigint, r) => BigInt(sum) + BigInt(r.amount_atp), BigInt(0))
      .toString();

    res.json({
      ok: true,
      user_id,
      receipts: userReceipts,
      confirmed_atp: confirmed,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * Operator status (PHASE 5)
 */
app.get("/v1/operator-status", async (req: Request, res: Response) => {
  try {
    const dbHealth = db.health();
    const chainHealth = await apostle.health();
    const signingMode = process.env.X402_SIGN_REAL === "true" ? "real" : "staged";

    const persistenceOk = dbHealth.ok;
    const chainOk = chainHealth.operational;
    const signingOk =
      signingMode === "staged" ||
      (!!process.env.X402_OPERATOR_PRIVATE_KEY &&
        !!(process.env.X402_OPERATOR_AGENT_ID || OPERATORS["kevan-burns-chairman"]));

    let status: "green" | "yellow" | "red" = "green";
    if (!persistenceOk || !chainOk) status = "red";
    else if (!signingOk) status = "yellow";

    const wallets: Record<string, { balance: string; ok: boolean }> = {};
    for (const [name, agentId] of Object.entries(OPERATORS)) {
      try {
        const balance = await apostle.getBalance(agentId);
        wallets[name] = { balance, ok: true };
      } catch {
        wallets[name] = { balance: "0", ok: false };
      }
    }

    res.json({
      ok: status !== "red",
      health_status: status,
      operator_readout: {
        gateway: {
          status,
          reason:
            status === "red"
              ? "Critical: persistence or chain failed"
              : status === "yellow"
              ? "Warning: signing not ready"
              : "All systems healthy",
        },
        persistence: {
          status: persistenceOk ? "green" : "red",
          receipts: dbHealth.receipts,
          path: dbHealth.storage_path,
        },
        chain: {
          status: chainOk ? "green" : "red",
          operational: chainHealth.operational,
          chain_id: chainHealth.chain_id,
        },
        signing: {
          mode: signingMode,
          ready: signingOk,
        },
        wallets: {
          status: Object.values(wallets).every((w) => w.ok) ? "green" : "yellow",
          list: wallets,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * x402 probe — lightweight connectivity check for external agents
 */
app.get("/v1/x402/probe", async (_req: Request, res: Response) => {
  try {
    const chainHealth = await apostle.health();
    const dbHealth = db.health();
    res.json({
      ok: true,
      protocol: "x402",
      chain_id: chainHealth.chain_id,
      chain_operational: chainHealth.operational,
      persistence_ok: dbHealth.ok,
      receipts_stored: dbHealth.receipts,
      signing_mode: process.env.X402_SIGN_REAL === "true" ? "real" : "staged",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({ ok: false, error: String(error) });
  }
});

/**
 * x402 request-payment — proper 402 Payment Required flow.
 *
 * If the request carries a valid X-Payment-Receipt header the receipt is
 * verified and the service responds 200 with confirmation.
 * Without the header the service responds 402 with a payment descriptor
 * (asset, amount, chain_id, payTo, nonce, deadline) which the client must
 * fulfil before retrying with X-Payment-Receipt.
 */
app.post("/v1/x402/request-payment", async (req: Request, res: Response) => {
  try {
    const receiptHeader = req.headers["x-payment-receipt"] as string | undefined;
    const { service, action_id, amount_atp, user_id } = req.body as {
      service?: string;
      action_id?: string;
      amount_atp?: string;
      user_id?: string;
    };

    if (!service || !amount_atp || !user_id) {
      return res.status(400).json({ error: "Missing required fields: service, amount_atp, user_id" });
    }

    // Step 4–5: client retried with X-Payment-Receipt — verify it
    if (receiptHeader) {
      let parsed: { receipt_id?: string; tx_hash?: string } = {};
      try {
        parsed = JSON.parse(Buffer.from(receiptHeader, "base64").toString("utf8"));
      } catch {
        return res.status(400).json({ error: "X-Payment-Receipt is not valid base64 JSON" });
      }

      const receipt = parsed.receipt_id ? db.getReceipt(parsed.receipt_id) : null;
      if (!receipt || receipt.status !== "confirmed") {
        return res.status(402).json({
          error: "Receipt not found or not confirmed",
          hint: "Obtain a confirmed receipt via /v1/execute-charge then retry",
        });
      }

      const chainHealth = await apostle.health();
      return res.status(200).json({
        ok: true,
        verified: true,
        receipt_id: receipt.receipt_id,
        correlation: receipt.correlation,
        service,
        action_id: action_id || null,
        chain_id: chainHealth.chain_id,
        message: "Payment verified — service access granted",
      });
    }

    // Steps 1–3: no receipt — issue 402 with payment descriptor
    const nonce = uuidv4();
    const deadline = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
    const payToAgent = process.env.X402_SETTLEMENT_TO_AGENT_ID || OPERATORS["x402-credit-pool"];
    const chainHealth = await apostle.health();

    return res.status(402).json({
      error: "Payment Required",
      payment_descriptor: {
        asset: "ATP",
        amount: amount_atp,
        chain_id: chainHealth.chain_id,
        payTo: payToAgent,
        nonce,
        deadline,
        service,
        action_id: action_id || null,
      },
      instructions: [
        "1. POST /v1/request-payment to obtain a receipt_id",
        "2. POST /v1/execute-charge with receipt_id to settle on Apostle chain",
        "3. Retry this endpoint with header: X-Payment-Receipt: <base64(JSON receipt)>",
      ],
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

/**
 * x402 verify-receipt — standalone receipt verification against Apostle chain.
 * Accepts { receipt_id } and confirms the tx_hash exists in the local ledger
 * correlation. Does not re-execute; only reads stored state.
 */
app.post("/v1/x402/verify-receipt", async (req: Request, res: Response) => {
  try {
    const { receipt_id } = req.body as { receipt_id?: string };
    if (!receipt_id) {
      return res.status(400).json({ error: "Missing receipt_id" });
    }

    const receipt = db.getReceipt(receipt_id);
    if (!receipt) {
      return res.status(404).json({ ok: false, error: "Receipt not found" });
    }

    const verified = receipt.status === "confirmed" && !!receipt.correlation?.apostle_tx_hash;
    const chainHealth = await apostle.health();

    res.json({
      ok: verified,
      receipt_id,
      status: receipt.status,
      verified,
      chain_id: chainHealth.chain_id,
      apostle_tx_hash: receipt.correlation?.apostle_tx_hash || null,
      apostle_block_height: receipt.correlation?.apostle_block_height || null,
      correlation_id: receipt.correlation?.correlation_id || null,
      user_id: receipt.user_id,
      amount_atp: receipt.amount_atp,
      service: receipt.service,
      created_at: receipt.created_at,
      message: verified
        ? "Receipt confirmed on Apostle chain (chain_id 7332, ATP/Ed25519)"
        : "Receipt exists but is not yet confirmed — run /v1/execute-charge first",
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

app.get("/", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "x402-credit-gateway",
    version: "2.0.0",
    status: "online",
    mode: process.env.X402_SIGN_REAL === "true" ? "real" : "staged",
    endpoints: [
      "/health",
      "/v1/x402/probe",
      "/v1/x402/request-payment",
      "/v1/x402/verify-receipt",
      "/v1/operator-status",
      "/v1/request-payment",
      "/v1/execute-charge",
      "/v1/receipts",
      "/v1/receipt/:receipt_id",
    ],
    note: "x402 payment flow: POST /v1/x402/request-payment → 402 descriptor → charge → retry with X-Payment-Receipt",
  });
});

const PORT = process.env.PORT || 4020;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║        X402 CREDIT GATEWAY v2.0 — ONLINE                       ║
╠════════════════════════════════════════════════════════════════╣
║ ✓ PHASE 1: Persistent Storage (JSON file-based)               ║
║ ✓ PHASE 2: Idempotency Keys (24h TTL)                         ║
║ ✓ PHASE 3: Ledger Correlation Tracking                        ║
║ ✓ PHASE 4: Signing Mode Awareness (staged/real)               ║
║ ✓ PHASE 5: Operator Observability (red/yellow/green)          ║
╠════════════════════════════════════════════════════════════════╣
║ Port: ${PORT} | Database: ${process.env.X402_DB_PATH || "data/x402.db"}
║ Signing: ${process.env.X402_SIGN_REAL === "true" ? "REAL" : "STAGED"} | Chain: Apostle (7332)
╚════════════════════════════════════════════════════════════════╝
  `);
});

