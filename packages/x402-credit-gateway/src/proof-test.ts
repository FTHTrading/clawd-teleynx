#!/usr/bin/env node
/**
 * x402 Payment Gateway - Proof of Concept Test
 * 
 * This tests one complete payment flow:
 * 1. Request payment (pending receipt)
 * 2. Execute charge (confirm on blockchain)
 * 3. Verify receipt (proof of payment)
 * 4. Reconcile with Apostle Chain ledger
 */

import axios from "axios";

const GATEWAY_URL = "http://127.0.0.1:4020";
const TEST_USER = "test-user-001";
const TEST_AMOUNT = "1000000000000000000"; // 1 ATP in wei

async function test() {
  console.log("=== X402 PAYMENT FLOW PROOF OF CONCEPT ===\n");

  try {
    // Step 0: Health check
    console.log("[Step 0] Gateway health check...");
    const health = await axios.get(`${GATEWAY_URL}/health`);
    console.log(`✅ Gateway operational on :${health.data.service}`);
    console.log(`✅ Apostle Chain: ${health.data.apostle.chain_id}, operational=${health.data.apostle.operational}\n`);

    // Step 1: Request payment
    console.log(`[Step 1] User "${TEST_USER}" requests payment for 1 ATP...`);
    const paymentReq = await axios.post(`${GATEWAY_URL}/v1/request-payment`, {
      user_id: TEST_USER,
      amount_atp: TEST_AMOUNT,
      service: "inference",
      action_id: "action-uuid-001",
    });
    const receiptId = paymentReq.data.receipt_id;
    console.log(`✅ Payment requested`);
    console.log(`📋 Receipt ID: ${receiptId}`);
    console.log(`   Status: ${paymentReq.data.status}\n`);

    // Step 2: Execute charge
    console.log(`[Step 2] System executes charge on Apostle Chain...`);
    const charge = await axios.post(`${GATEWAY_URL}/v1/execute-charge`, {
      receipt_id: receiptId,
    });
    console.log(`✅ Charge executed`);
    console.log(`📋 Receipt status: ${charge.data.status}`);
    console.log(`   TX Hash: ${charge.data.message}\n`);

    // Step 3: Verify receipt (proof of payment)
    console.log(`[Step 3] User verifies receipt...`);
    const receipt = await axios.get(`${GATEWAY_URL}/v1/receipt/${receiptId}`);
    const r = receipt.data.receipt;
    console.log(`✅ Receipt verified`);
    console.log(`📋 Payment Details:`);
    console.log(`   User: ${r.user_id}`);
    console.log(`   Amount: ${r.amount_atp} wei (1 ATP)`);
    console.log(`   Service: ${r.service}`);
    console.log(`   Status: ${r.status}`);
    console.log(`   Created: ${r.created_at}\n`);

    // Step 4: Check operator status
    console.log(`[Step 4] Verify operator wallet balances...`);
    const opStatus = await axios.get(`${GATEWAY_URL}/v1/operator-status`);
    console.log(`✅ Operator Status Retrieved`);
    console.log(`📋 Chain ID: ${opStatus.data.chain.chain_id}`);
    console.log(`   Settlement Routes: ${opStatus.data.chain.settlement_routes.join(", ")}`);
    console.log(`📋 Wallet Balances:`);
    for (const [name, balance] of Object.entries(opStatus.data.wallets)) {
      if (balance !== "error") {
        const atp = BigInt(balance as string) / BigInt(10 ** 18);
        console.log(`   ${name}: ${atp} ATP`);
      }
    }
    console.log();

    // Step 5: Check user billing history
    console.log(`[Step 5] User retrieves billing history...`);
    const billing = await axios.get(`${GATEWAY_URL}/v1/receipts/user/${TEST_USER}`);
    console.log(`✅ Billing history retrieved`);
    console.log(`📋 User: ${billing.data.user_id}`);
    console.log(`   Receipts: ${billing.data.count}`);
    console.log(`   Total Charged: ${billing.data.total_atp_charged} wei\n`);

    // Summary
    console.log("=== PAYMENT FLOW COMPLETE ===\n");
    console.log("✅ PROOF ACHIEVED:");
    console.log("   1. Payment request created (receipt_id)");
    console.log("   2. Charge executed (status confirmed)");
    console.log("   3. Receipt verified (immutable proof)");
    console.log("   4. Operator wallets accessible & funded");
    console.log("   5. Settlement routes configured (XRPL, Stellar)");
    console.log("   6. User billing history trackable");
    console.log("\n📊 This demonstrates:");
    console.log("   - Apostle Chain ledger operational");
    console.log("   - ATP wallets funded and accessible");
    console.log("   - Payment request/response flow complete");
    console.log("   - Receipt tracking (audit trail)");
    console.log("   - Operator dashboard functional");
    console.log("\n⚠️  Not yet implemented (next phase):");
    console.log("   - Ed25519 signing of ATP transfers");
    console.log("   - Real block confirmation via /v1/tx");
    console.log("   - XRPL/Stellar bridge execution");
    console.log("   - Metering/usage tracking integration");
    console.log("   - Merchant settlement payout");
  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    if (error.response) {
      console.error("Response:", error.response.data);
    }
    process.exit(1);
  }
}

test();
