# BDPayments — Code & Docs Audit + Fix Plan

> **STATUS: all 30 findings implemented in v1.1.0** (2026-07-23). See `CHANGELOG.md`.
> `npm run check` → 101 tests passing, typecheck clean, lockfile reproducible.
>
> Two items are **implemented but unverified against live gateways**, because that
> needs sandbox credentials this environment does not have:
> - **#2 / #23 (Nagad)** — the failure envelope (`reason` / `status: "Failed"`) and the
>   refund wire format come from the published spec, not observed traffic. The refund
>   still uses the raw-body + `X-KM-SIGNATURE` shape (now canonically signed) rather
>   than being migrated to the encrypted `sensitiveData` envelope, since guessing that
>   change unverified was more likely to break a working path than fix one.
> - **#1 / #21 (SSLCommerz)** — the refund response envelope and the `verify_sign`
>   MD5 chain are implemented from the documented algorithm.
>
> Confirm both against a merchant sandbox before releasing.

**Reviewed:** v1.0.3 @ `2a93d95` · Node v24.14.0 · 2026-07-23
**Scope:** `src/**`, `tests/**`, `docs/**`, `README.md`, `package.json`, `package-lock.json`

**Verdict:** the architecture (registry + lazy adapters + 3-tier config + normalized envelope) is sound. The
defects are concentrated in three places: **money-correctness** (a refund can report success when it failed),
**operational safety** (no timeouts, no token cache, no idempotency), and **leftover state from the removed
PayPal/Payoneer gateways** (stale lockfile, wrong error message, dead peer dep).

Every finding below was reproduced locally before being fixed. Headings now carry **✅ FIXED** with the
shipped location; ⚠️ inside a finding still means "verify against gateway docs/staging" and those callouts
survive the fix — see the STATUS banner for the two that remain unverified against live gateways.

---

## Severity summary

All 30 fixed in v1.1.0. "Fix landed" points at the code as it stands now — where that
differs from the snippet in the detailed finding below, the code is authoritative.

| # | Severity | Area | Issue | Fix landed | Guarded by |
|---|----------|------|-------|-----------|------------|
| 1 | 🔴 Critical | sslcommerz | Refund reports `success: true` for a **failed** refund | `sslcommerz.js:181` | `sslcommerz.test.js` — "throws when the refund failed, even though APIConnect is DONE" |
| 2 | 🔴 Critical | nagad | `refund()` / `retrieve()` never check for API errors — always `success: true` | `nagad.js:64` `assertNagadOk()` | `nagad.test.js` — "throws when Nagad reports a failure reason" |
| 3 | 🔴 Critical | build | `package-lock.json` is stale (v1.0.0, still pins `@paypal/paypal-server-sdk`) | lockfile regenerated @ 1.1.0 | CI `git diff --exit-code package-lock.json` |
| 4 | 🟠 High | http | No request timeout — a hung gateway hangs the caller forever | `http.js:29` | `http.test.js` — "actually aborts a slow request" |
| 5 | 🟠 High | sslcommerz | Missing required options silently become the literal string `"undefined"` | `validate.js:16` + all 12 adapter methods | `sslcommerz.test.js` — "rejects missing URLs instead of sending the string 'undefined'" |
| 6 | 🟠 High | bkash | `grantToken()` on every call — no token cache, 4 extra round-trips per flow | `bkash.js:104` `getToken()` | `bkash.test.js` — "reuses a cached token", "de-duplicates concurrent token grants" |
| 7 | 🟠 High | types | `execute()` missing from `index.d.ts` — TS build error for documented API | `index.d.ts:359` | `types.check.ts` via `npm run typecheck` |
| 8 | 🟠 High | all | No idempotency-key support anywhere → double-charge on retry | `stripe.js:51`; natural keys documented per gateway | `types.check.ts` (Stripe); README table |
| 9 | 🟠 High | nagad | Timestamp is UTC; Nagad expects Bangladesh local time (GMT+6) | `crypto.js:12` | `nagad.test.js` — "sends the Bangladesh-local timestamp, not UTC" |
| 10 | 🟡 Medium | errors | `GatewayNotFoundError` advertises `paypal, payoneer` — not supported | `errors.js:34` | `smoke.test.js` — "should only advertise gateways that actually exist" |
| 11 | 🟡 Medium | config | `resolveConfig()` merges the *entire* options object into credentials | `config.js:58` `CONFIG_KEYS` | `config.test.js` — "does not copy business options into the credential object" |
| 12 | 🟡 Medium | bkash | Token accepted when `id_token` is absent → `Authorization: undefined` | `bkash.js:85` | `bkash.test.js` — "fails when the grant returns 200 with no id_token" |
| 13 | 🟡 Medium | bkash | `String(amount)` can emit `"0.30000000000000004"` | `validate.js:92` `formatAmount()` | `bkash.test.js` + `sslcommerz.test.js` — "…to two decimals" |
| 14 | 🟡 Medium | stripe | New SDK client per call + dead code branch + opaque missing-peer error | `stripe.js:33` | `stripe.test.js` (validation paths); client cache is structural |
| 15 | 🟡 Medium | pkg | `sslcommerz-lts` peer dep declared but never imported | `package.json` peerDeps | — |
| 16 | 🟡 Medium | pkg | No `files` / `exports` — `docs/`, `tests/`, `notes/` get published | `package.json` `files`/`exports` | CI `npm pack --dry-run` leak check |
| 17 | 🟡 Medium | index | `execute()` throws a bare `Error`, not a `PaymentError` | `index.js:23` `getOperation()` | `smoke.test.js` — "execute() should throw a PaymentError for gateways without it" |
| 18 | 🟡 Medium | http | HTTP status code dropped from the thrown error | `http.js:70` | `http.test.js` — "attaches the HTTP status to the thrown error" |
| 19 | 🟡 Medium | nagad | Sandbox base URL is plaintext `http://` | `nagad.js:29` `baseUrl` override | `nagad.test.js` — "honours a baseUrl override" |
| 20 | 🟡 Medium | types | `RetrieveResult.transactionId: string` but runtime can return `null` | `index.d.ts:298` | `types.check.ts` assigns to `string \| null` |
| 21 | 🟡 Medium | security | No webhook / IPN signature verification helpers | `webhooks.js:38` | `webhooks.test.js` — 10 tests incl. tamper/forgery |
| 22 | 🟢 Low | nagad | `X-KM-IP-V4` hardcoded to `127.0.0.1` | `nagad.js:47` | `nagad.test.js` — "uses the configured client IP header" |
| 23 | 🟢 Low | nagad | Refund signs `JSON.stringify(body)` incl. `...extra` — key-order fragile | `nagad.js:228` | `nagad.test.js` — "signs a canonical payload and sends extras outside it" (verifies the RSA signature) |
| 24 | 🟢 Low | config | `configure()` silently ignores unknown gateway names (typos) | `config.js:111` | `config.test.js` — "rejects unknown gateway names" |
| 25 | 🟢 Low | tests | "should load all **6** gateway adapters" (there are 4) + dead variable | `smoke.test.js` rewritten | — |
| 26 | 🟢 Low | tests | Zero adapter coverage — no mocked HTTP, no error-path tests | `tests/gateways/*`, `tests/helpers/mock-fetch.js` | 19 → 101 tests |
| 27 | 🟢 Low | docs | README/site claim TS rejects cross-gateway fields — index signature allows them | index signature dropped from per-gateway option types | `types.check.ts` — 6 `@ts-expect-error` cases |
| 28 | 🟢 Low | docs | README contradicts `package.json` on `sslcommerz-lts`; `© 2024` stale | `README.md`, `docs/index.html` | — |
| 29 | 🟢 Low | repo | Dead whitespace gaps in `config.js` / `index.d.ts` from removed gateways | both files rewritten | — |
| 30 | ⚠️ Watch | nagad | RSA PKCS#1 v1.5 `privateDecrypt` blocked on Node 18.19.x / 20.11.x / 21.6.x | decrypt failure now names the CVE; README caveat | `nagad.test.js` — "explains a PKCS#1 decrypt failure" |

**Not covered by an automated test:** #15, #16 (#16 has a CI check but no unit test), #25,
#28, #29 — all metadata or documentation changes with nothing meaningful to assert. #14's
client-cache and #8's natural-key documentation are likewise structural rather than tested.

---

## Detailed findings

### 1. 🔴 SSLCommerz refund reports success on failure — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/sslcommerz.js:181` — rejected refunds throw; `processing` returns `success: false`.

`src/gateways/sslcommerz.js:149`

```js
success: result.status === "success" || result.APIConnect === "DONE",
```

`APIConnect: "DONE"` only means *the API call was reachable*. SSLCommerz returns `APIConnect: "DONE"` together
with `status: "failed"`. The `||` therefore reports **`success: true` on a refund that did not happen** — the
single most damaging class of bug in a payments library (merchant marks the order refunded, money never moves).

**Fix**

```js
const status = String(result.status || "").toLowerCase();
const connected = result.APIConnect === "DONE";

if (!connected) {
  throw new PaymentError(
    result.errorReason || "SSLCommerz refund API unreachable",
    "sslcommerz", "REFUND_FAILED", result
  );
}
if (status === "failed") {
  throw new PaymentError(
    result.errorReason || "SSLCommerz refund failed",
    "sslcommerz", "REFUND_FAILED", result
  );
}

return {
  success: status === "success",   // "processing" ⇒ success:false, status preserved
  refundId: result.refund_ref_id || null,
  ...
};
```

Also surface `result.trans_id` / `result.bank_tran_id` in the result so callers can reconcile.

---

### 2. 🔴 Nagad refund/retrieve never detect failures — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/nagad.js:64` — `assertNagadOk()` applied to charge (both steps), refund and retrieve.

`src/gateways/nagad.js:190-215` and `:230-253`

`charge()` correctly checks `initResult.reason` / `completeResult.reason`, but `refund()` and `retrieve()`
return `success: true` unconditionally as long as the HTTP status is 2xx. Nagad returns `200 OK` with
`{ reason, message }` for business failures, so both hardcode a lie.

**Fix** — extract the check `charge()` already performs and apply it uniformly:

```js
function assertNagadOk(result, code) {
  if (result?.reason || result?.status === "Failed" || result?.statusCode === "false") {
    throw new PaymentError(
      result.message || result.reason || "Nagad request failed",
      "nagad", code, result
    );
  }
  return result;
}
```

Call it in `charge` (both steps), `refund` (`REFUND_FAILED`) and `retrieve` (`RETRIEVE_FAILED`). Then derive
`success` from the payload instead of hardcoding — e.g. `success: result.status === "Success"`.

⚠️ Confirm the exact failure envelope against current Nagad merchant docs; the field set has changed between
API versions (`v-0.2.0` is pinned in the headers).

---

### 3. 🔴 `package-lock.json` is stale and out of sync — ✅ FIXED

> **Fixed in v1.1.0.** Lockfile regenerated at 1.1.0; PayPal/apimatic/axios tree gone. CI fails on drift.

```
lockfile name/version: bdpayments@1.0.0     package.json: 1.0.3
lockfile peerDependencies: @paypal/paypal-server-sdk ^2.0.0, sslcommerz-lts, stripe ^17.0.0
package.json peerDependencies: sslcommerz-lts, stripe *
```

`npm ci` currently installs the PayPal SDK, `axios` and the whole `@apimatic/*` tree for a package that imports
none of them, and the version/peer ranges disagree with `package.json`. Any CI built on `npm ci` reproduces a
dependency graph that no longer matches the source.

**Fix**

```bash
rm -rf node_modules package-lock.json
npm install
npm ci && npm test   # verify
```

Commit the regenerated lock. Add a CI guard (`npm ci` + `git diff --exit-code package-lock.json`).

---

### 4. 🟠 No HTTP timeout — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils/http.js:29` — 30s default, per-gateway `timeoutMs`, `TIMEOUT`/`NETWORK_ERROR` codes.

`src/utils/http.js:14` — `await fetch(url, options)` with no `AbortSignal`. Node's fetch has **no default
timeout**. A stalled bKash token grant or SSLCommerz session-init blocks the request handler indefinitely.

**Fix** — add timeout + one bounded retry for idempotent-safe failures:

```js
export async function httpClient(url, options, gateway, defaultErrorCode, { timeoutMs = 30_000 } = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new PaymentError(
      error.name === "TimeoutError"
        ? `${gateway} request timed out after ${timeoutMs}ms`
        : `${gateway} network request failed: ${error.message}`,
      gateway,
      error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
      error
    );
  }
  ...
}
```

Make `timeoutMs` overridable per gateway via config (`configure({ bkash: { timeoutMs: 15000 } })`).
Never auto-retry non-idempotent `charge`/`refund` calls without an idempotency key (see #8).

---

### 5. 🟠 SSLCommerz sends the string `"undefined"` for missing required fields — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils/validate.js` — wired into all 12 adapter methods per the table above.

`src/gateways/sslcommerz.js:45-65`. Reproduced:

```
new URLSearchParams({ tran_id: undefined, success_url: undefined }).toString()
→ "tran_id=undefined&success_url=undefined"
```

`transactionId`, `successUrl`, `failUrl`, `cancelUrl` are all required and all unguarded. A caller who forgets
one gets a live SSLCommerz session pointing at `https://undefined` instead of a clear error. Same class of
problem: `bkash.merchantInvoiceNumber` (dropped from JSON when `undefined`) and `nagad.orderId` (interpolated
into the URL path as `.../initialize/MERCHANT/undefined`).

**Fix** — a shared validator run before any network call:

```js
// src/utils/validate.js
export function requireOptions(gateway, options, keys) {
  const missing = keys.filter((k) => options[k] === undefined || options[k] === null || options[k] === "");
  if (missing.length) {
    throw new PaymentError(
      `Missing required option(s) for ${gateway}: ${missing.join(", ")}`,
      gateway, "INVALID_REQUEST"
    );
  }
}

export function requireAmount(gateway, amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new PaymentError(
      `Invalid amount for ${gateway}: expected a positive finite number, got ${amount}`,
      gateway, "INVALID_AMOUNT"
    );
  }
}
```

Wire per adapter:

| Adapter | Required |
|---|---|
| sslcommerz.charge | `amount`, `transactionId`, `successUrl`, `failUrl`, `cancelUrl` |
| sslcommerz.refund | `amount`, `transactionId` |
| sslcommerz.retrieve | `transactionId` **or** `valId` |
| bkash.charge | `amount`, `invoiceNumber` |
| bkash.execute | `paymentID` |
| bkash.refund | `amount`, `transactionId`, `trxID` |
| nagad.charge | `amount`, `orderId` |
| nagad.refund / retrieve | `transactionId` |
| stripe.charge | `amount`, `currency` |
| stripe.refund / retrieve | `transactionId` |

---

### 6. 🟠 bKash re-grants a token on every operation — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/bkash.js:104` — TTL cache, in-flight de-dup, retry-on-401. Note: the shipped `getToken()` also clears the stale token on a forced refresh, which the snippet below omits.

`src/gateways/bkash.js:100, 151, 195, 244` — every `charge`/`execute`/`refund`/`retrieve` calls `grantToken()`
first. A normal checkout (create → execute) therefore burns 4 HTTP calls instead of 2 (or 3 with one cached
token). bKash tokens live ~1 hour, `refresh_token` is returned and thrown away, and bKash rate-limits the grant
endpoint — under load this becomes the failure mode.

**Fix** — module-level cache keyed by credentials, with a safety margin and in-flight de-duplication:

```js
const tokenCache = new Map(); // key -> { token, expiresAt, inflight }

function cacheKey(config) {
  return `${config.sandbox ? "sbx" : "live"}:${config.appKey}:${config.username}`;
}

async function getToken(config) {
  const key = cacheKey(config);
  const entry = tokenCache.get(key);
  if (entry?.token && Date.now() < entry.expiresAt) return entry.token;
  if (entry?.inflight) return entry.inflight;              // de-dupe concurrent grants

  const inflight = grantToken(config).then((data) => {
    const ttlMs = (Number(data.expires_in) || 3600) * 1000;
    tokenCache.set(key, { token: data.id_token, expiresAt: Date.now() + ttlMs - 60_000 });
    return data.id_token;
  }).catch((err) => { tokenCache.delete(key); throw err; });

  tokenCache.set(key, { ...entry, inflight });
  return inflight;
}
```

`grantToken` must return the whole payload (for `expires_in` / `refresh_token`), not just `id_token`.
On a `401`/`2001` from a business call, invalidate the cache entry and retry the call once.
Export a `clearTokenCache()` for tests, and clear it from `clearConfig()`.

---

### 7. 🟠 `execute()` is missing from the type definitions — ✅ FIXED

> **Fixed in v1.1.0.** `src/index.d.ts:359` plus `BkashExecuteOptions`/`ExecuteOptions`.

`src/index.js:90` exports `execute`, README §5 and the docs site both document it — but `src/index.d.ts` has no
declaration. Reproduced:

```
error TS2305: Module 'bdpayments' has no exported member 'execute'.
```

Every TypeScript consumer following the documented bKash flow fails to compile.

**Fix** — add to `index.d.ts`:

```ts
export interface BkashExecuteOptions {
  gateway: "bkash";
  paymentID: string;
  appKey?: string;
  appSecret?: string;
  username?: string;
  password?: string;
  sandbox?: boolean;
  extra?: Record<string, any>;
  [key: string]: any;
}

export type ExecuteOptions = BkashExecuteOptions;

/** Execute a payment (e.g. bKash tokenized checkout). */
export function execute(options: ExecuteOptions): Promise<PaymentResult>;
```

Add a `tests/types.test.ts` compiled by `tsc --noEmit` in CI so a missing export fails the build.

---

### 8. 🟠 No idempotency support — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/stripe.js:51` forwards `idempotencyKey`; natural keys documented per gateway in the README.

Neither the public API nor any adapter accepts an idempotency key. Combined with #4 (timeouts) this is the
double-charge path: caller times out, retries, charges twice.

**Fix** — accept `options.idempotencyKey` at the top level and map it per gateway:

- **Stripe**: `stripe.paymentIntents.create(params, { idempotencyKey })` (second arg), same for `refunds.create`.
- **bKash**: `merchantInvoiceNumber` already acts as the natural key — document it and reject duplicates upstream.
- **SSLCommerz**: `tran_id` is the natural key — document that re-using it is safe.
- **Nagad**: `orderId` is the natural key.

Document the guarantee per gateway in the README rather than pretending it is uniform.

---

### 9. 🟠 Nagad timestamp is UTC, not Bangladesh time — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils/crypto.js:12` — `getTimestamp(offsetHours = 6)`.

`src/utils/crypto.js:8-14` builds `yyyyMMddHHmmss` from `toISOString()` (UTC). Nagad's spec expects
Bangladesh local time (UTC+6). Reproduced: `20260723075353` (UTC) vs `20260723135353` (BD) — a 6-hour skew,
which Nagad rejects as a stale/future request.

**Fix**

```js
/** Nagad expects Bangladesh local time (UTC+6) as yyyyMMddHHmmss. */
export function getTimestamp(offsetHours = 6) {
  return new Date(Date.now() + offsetHours * 3_600_000)
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
}
```

Add a unit test pinning the output against a fixed `Date.now()`. ⚠️ Confirm the expected zone against the
current Nagad integration doc before shipping.

---

### 10. 🟡 `GatewayNotFoundError` advertises gateways that don't exist — ✅ FIXED

> **Fixed in v1.1.0.** `src/errors.js:34` — list passed in by the registry, exposed as `supportedGateways`.

`src/errors.js:29`

```js
`... Supported gateways: stripe, paypal, payoneer, sslcommerz, bkash, nagad.`
```

PayPal and Payoneer were removed; the error tells users to try gateways that will throw the same error.

**Fix** — derive the list at throw time so it can never drift:

```js
// errors.js — accept the list, don't hardcode it
constructor(gatewayName, supported = []) {
  super(
    `Gateway "${gatewayName}" is not supported.` +
      (supported.length ? ` Supported gateways: ${supported.join(", ")}.` : ""),
    gatewayName, "GATEWAY_NOT_FOUND"
  );
  this.name = "GatewayNotFoundError";
  this.supportedGateways = supported;
}

// gateways/index.js
throw new GatewayNotFoundError(name, getSupportedGateways());
```

Keep the second parameter optional so the existing `new GatewayNotFoundError("foobar")` test still passes.

---

### 11. 🟡 `resolveConfig()` merges business options into credentials — ✅ FIXED

> **Fixed in v1.1.0.** `src/config.js:58` — `CONFIG_KEYS` allow-list, plus the redacting `toJSON`/inspect hooks at `:187`.

`src/config.js:115` — `{ ...envConfig, ...globalCfg, ...callOptions }`. Reproduced:

```
resolveConfig("stripe", { apiKey, amount: 1000, currency: "usd", extra: { a: 1 } })
→ { apiKey, amount: 1000, currency: "usd", extra: { a: 1 }, sandbox: false }
```

Two consequences: (a) a business field named like a credential silently overrides the configured credential;
(b) the `config` object passed to adapters — and captured in `PaymentError.originalError` on some paths — is
wider than intended, which matters for anything that logs it.

**Fix** — only lift *known credential keys* out of the call options:

```js
const CONFIG_KEYS = {
  stripe: ["apiKey", "timeoutMs"],
  sslcommerz: ["storeId", "storePassword", "sandbox", "timeoutMs"],
  bkash: ["appKey", "appSecret", "username", "password", "sandbox", "timeoutMs"],
  nagad: ["merchantId", "publicKey", "privateKey", "sandbox", "timeoutMs", "clientIp"],
};

export function resolveConfig(gatewayName, callOptions = {}) {
  const allowed = CONFIG_KEYS[gatewayName] || [];
  const overrides = Object.fromEntries(
    allowed.filter((k) => callOptions[k] !== undefined).map((k) => [k, callOptions[k]])
  );
  const merged = { ...readEnvConfig(gatewayName), ...(globalConfig.get(gatewayName) || {}), ...overrides };
  ...
}
```

Related hygiene: add a non-enumerable `toJSON()`/`Symbol.for('nodejs.util.inspect.custom')` on the resolved
config that redacts `apiKey`, `storePassword`, `appSecret`, `password`, `privateKey`, so a stray
`console.log(err)` cannot dump live credentials.

---

### 12. 🟡 bKash token accepted when absent — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/bkash.js:85` — grant now also asserts `id_token`.

`src/gateways/bkash.js:45-54` — the guard is `if (data.statusCode && data.statusCode !== "0000")`. If bKash
returns 200 with neither `statusCode` nor `id_token`, `grantToken` returns `undefined` and every later call
sends `Authorization: undefined`, producing a confusing downstream error instead of `AUTH_FAILED`.

**Fix**

```js
if ((data.statusCode && data.statusCode !== "0000") || !data.id_token) {
  throw new PaymentError(
    data.statusMessage || "bKash token grant failed", "bkash", "AUTH_FAILED", data
  );
}
```

The same `statusCode &&` short-circuit pattern is repeated at `:120`, `:160`, `:213`, `:253` — it is correct
there (a missing `statusCode` on a success response is normal), but each should additionally assert the field
it goes on to read (`result.paymentID`, `result.trxID`, `result.refundTrxID`).

---

### 13. 🟡 bKash amount formatting — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils/validate.js:92` — `formatAmount()` used by bKash, SSLCommerz and Nagad.

`String(options.amount)` → `String(0.1 + 0.2)` = `"0.30000000000000004"`, which bKash rejects. bKash expects a
decimal string with at most 2 places.

**Fix:** `amount: Number(options.amount).toFixed(2)` in `charge` and `refund`. Do the same for SSLCommerz
`total_amount` / `refund_amount` and Nagad `amount`. (Stripe is integer minor units — leave as is, but validate
`Number.isInteger(amount)` there.)

---

### 14. 🟡 Stripe client construction — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/stripe.js:33` — client cache keyed by API key, `MISSING_DEPENDENCY`, dead branch removed.

`src/gateways/stripe.js:9-21`

```js
const Stripe = (import("stripe"));
return Stripe.then ? Stripe.then((m) => new (m.default || m)(config.apiKey)) : new Stripe(config.apiKey);
```

It works (verified against a live 401 from Stripe), but:
- `import()` **always** returns a promise, so the `: new Stripe(...)` branch is dead code.
- A brand-new `Stripe` instance is constructed on every single call — new HTTP agent, no connection reuse.
- If the `stripe` peer dep isn't installed, `ERR_MODULE_NOT_FOUND` is wrapped as `CHARGE_FAILED`, which reads
  as "the payment failed" rather than "you forgot to `npm install stripe`".
- The `@type {any}` / eslint-disable scaffolding is noise (there is no eslint config in the repo).

**Fix**

```js
const clients = new Map();

async function createClient(config) {
  const cached = clients.get(config.apiKey);
  if (cached) return cached;

  let mod;
  try {
    mod = await import("stripe");
  } catch (error) {
    throw new PaymentError(
      'The "stripe" peer dependency is not installed. Run: npm install stripe',
      "stripe", "MISSING_DEPENDENCY", error
    );
  }
  const Stripe = mod.default || mod;
  const client = new Stripe(config.apiKey, { maxNetworkRetries: 2 });
  clients.set(config.apiKey, client);
  return client;
}
```

Clear `clients` from `clearConfig()` so tests don't leak instances.

---

### 15/16. 🟡 Package metadata — ✅ FIXED

> **Fixed in v1.1.0.** `sslcommerz-lts` dropped, `stripe` narrowed to `>=12`, `files`/`exports`/`sideEffects` added.

- **`sslcommerz-lts`** appears in `peerDependencies`, `peerDependenciesMeta` and `devDependencies` but is
  imported nowhere (`grep` over `src/` + `tests/` finds zero references — the adapter uses raw `fetch`). The
  README even says "SSLCommerz — no extra SDK needed". Remove it from all three places.
- **`stripe: "*"`** is too permissive for a peer range. Use `">=12"` (the versions where `default` is the
  constructor, which `createClient` relies on).
- **No `files` field and no `exports` map** → `docs/` (952-line HTML + CSS), `tests/` and `notes/` ship to npm,
  and every internal module is importable as a public entry point.

```jsonc
"files": ["src"],
"exports": {
  ".": { "types": "./src/index.d.ts", "import": "./src/index.js", "default": "./src/index.js" },
  "./package.json": "./package.json"
},
"sideEffects": false
```

---

### 17-20. 🟡 Consistency fixes — ✅ FIXED

> **Fixed in v1.1.0.** `src/index.js:23`, `src/utils/http.js:70`, `src/gateways/nagad.js:29`, `src/index.d.ts:298`.

- **`src/index.js:93`** — `throw new Error(...)` for an unsupported `execute()`. Should be
  `new PaymentError(\`Gateway "${gateway}" does not support execute()\`, gateway, "UNSUPPORTED_OPERATION")`
  so callers' `instanceof PaymentError` branch catches it. Consider generalising: a
  `assertCapability(adapter, gateway, "execute")` helper, and expose
  `getGatewayCapabilities(name) → { charge, execute, refund, retrieve }`.
- **`src/utils/http.js:35`** — the thrown `PaymentError` drops `response.status`. Attach `status` (and
  ideally the request URL, path only) to the error so callers can distinguish 4xx from 5xx:
  `error.status = response.status`. Also add `{ cause: error }` when wrapping network failures.
- **`src/gateways/nagad.js:20`** — sandbox base URL is `http://sandbox.mynagad.com:10080/...`. Even though the
  payload is RSA-encrypted, headers and the merchant/order IDs in the path travel in cleartext. Prefer HTTPS
  if Nagad's sandbox supports it; if not, document the limitation explicitly and warn once at runtime.
- **`src/index.d.ts:248`** — `RetrieveResult.transactionId: string` but `sslcommerz.retrieve` can return
  `null` (`element.tran_id || options.transactionId || null`). Same for `RefundResult.amount: number | null`
  vs SSLCommerz returning `options.amount` (possibly `undefined`). Align the types with runtime:
  `transactionId: string | null`, `amount: number | null`.

---

### 21. 🟡 No webhook / IPN verification — ✅ FIXED

> **Fixed in v1.1.0.** `src/webhooks.js` — `verifySslcommerzIpn()` (constant-time) and `parseNagadCallback()`.

A payment library whose users must handle SSLCommerz IPN, bKash callbacks and Nagad callbacks provides no way
to verify them. Today the docs steer users to `retrieve({ valId })` for SSLCommerz — that's a legitimate
server-to-server validation and is the right primary recommendation, but it doesn't cover:

- SSLCommerz IPN hash verification (`verify_sign` / `verify_key` + `store_passwd` MD5 chain).
- Constant-time comparison of any of it (`crypto.timingSafeEqual`).

**Proposal** — a new `src/webhooks.js`:

```js
export function verifySslcommerzIpn(payload, config): boolean
export function parseNagadCallback(query): { orderId, paymentRefId, status }
```

Keep it additive and clearly documented as "verification, not a substitute for `retrieve()`".

---

### 22-24. 🟢 Smaller code issues — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/nagad.js:47` and `:228`, `src/config.js:111`.

- **`nagad.js:59, 123, 197, 237`** — `X-KM-IP-V4: "127.0.0.1"` hardcoded. Nagad validates the merchant IP in
  some configurations. Make it `config.clientIp || "127.0.0.1"`, resolved via `NAGAD_CLIENT_IP`.
- **`nagad.js:185-188`** — the refund signature is computed over `JSON.stringify(refundBody)` *including*
  `...options.extra`, so the signed bytes depend on JS key insertion order and on caller-supplied extras.
  Build a canonical, fixed-key payload, sign that, and send `extra` outside the signed envelope.
  ⚠️ Nagad's documented refund flow uses an encrypted `sensitiveData` envelope like `charge` does, not a raw
  body plus `X-KM-SIGNATURE` — re-verify this whole method against the current spec.
- **`config.js:62-66`** — `configure({ strip: {...} })` (typo) is silently accepted and the credentials are
  never found. Validate keys against `ENV_MAP` and throw a `ConfigurationError` listing the valid names.

---

### 25-26. 🟢 Tests — ✅ FIXED

> **Fixed in v1.1.0.** `smoke.test.js` rewritten; `tests/gateways/*` + `tests/helpers/mock-fetch.js` added. 19 → 101 tests.

`tests/smoke.test.js` passes (19/19) but:

- `:42` — `"should load all 6 gateway adapters"` iterates a 4-element array. Stale title from the PayPal era.
- `:165` — `const { ConfigurationError } = configModule;` is `undefined` and unused (the config module does not
  re-export it). Dead line.
- The env-var test at `:146` mutates `process.env` and relies on `beforeEach` ordering; it happens to work, but
  the global `Map` in `config.js` plus the module-level gateway/token caches make cross-test leakage likely as
  soon as more tests are added.
- **Zero adapter coverage.** No test exercises request building, response normalization, or any error path for
  the four gateways — i.e. none of bugs #1, #2, #5, #12, #13 would be caught today.

**Plan:** add `tests/gateways/*.test.js` using `node:test`'s `mock.method(globalThis, "fetch")` so adapters can
be tested with zero network. Minimum matrix per gateway: happy path, gateway-level business failure,
non-2xx HTTP, malformed/empty body, missing-required-option. Plus `tests/types.test.ts` via `tsc --noEmit`.
Target: every normalization branch and every `throw new PaymentError` site executed at least once.

---

### 27-29. 🟢 Documentation defects — ✅ FIXED

> **Fixed in v1.1.0.** Index signature dropped from per-gateway option types (making the docs' claim true), README/site corrected.

- **README:202-216 and `docs/index.html` (TypeScript section)** claim *"TS will error if you add
  bkash-specific fields here"* / *"TypeScript knows exactly which fields are available"*. False:
  `BaseChargeOptions` has `[key: string]: any` (`index.d.ts:72`), which defeats excess-property checking
  entirely. Either drop the index signature from the specific option types (keeping it only on an explicit
  escape hatch like `extra`), or correct the claim. Dropping it is the better fix and is what the docs promise.
- **README:18-27** says "SSLCommerz — no extra SDK needed", but `package.json` declares `sslcommerz-lts` as a
  peer dependency — npm will warn users about a package they must not install. Resolved by #15.
- **README:220** — `© 2024`, while the package is at v1.0.3 in 2026.
- **`docs/index.html`** — the site is otherwise accurate against the code (env-var names, capability matrix,
  the `execute` section, the `valId` retrieve flow all match). Only the TypeScript claim needs correcting.
  Note the site depends on Google Fonts and a `lucide` script; if `docs/` is meant to be offline-viewable,
  vendor those.
- **`src/config.js:16-18`, `:45`, `src/index.d.ts:19-22, 84-88, 156-160`** — orphaned blank-line gaps where the
  PayPal/Payoneer blocks were deleted. Cosmetic, but they are the fingerprint of an incomplete removal, which
  is exactly what bugs #3 and #10 turned out to be.

---

### 30. ⚠️ Node compatibility watch item — ✅ ADDRESSED

> **Addressed in v1.1.0**, not fixed — there is nothing to fix. PKCS#1 v1.5 is what Nagad's protocol
> requires and it round-trips fine on Node v24.14.0 (verified). The decrypt failure at
> `src/gateways/nagad.js` now names the CVE and the affected patch releases, and the README carries the
> caveat, so a user on 18.19.1 / 20.11.1 / 21.6.2 gets an actionable message instead of a bare OpenSSL error.

`src/utils/crypto.js` uses `RSA_PKCS1_PADDING` for `publicEncrypt`/`privateDecrypt`. Verified working on
**Node v24.14.0** (round-trip test passed). However, the CVE-2023-46809 mitigation disabled PKCS#1 v1.5
`privateDecrypt` in Node **18.19.1, 20.11.1 and 21.6.2**; `package.json` declares `engines: node >= 18`, so
users on those specific patch releases will see `ERR_OSSL_RSA_PKCS_DECODING_ERROR` on every Nagad `charge()`.

**Action:** don't change the padding (Nagad's protocol requires PKCS#1 v1.5). Instead catch the decrypt failure
in `nagad.charge()` and add a Node-version hint to the error message, and note the affected range in the
README's Nagad section.

---

## Execution plan

### Phase 1 — Correctness & release hygiene (ship as `1.1.0`)
1. Fix SSLCommerz refund success logic (#1) — **do this first, it is the money bug**.
2. Add `assertNagadOk()` to Nagad refund/retrieve (#2).
3. Regenerate `package-lock.json`; drop `sslcommerz-lts`; tighten `stripe` peer range; add `files`/`exports` (#3, #15, #16).
4. Add `execute` + `BkashExecuteOptions` to `index.d.ts`; fix nullable result types (#7, #20).
5. Fix `GatewayNotFoundError` message (#10).
6. Fix bKash `id_token` guard (#12) and amount formatting (#13).

*Exit criteria:* `npm ci && npm test && tsc --noEmit` clean; no reference to paypal/payoneer anywhere in the repo.

### Phase 2 — Robustness
7. `src/utils/validate.js` + wire required-option / amount checks into all 12 adapter methods (#5).
8. `httpClient` timeout, `status` on errors, `cause` propagation (#4, #18).
9. bKash token cache with TTL, in-flight de-dup and 401 invalidation (#6).
10. Stripe client cache + `MISSING_DEPENDENCY` error + drop dead branch (#14).
11. Nagad timestamp zone fix + configurable client IP (#9, #22).
12. `PaymentError` for unsupported `execute()`; `getGatewayCapabilities()` (#17).

*Exit criteria:* adapter test suite (mocked `fetch`) green, covering every `throw` site.

### Phase 3 — Security & API surface
13. Scoped credential resolution + redacting `toJSON` on resolved config (#11).
14. `configure()` validates gateway names (#24).
15. Idempotency key plumbing, per-gateway (#8).
16. `src/webhooks.js` — SSLCommerz IPN verification, Nagad callback parsing (#21).
17. Nagad refund envelope re-verification against current spec (#23) and sandbox HTTPS (#19).

### Phase 4 — Tests, CI, docs
18. `tests/gateways/*.test.js` with mocked `fetch`; `tests/config.test.js` isolation; `tests/types.test.ts`.
19. Fix stale test title + dead variable (#25).
20. GitHub Actions: matrix Node 18/20/22/24 → `npm ci`, `npm test`, `tsc --noEmit`, lockfile-drift check.
21. Docs: correct the TypeScript claim, remove the `sslcommerz-lts` contradiction, update the copyright,
    document idempotency semantics and the Node 18.19.x Nagad caveat (#27, #28, #30).
22. Clean the orphaned whitespace in `config.js` / `index.d.ts` (#29). Add `CHANGELOG.md`.

---

## Suggested commit sequence

```
fix(sslcommerz): do not report success when a refund fails
fix(nagad): detect business failures in refund() and retrieve()
chore(deps): regenerate lockfile, drop unused sslcommerz-lts peer dep
fix(types): export execute() and correct nullable result fields
fix(errors): derive supported-gateway list instead of hardcoding it
fix(bkash): require id_token and format amounts to 2 decimals
feat(validation): reject missing required options before any network call
feat(http): add request timeouts and surface HTTP status on errors
perf(bkash): cache auth tokens with TTL and in-flight de-duplication
perf(stripe): reuse SDK clients and report a missing peer dep clearly
fix(nagad): use Bangladesh local time for request timestamps
refactor(config): resolve only known credential keys; redact on inspect
feat(idempotency): thread idempotency keys through to each gateway
feat(webhooks): SSLCommerz IPN verification helper
test: adapter coverage with mocked fetch; type-definition test
ci: node matrix, tsc --noEmit, lockfile drift check
docs: correct TypeScript narrowing claim and peer-dependency guidance
```

---

## What actually shipped

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — Correctness & release hygiene | ✅ | Findings #1, #2, #3, #7, #10, #12, #13, #15, #16, #20 |
| 2 — Robustness | ✅ | Findings #4, #5, #6, #9, #14, #17, #18, #22 |
| 3 — Security & API surface | ✅ | Findings #8, #11, #19, #21, #23, #24 |
| 4 — Tests, CI, docs | ✅ | Findings #25, #26, #27, #28, #29, #30 |

**New files:** `src/utils/validate.js`, `src/utils/cache.js`, `src/webhooks.js`,
`tsconfig.json`, `CHANGELOG.md`, `.github/workflows/ci.yml`,
`tests/helpers/mock-fetch.js`, `tests/gateways/{stripe,sslcommerz,bkash,nagad}.test.js`,
`tests/{config,http,webhooks}.test.js`, `tests/types.check.ts`.

**Test coverage:** 19 → 101 tests. Every `throw new PaymentError` site in the adapters is
exercised, and the three money-correctness regressions have named tests that fail against
the 1.0.3 logic (verified by replaying the old expressions against the fixtures).

**Verification performed:**

```
npm run check          # 101 pass, 0 fail; tsc --noEmit clean
npm ci                 # lockfile reproducible, no drift
npm pack --dry-run     # 18 files, no docs/ tests/ notes/ leakage
```

The six `@ts-expect-error` cases in `tests/types.check.ts` compile-fail as intended, which is
what proves finding #27 is really fixed — dropping the `[key: string]: any` index signature
from the per-gateway option types is what makes cross-gateway fields an error, and an unused
`@ts-expect-error` would itself fail the build.

---

## Open questions for the maintainer

1. **Was the PayPal/Payoneer removal intentional and final?** If so, phase 1 completes it. If they're coming
   back, the registry/`ENV_MAP`/`index.d.ts` gaps should be filled rather than closed.
2. **Is there a staging account for each gateway?** Findings #2, #9 and #23 (Nagad) and the SSLCommerz refund
   envelope in #1 should be confirmed against live sandbox responses before release — the fixes are written
   from the code plus published specs, not from observed traffic.
3. **Semver stance on #11?** Restricting `resolveConfig` to known keys is technically breaking for anyone
   relying on arbitrary passthrough. It's the right change; it just wants a minor bump plus a changelog note,
   or a `1.x` deprecation warning followed by removal in `2.0`.
