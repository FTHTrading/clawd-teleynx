/**
 * File-Based Persistent Storage for x402-credit-gateway
 * Durable JSON persistence with atomic writes
 */

import fs from "fs";
import path from "path";

interface StoredReceipt {
  receipt_id: string;
  user_id: string;
  amount_atp: string;
  service: string;
  action_id?: string;
  status: string;
  apostle_tx_hash?: string;
  apostle_block_height?: number;
  created_at: string;
  updated_at: string;
}

interface StoredIdempotency {
  idempotency_key: string;
  request_hash: string;
  receipt_id?: string;
  status: string;
  response_payload?: string;
  created_at: string;
  expires_at: string;
}

interface StoredCorrelation {
  correlation_id: string;
  receipt_id: string;
  apostle_agent_id?: string;
  apostle_tx_hash: string;
  apostle_block_height: number;
  settlement_status: string;
  confirmed_at?: string;
  created_at: string;
}

interface PersistenceStore {
  receipts: Record<string, StoredReceipt>;
  idempotency: Record<string, StoredIdempotency>;
  correlation: Record<string, StoredCorrelation>;
}

const DATA_DIR = process.env.X402_DB_PATH || path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "x402-store.json");

export class FileBasedPersistence {
  private store: PersistenceStore = { receipts: {}, idempotency: {}, correlation: {} };
  private initialized: boolean = false;

  constructor() {
    this.ensureDataDir();
    this.loadStore();
    this.initialized = true;
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadStore() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const data = fs.readFileSync(STORE_FILE, "utf-8");
        this.store = JSON.parse(data);
      }
    } catch (error) {
      console.error("Failed to load store:", error);
      this.store = { receipts: {}, idempotency: {}, correlation: {} };
    }
  }

  private saveStore() {
    try {
      const tempFile = STORE_FILE + ".tmp";
      fs.writeFileSync(tempFile, JSON.stringify(this.store, null, 2), "utf-8");
      if (fs.existsSync(STORE_FILE)) {
        fs.rmSync(STORE_FILE);
      }
      fs.renameSync(tempFile, STORE_FILE);
    } catch (error) {
      console.error("Failed to save store:", error);
    }
  }

  createReceiptIdempotent(
    receiptId: string,
    userId: string,
    amountAtp: string,
    service: string,
    actionId: string | undefined,
    idempotencyKey: string | undefined
  ) {
    const now = new Date().toISOString();

    if (idempotencyKey) {
      const existing = this.store.idempotency[idempotencyKey];
      if (existing && existing.receipt_id) {
        return { receipt_id: existing.receipt_id, status: "pending", idempotent: true };
      }
    }

    const receipt: StoredReceipt = {
      receipt_id: receiptId,
      user_id: userId,
      amount_atp: amountAtp,
      service,
      action_id: actionId,
      status: "pending",
      created_at: now,
      updated_at: now,
    };

    this.store.receipts[receiptId] = receipt;

    if (idempotencyKey) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      this.store.idempotency[idempotencyKey] = {
        idempotency_key: idempotencyKey,
        request_hash: `${userId}:${amountAtp}:${service}`,
        receipt_id: receiptId,
        status: "pending",
        created_at: now,
        expires_at: expiresAt,
      };
    }

    this.saveStore();
    return { receipt_id: receiptId, status: "pending", idempotent: false };
  }

  confirmReceipt(
    receiptId: string,
    txHash: string,
    blockHeight: number,
    agentId?: string
  ) {
    const now = new Date().toISOString();
    const receipt = this.store.receipts[receiptId];

    if (receipt) {
      receipt.status = "confirmed";
      receipt.apostle_tx_hash = txHash;
      receipt.apostle_block_height = blockHeight;
      receipt.updated_at = now;
    }

    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.store.correlation[correlationId] = {
      correlation_id: correlationId,
      receipt_id: receiptId,
      apostle_agent_id: agentId,
      apostle_tx_hash: txHash,
      apostle_block_height: blockHeight,
      settlement_status: "confirmed",
      confirmed_at: now,
      created_at: now,
    };

    this.saveStore();

    return {
      receipt_id: receiptId,
      status: "confirmed",
      correlation_id: correlationId,
      apostle_tx_hash: txHash,
      apostle_block_height: blockHeight,
    };
  }

  getReceipt(receiptId: string) {
    const receipt = this.store.receipts[receiptId];
    if (!receipt) return null;

    const correlation = Object.values(this.store.correlation).find(
      (c) => c.receipt_id === receiptId
    );

    return { ...receipt, correlation: correlation || null };
  }

  listUserReceipts(userId: string) {
    return Object.values(this.store.receipts)
      .filter((r) => r.user_id === userId)
      .map((r) => {
        const correlation = Object.values(this.store.correlation).find(
          (c) => c.receipt_id === r.receipt_id
        );
        return { ...r, correlation_id: correlation?.correlation_id };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  listAllReceipts() {
    return Object.values(this.store.receipts)
      .map((r) => {
        const correlation = Object.values(this.store.correlation).find(
          (c) => c.receipt_id === r.receipt_id
        );
        return { ...r, correlation_id: correlation?.correlation_id };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  health() {
    return {
      ok: true,
      receipts: Object.keys(this.store.receipts).length,
      storage_path: STORE_FILE,
    };
  }
}

let persistence: FileBasedPersistence | null = null;

export function getDatabase(): FileBasedPersistence {
  if (!persistence) {
    persistence = new FileBasedPersistence();
  }
  return persistence;
}
