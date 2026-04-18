/**
 * x402 Payment Gateway Types
 * Minimal proof of concept for ATP payment flow
 */

export interface PaymentRequest {
  user_id: string;
  amount_atp: string; // str_u128 format
  service: "inference" | "inference-router" | "voice" | "execution";
  action_id?: string; // UUID of the triggering action
  idempotency_key?: string; // For replay safety
}

export interface Receipt {
  receipt_id: string; // UUID
  user_id: string;
  amount_atp: string;
  service: string;
  action_id?: string;
  status: "pending" | "confirmed" | "failed";
  apostle_tx_hash?: string; // 64-char hex
  apostle_block_height?: number;
  correlation?: LedgerCorrelation;
  timestamp?: string; // ISO 8601
  created_at: string;
  updated_at?: string;
}

export interface LedgerCorrelation {
  correlation_id: string;
  receipt_id: string;
  apostle_agent_id?: string;
  apostle_wallet_address?: string;
  apostle_tx_envelope?: string; // Full TxEnvelope JSON if available
  apostle_tx_hash: string;
  apostle_block_height: number;
  apostle_block_timestamp?: string;
  settlement_status: "pending" | "confirmed" | "failed";
  confirmed_at?: string;
  created_at: string;
}

export interface IdempotencyRecord {
  idempotency_key: string;
  request_hash: string;
  receipt_id?: string;
  status: "pending" | "confirmed" | "failed";
  response_payload?: string;
  created_at: string;
  expires_at: string;
}

export interface ApostleTransfer {
  hash: string; // 64-char hex, no 0x
  from: string; // bare UUID
  nonce: number;
  chain_id: number;
  payload: {
    type: "transfer";
    to: string; // bare UUID
    asset: "ATP";
    amount: string; // str_u128
  };
  signature: string; // 128-char hex
  timestamp: string; // ISO 8601
}

export interface ApostleTransferResult {
  hash: string;
  blockHeight?: number;
}

export interface ApostleChainStatus {
  chain_id: number;
  operational: boolean;
  service: string;
  settlement_routes: string[];
  timestamp: string;
  height?: number;
  agents?: number;
  mempool?: number;
  finalized_tips?: number;
}

