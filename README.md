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

# SSLCommerz — no extra SDK needed (uses REST API via fetch)

# bKash & Nagad — no extra SDK needed (uses REST API via fetch)
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

### 4. Retrieve

```javascript
import { retrieve } from 'bdpayments';

const result = await retrieve({
  gateway: 'stripe',
  transactionId: 'pi_...',
});

console.log(result.status);  // e.g. "succeeded"
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

### Environment Variables

| Gateway | Variables |
|---------|-----------|
| Stripe | `STRIPE_API_KEY` |
| SSLCommerz | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_SANDBOX` |
| bKash | `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`, `BKASH_SANDBOX` |
| Nagad | `NAGAD_MERCHANT_ID`, `NAGAD_PUBLIC_KEY`, `NAGAD_PRIVATE_KEY`, `NAGAD_SANDBOX` |

## 🌐 Supported Gateways

| Gateway | Charge | Execute | Refund | Retrieve | Auth Method |
|---------|--------|---------|--------|----------|-------------|
| Stripe | ✅ PaymentIntents | ❌ | ✅ | ✅ | API Key |
| SSLCommerz | ✅ Session | ❌ | ✅ | ✅ | Store ID/Password |
| bKash | ✅ Tokenized | ✅ | ✅ | ✅ | Token Grant |
| Nagad | ✅ Checkout | ❌ | ✅ | ✅ | RSA Encrypted |

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

## 🛠 Error Handling

```javascript
import { charge, PaymentError, GatewayNotFoundError, ConfigurationError } from 'bdpayments';

try {
  await charge({ gateway: 'stripe', amount: 1000 });
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.log('Missing credentials:', error.missingKeys);
  } else if (error instanceof GatewayNotFoundError) {
    console.log('Unknown gateway');
  } else if (error instanceof PaymentError) {
    console.log(`${error.gateway} error: ${error.message}`);
    console.log('Original error:', error.originalError);
  }
}
```

## 📄 TypeScript

Full TypeScript definitions are included. Options are narrowed by gateway name:

```typescript
import { charge, type StripeChargeOptions } from 'bdpayments';

// TypeScript knows exactly which fields are available
const result = await charge({
  gateway: 'stripe',
  amount: 1000,
  currency: 'usd',
  paymentMethod: 'pm_card_visa',
});
```

---

Released under the [MIT License](LICENSE). © 2024 Sabbir Mahmud
