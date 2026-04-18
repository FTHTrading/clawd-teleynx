/**
 * Apostle Chain Client
 * Direct HTTP interface to ATP ledger
 */

import axios from "axios";
import { ApostleChainStatus, ApostleTransfer, ApostleTransferResult } from "./types";

export class ApostleClient {
  private baseUrl: string;

  constructor(apostleUrl: string = "http://127.0.0.1:7332") {
    this.baseUrl = apostleUrl;
  }

  private normalizeStatus(data: any): ApostleChainStatus {
    const isStringHealthy =
      typeof data === "string" && /ok|healthy|up|running/i.test(data);
    const hasHeight = typeof data?.height === "number";

    const inferredOperational =
      typeof data?.operational === "boolean"
        ? data.operational
        : typeof data?.ok === "boolean"
        ? data.ok
        : hasHeight || isStringHealthy;

    return {
      chain_id: Number(data?.chain_id ?? 7332),
      operational: inferredOperational,
      service: String(data?.service ?? "apostle-chain"),
      settlement_routes: Array.isArray(data?.settlement_routes)
        ? data.settlement_routes
        : ["XRPL", "Stellar"],
      timestamp: String(data?.timestamp ?? new Date().toISOString()),
      height: typeof data?.height === "number" ? data.height : undefined,
      agents: typeof data?.agents === "number" ? data.agents : undefined,
      mempool: typeof data?.mempool === "number" ? data.mempool : undefined,
      finalized_tips:
        typeof data?.finalized_tips === "number" ? data.finalized_tips : undefined,
    };
  }

  /**
   * Check if chain is operational
   */
  async health(): Promise<ApostleChainStatus> {
    try {
      const healthResp = await axios.get(`${this.baseUrl}/health`, { timeout: 3000 });
      const normalized = this.normalizeStatus(healthResp.data);

      if (
        normalized.operational ||
        typeof healthResp.data?.operational === "boolean" ||
        typeof healthResp.data?.ok === "boolean" ||
        typeof healthResp.data?.height === "number"
      ) {
        return normalized;
      }

      const statusResp = await axios.get(`${this.baseUrl}/status`, { timeout: 3000 });
      return this.normalizeStatus(statusResp.data);
    } catch {
      try {
        const statusResp = await axios.get(`${this.baseUrl}/status`, { timeout: 3000 });
        return this.normalizeStatus(statusResp.data);
      } catch (error) {
        throw new Error(`Apostle Chain health check failed: ${error}`);
      }
    }
  }

  /**
   * Get balance for an agent account
   * Accepts both bare UUID and agent:UUID format
   */
  async getBalance(agentId: string): Promise<string> {
    try {
      const resp = await axios.get(`${this.baseUrl}/v1/agent/${agentId}/balance`);
      return resp.data?.apo_balance || "0";
    } catch (error) {
      throw new Error(`Failed to get balance for ${agentId}: ${error}`);
    }
  }

  /**
   * Submit a signed ATP transfer
   * Returns transaction hash
   */
  async transfer(tx: ApostleTransfer): Promise<ApostleTransferResult> {
    try {
      const resp = await axios.post(`${this.baseUrl}/v1/tx`, tx, {
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      const hash =
        resp.data?.hash ||
        resp.data?.tx_hash ||
        resp.data?.result?.hash ||
        tx.hash;
      const blockHeight =
        resp.data?.block_height ??
        resp.data?.height ??
        resp.data?.result?.block_height;

      return { hash, blockHeight };
    } catch (error) {
      throw new Error(`Transfer failed: ${error}`);
    }
  }

  /**
   * Fetch receipts from the ledger
   */
  async getReceipts(): Promise<any[]> {
    try {
      const resp = await axios.get(`${this.baseUrl}/v1/receipts`);
      return resp.data?.receipts || [];
    } catch (error) {
      throw new Error(`Failed to fetch receipts: ${error}`);
    }
  }
}
