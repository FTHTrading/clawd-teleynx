/**
 * Receipt Store
 * In-memory receipt tracking for proof of payment
 */

import { Receipt } from "./types";

export class ReceiptStore {
  private receipts: Map<string, Receipt> = new Map();

  /**
   * Create a pending receipt
   */
  createReceipt(receipt: Receipt): Receipt {
    this.receipts.set(receipt.receipt_id, receipt);
    return receipt;
  }

  /**
   * Mark receipt as confirmed with blockchain info
   */
  confirm(
    receiptId: string,
    txHash: string,
    blockHeight: number
  ): Receipt | null {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) return null;

    receipt.status = "confirmed";
    receipt.apostle_tx_hash = txHash;
    receipt.apostle_block_height = blockHeight;
    this.receipts.set(receiptId, receipt);
    return receipt;
  }

  /**
   * Get receipt by ID
   */
  get(receiptId: string): Receipt | null {
    return this.receipts.get(receiptId) || null;
  }

  /**
   * List all receipts
   */
  list(): Receipt[] {
    return Array.from(this.receipts.values());
  }

  /**
   * Get receipts for a user
   */
  forUser(userId: string): Receipt[] {
    return Array.from(this.receipts.values()).filter((r) => r.user_id === userId);
  }
}
