// ============================================================================
// Type-definition tests — compiled by `npm run typecheck`, never executed.
// A compile error here is a test failure.
// ============================================================================

import {
  charge,
  execute,
  refund,
  retrieve,
  configure,
  clearConfig,
  getSupportedGateways,
  getGatewayCapabilities,
  verifySslcommerzIpn,
  parseNagadCallback,
  PaymentError,
  GatewayNotFoundError,
  ConfigurationError,
  type GatewayName,
  type PaymentResult,
  type RefundResult,
  type RetrieveResult,
  type StripeChargeOptions,
} from "../src/index.js";

// --- configure ---

configure({
  stripe: { apiKey: "sk_test_x", timeoutMs: 10_000 },
  bkash: {
    appKey: "a",
    appSecret: "b",
    username: "c",
    password: "d",
    sandbox: true,
  },
  nagad: {
    merchantId: "m",
    publicKey: "p",
    privateKey: "k",
    clientIp: "203.0.113.1",
  },
});

clearConfig();

// --- charge, narrowed per gateway ---

const stripeCharge: StripeChargeOptions = {
  gateway: "stripe",
  amount: 1000,
  currency: "usd",
  paymentMethod: "pm_card_visa",
  confirm: true,
  idempotencyKey: "order-1",
};

async function main(): Promise<void> {
  const payment: PaymentResult = await charge(stripeCharge);
  const gatewayPage: string | undefined = payment.gatewayPageURL;
  void gatewayPage;

  await charge({
    gateway: "sslcommerz",
    amount: 1000,
    transactionId: "TXN-1",
    successUrl: "https://x/s",
    failUrl: "https://x/f",
    cancelUrl: "https://x/c",
  });

  await charge({ gateway: "bkash", amount: 500, invoiceNumber: "INV-1" });
  await charge({ gateway: "nagad", amount: 500, orderId: "ORD-1" });

  // execute() must be exported and typed.
  const executed: PaymentResult = await execute({
    gateway: "bkash",
    paymentID: "TR001",
  });
  void executed;

  const refunded: RefundResult = await refund({
    gateway: "stripe",
    transactionId: "pi_1",
    amount: 500,
  });
  void refunded;

  await refund({
    gateway: "bkash",
    transactionId: "TR001",
    trxID: "TRX1",
    amount: 100,
  });

  const found: RetrieveResult = await retrieve({
    gateway: "sslcommerz",
    valId: "val_1",
  });
  // transactionId is nullable at runtime, so it must be nullable here too.
  const id: string | null = found.transactionId;
  void id;

  const caps = await getGatewayCapabilities("bkash");
  const canExecute: boolean = caps.execute;
  void canExecute;

  const names: GatewayName[] = getSupportedGateways();
  void names;
}

void main();

// --- webhooks ---

const valid: boolean = verifySslcommerzIpn({ verify_sign: "x", verify_key: "a" });
void valid;

const callback = parseNagadCallback("order_id=ORD-1");
const orderId: string | null = callback.orderId;
void orderId;

// --- errors ---

const paymentError = new PaymentError("m", "stripe", "CHARGE_FAILED");
const status: number | null = paymentError.status;
void status;

const notFound = new GatewayNotFoundError("venmo", ["stripe"]);
const supported: string[] = notFound.supportedGateways;
void supported;

const misconfigured = new ConfigurationError("bkash", ["appKey"]);
const missing: string[] = misconfigured.missingKeys;
void missing;

// --- negative cases: these must NOT compile ---

// @ts-expect-error — bKash fields are not valid on a Stripe charge.
void charge({ gateway: "stripe", amount: 1, currency: "usd", invoiceNumber: "INV" });

// @ts-expect-error — SSLCommerz requires the redirect URLs.
void charge({ gateway: "sslcommerz", amount: 1, transactionId: "T" });

// @ts-expect-error — "venmo" is not a supported gateway.
void charge({ gateway: "venmo", amount: 1, currency: "usd" });

// @ts-expect-error — bKash requires an invoiceNumber.
void charge({ gateway: "bkash", amount: 1 });

// @ts-expect-error — only bKash implements execute().
void execute({ gateway: "stripe", paymentID: "x" });

// @ts-expect-error — configure() rejects unknown gateway names.
void configure({ paypal: { apiKey: "x" } });
