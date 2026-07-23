# BDPayments

A unified payment gateway package for Node.js. One API for multiple payment providers.

[![Node Version](https://img.shields.io/badge/Node-18%2B-blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](https://opensource.org/licenses/MIT)

Supports **Stripe**, **SSLCommerz**, **bKash**, and **Nagad** through a single, consistent interface.

---

## 🚀 Installation

```bash
npm install bdpayments
```

Then install only the gateway SDKs you need:

```bash
# For Stripe
npm install stripe

# SSLCommerz, bKash and Nagad need no extra SDK — they use the REST API via fetch
```

## ⚡ Quick Start

### 1. Configure credentials (once at startup)

```javascript
import { configure } from 'bdpayments';

configure({
  stripe: {
    apiKey: process.env.STRIPE_API_KEY,
  },
  bkash: {
    appKey: process.env.BKASH_APP_KEY,
    appSecret: process.env.BKASH_APP_SECRET,
    username: process.env.BKASH_USERNAME,
    password: process.env.BKASH_PASSWORD,
    sandbox: true,
  },
});
```

Or skip `configure()` entirely and set environment variables — the package reads them automatically.

### 2. Charge

```javascript
import { charge } from 'bdpayments';

// Stripe
const stripeResult = await charge({
  gateway: 'stripe',
  amount: 1000,       // $10.00 in cents
  currency: 'usd',
  paymentMethod: 'pm_card_visa',
  confirm: true,
});

// bKash
const bkashResult = await charge({
  gateway: 'bkash',
  amount: 500,
  invoiceNumber: 'INV-001',
  callbackURL: 'https://example.com/callback',
});

// SSLCommerz
const sslResult = await charge({
  gateway: 'sslcommerz',
  amount: 1000,
  currency: 'BDT',
  transactionId: 'TXN-001',
  successUrl: 'https://example.com/success',
  failUrl: 'https://example.com/fail',
  cancelUrl: 'https://example.com/cancel',
});
```

### 3. Refund

```javascript
import { refund } from 'bdpayments';

const result = await refund({
  gateway: 'stripe',
  transactionId: 'pi_...',
  amount: 500,  // Partial refund
});
```

> **Check `result.success`.** A refund that the gateway accepts but has not completed
> (SSLCommerz `processing`, for example) returns `success: false` with the real status in
> `result.status`. A refund the gateway *rejected* throws a `PaymentError`.

### 4. Retrieve

```javascript
import { retrieve } from 'bdpayments';

// Retrieve Stripe payment details
const stripeResult = await retrieve({
  gateway: 'stripe',
  transactionId: 'pi_...',
});

// Validate SSLCommerz payment callback or IPN using validation ID
const sslcommerzResult = await retrieve({
  gateway: 'sslcommerz',
  valId: 'val_id_from_callback',
});

console.log(stripeResult.status);  // e.g. "succeeded"
console.log(sslcommerzResult.success); // true if validated successfully
```

### 5. Execute

```javascript
import { execute } from 'bdpayments';

// bKash (execute tokenized payment)
const result = await execute({
  gateway: 'bkash',
  paymentID: 'TR0011...',
});

console.log(result.status);  // e.g. "Completed"
```

## 🔐 Credentials Management

Three ways to provide API keys (highest priority wins):

| Priority | Method | Example |
|----------|--------|---------|
| 1 (highest) | Per-call options | `charge({ gateway: 'stripe', apiKey: 'sk_...', ... })` |
| 2 | Global `configure()` | `configure({ stripe: { apiKey: 'sk_...' } })` |
| 3 (lowest) | Environment variables | `STRIPE_API_KEY=sk_...` |

Only recognised credential and transport keys are read from per-call options — business fields
such as `amount` never end up in the credential object. Resolved credentials also redact
themselves when logged or `JSON.stringify`-ed.

### Environment Variables

| Gateway | Variables |
|---------|-----------|
| Stripe | `STRIPE_API_KEY` |
| SSLCommerz | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_SANDBOX` |
| bKash | `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`, `BKASH_SANDBOX` |
| Nagad | `NAGAD_MERCHANT_ID`, `NAGAD_PUBLIC_KEY`, `NAGAD_PRIVATE_KEY`, `NAGAD_SANDBOX`, `NAGAD_CLIENT_IP` |

## 🌐 Supported Gateways

| Gateway | Charge | Execute | Refund | Retrieve | Auth Method |
|---------|--------|---------|--------|----------|-------------|
| Stripe | ✅ PaymentIntents | ❌ | ✅ | ✅ | API Key |
| SSLCommerz | ✅ Session | ❌ | ✅ | ✅ | Store ID/Password |
| bKash | ✅ Tokenized | ✅ | ✅ | ✅ | Token Grant |
| Nagad | ✅ Checkout | ❌ | ✅ | ✅ | RSA Encrypted |

Query this at runtime with `getGatewayCapabilities('bkash')`.

## 🔁 Idempotency

Retrying a charge is only safe with an idempotency key. The mechanism differs per gateway:

| Gateway | Key | How |
|---------|-----|-----|
| Stripe | `idempotencyKey` option | Sent as Stripe's `Idempotency-Key` header |
| SSLCommerz | `transactionId` (`tran_id`) | Natural key — reuse it when retrying |
| bKash | `invoiceNumber` | Natural key — reuse it when retrying |
| Nagad | `orderId` | Natural key — reuse it when retrying |

```javascript
await charge({
  gateway: 'stripe',
  amount: 1000,
  currency: 'usd',
  idempotencyKey: `order-${orderId}`,
});
```

Requests time out after 30 seconds by default (`configure({ stripe: { timeoutMs: 10000 } })` to
change it). A timeout throws `PaymentError` with code `TIMEOUT` — the payment may still have
succeeded, so confirm with `retrieve()` rather than blindly retrying without a key.

## 🪝 Webhooks & Callbacks

```javascript
import { verifySslcommerzIpn, retrieve } from 'bdpayments';

app.post('/ipn/sslcommerz', async (req, res) => {
  if (!verifySslcommerzIpn(req.body)) return res.sendStatus(400);

  // Signature proves the payload is authentic; retrieve() confirms the status.
  const payment = await retrieve({ gateway: 'sslcommerz', valId: req.body.val_id });
  if (payment.success) await markOrderPaid(payment.transactionId);

  res.sendStatus(200);
});
```

Nagad callbacks carry no signature, so `parseNagadCallback()` normalizes them but always
reports `verified: false` — confirm with `retrieve()` before treating an order as paid.

## 📦 Response Format

All functions return a normalized response:

```javascript
{
  success: true,
  transactionId: 'pi_...',
  status: 'succeeded',
  amount: 1000,
  currency: 'usd',
  gatewayResponse: { /* raw gateway response */ },
}
```

## 🏗 Internal Architecture

BDPayments uses a centralized architecture for making gateway requests, adhering to SOLID and DRY principles:
- **`src/utils/http.js`**: Centralized `httpClient` wrapping the native `fetch` API, with timeouts and unified error mapping.
- **`src/utils/wrapper.js`**: Higher-order function `withErrorHandling` that maps gateway responses to unified `PaymentError` instances.
- **`src/utils/validate.js`**: Request validation shared by every adapter, so bad input fails before any network call.
- **`src/utils/crypto.js`**: Cryptographic functions (RSA, signatures) decoupled from specific gateway modules.
- **`src/utils/cache.js`**: Reset registry for auth-token and SDK-client caches, cleared by `clearConfig()`.

## 🛠 Error Handling

```javascript
import { charge, PaymentError, GatewayNotFoundError, ConfigurationError } from 'bdpayments';

try {
  await charge({ gateway: 'stripe', amount: 1000, currency: 'usd' });
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.log('Missing credentials:', error.missingKeys);
  } else if (error instanceof GatewayNotFoundError) {
    console.log('Try one of:', error.supportedGateways);
  } else if (error instanceof PaymentError) {
    console.log(`${error.gateway} error [${error.code}]: ${error.message}`);
    console.log('HTTP status:', error.status);       // null for non-HTTP failures
    console.log('Original error:', error.originalError);
  }
}
```

### Error codes

| Code | Meaning |
|------|---------|
| `CHARGE_FAILED` / `EXECUTE_FAILED` / `REFUND_FAILED` / `RETRIEVE_FAILED` | The gateway rejected the operation |
| `INVALID_REQUEST` / `INVALID_AMOUNT` | Bad input — thrown before any network call |
| `MISSING_CREDENTIALS` | Required credentials not found |
| `MISSING_DEPENDENCY` | An optional peer SDK (e.g. `stripe`) is not installed |
| `INVALID_CONFIG` | `configure()` was given an unknown gateway name |
| `GATEWAY_NOT_FOUND` | Unknown gateway name |
| `UNSUPPORTED_OPERATION` | The gateway does not implement that operation |
| `AUTH_FAILED` | Gateway authentication failed (e.g. bKash token grant) |
| `TIMEOUT` / `NETWORK_ERROR` | The request never completed |

## 📄 TypeScript

Full TypeScript definitions are included. Options are narrowed by gateway name, so fields
belonging to another gateway are rejected at compile time:

```typescript
import { charge } from 'bdpayments';

const result = await charge({
  gateway: 'stripe',
  amount: 1000,
  currency: 'usd',
  paymentMethod: 'pm_card_visa',
});

await charge({
  gateway: 'stripe',
  amount: 1000,
  currency: 'usd',
  invoiceNumber: 'INV-1',  // ❌ Error: bKash-only field
});
```

Use `extra` to pass anything the types don't model — it is forwarded to the gateway untouched.

## ⚠️ Nagad on older Node.js patch releases

Nagad's protocol requires RSA PKCS#1 v1.5, which Node.js **18.19.1, 20.11.1 and 21.6.2**
disabled for decryption (CVE-2023-46809). On those exact patch releases, Nagad `charge()`
fails while decrypting the initialization response. Upgrade to a later patch release.

## 🧪 Development

```bash
npm install
npm test          # unit tests, no network access required
npm run typecheck # type definitions
npm run check     # both
```

---

Released under the [MIT License](LICENSE). © 2024–2026 Sabbir Mahmud
