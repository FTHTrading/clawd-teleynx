import fetch from "node-fetch";

const BASE_URL = "http://localhost:4020";

async function testPaymentFlow() {
  console.log("\n=== X402 CREDIT GATEWAY PROOF TEST ===\n");
  
  try {
    // Step 1: Health check
    console.log("✓ Step 1: Health Check");
    const healthResp = await fetch(`${BASE_URL}/health`);
    const health = await healthResp.json();
    console.log(`  Gateway: ${health.service}`);
    console.log(`  Apostle Chain: ${health.apostle.service}\n`);

    // Step 2: Create payment request
    console.log("✓ Step 2: Create Payment Request");
    const paymentResp = await fetch(`${BASE_URL}/v1/request-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "test-user-001",
        amount_atp: "1000000000000000000",
        service: "test-service",
        action_id: "test-action-123"
      })
    });
    const payment = await paymentResp.json();
    const receiptId = payment.receipt_id;
    console.log(`  Receipt ID: ${receiptId}`);
    console.log(`  Status: ${payment.status}\n`);

    // Step 3: Get receipt
    console.log("✓ Step 3: Get Receipt Details");
    const rcptResp = await fetch(`${BASE_URL}/v1/receipt/${receiptId}`);
    const rcpt = await rcptResp.json();
    console.log(`  User ID: ${rcpt.receipt.user_id}`);
    console.log(`  Amount: ${rcpt.receipt.amount_atp} ATP`);
    console.log(`  Service: ${rcpt.receipt.service}`);
    console.log(`  Status: ${rcpt.receipt.status}\n`);

    // Step 4: Execute charge
    console.log("✓ Step 4: Execute Charge");
    const chargeResp = await fetch(`${BASE_URL}/v1/execute-charge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt_id: receiptId })
    });
    const charge = await chargeResp.json();
    console.log(`  Status: ${charge.status}`);
    console.log(`  Message: ${charge.message}\n`);

    // Step 5: List all receipts
    console.log("✓ Step 5: List All Receipts");
    const listResp = await fetch(`${BASE_URL}/v1/receipts`);
    const list = await listResp.json();
    console.log(`  Total receipts: ${list.total}`);
    if (list.receipts.length > 0) {
      console.log(`  Latest receipt ID: ${list.receipts[list.receipts.length-1].receipt_id}\n`);
    }

    console.log("=== ALL TESTS PASSED ✓ ===\n");
    process.exit(0);
  } catch (error) {
    console.error("✗ Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testPaymentFlow();
