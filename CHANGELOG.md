# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-07-23

Correctness, robustness and security release. Every user should upgrade —
1.0.x could report a **failed refund as successful** on SSLCommerz and Nagad.

### Fixed — money correctness

- **SSLCommerz refund no longer reports success when the refund failed.**
  `success` was computed as `status === "success" || APIConnect === "DONE"`, but
  `APIConnect: "DONE"` only means the API was reachable — SSLCommerz returns it
  alongside `status: "failed"`. A rejected refund now throws `PaymentError`, and
  a refund still `processing` returns `success: false` with the real status.
- **Nagad `refund()` and `retrieve()` now detect failures.** Both returned
  `success: true` for any 2xx response, but Nagad answers business failures with
  HTTP 200 and a `reason`/`message` body. Both now throw `PaymentError`, and
  `retrieve()` reports `success` from the payment status rather than hardcoding it.
- **Nagad request timestamps now use Bangladesh local time (UTC+6).** They were
  generated in UTC, a 6-hour skew that Nagad rejects as stale.
- **bKash rejects a token grant that returns no `id_token`.** Previously a 200
  with no token yielded `Authorization: undefined` on every subsequent call.
- **Amounts are formatted to two decimals** for bKash, SSLCommerz and Nagad.
  `String(0.1 + 0.2)` produced `"0.30000000000000004"`, which the gateways reject.

### Fixed — input validation

- **Missing required options are rejected before any network call.** Missing
  SSLCommerz URLs previously became the literal string `"undefined"`, producing a
  live payment session pointing at `https://undefined`. The same class of hole
  existed for bKash `invoiceNumber` and Nagad `orderId`. New codes:
  `INVALID_REQUEST`, `INVALID_AMOUNT`.
- Stripe amounts must now be positive integers (minor currency units).

### Fixed — types & packaging

- **`execute()` is now declared in `index.d.ts`.** It was exported and documented
  but absent from the types, so every TypeScript consumer of the bKash flow
  failed to compile.
- **Gateway option types no longer carry an index signature**, so fields
  belonging to another gateway are genuinely rejected — as the docs always
  claimed. Use `extra` for anything unmodelled.
- `RetrieveResult.transactionId` is now `string | null`, matching runtime.
- **Regenerated `package-lock.json`**, which was stale at `1.0.0` and still
  pinned `@paypal/paypal-server-sdk` as a peer and dev dependency.
- **Removed the unused `sslcommerz-lts` peer dependency** — it was never
  imported; the adapter uses `fetch`.
- Narrowed the `stripe` peer range from `*` to `>=12`.
- Added `files` and `exports`, so `docs/`, `tests/` and internals are no longer published.
- `GatewayNotFoundError` no longer advertises `paypal` and `payoneer`; the
  supported list is derived from the registry and exposed as `supportedGateways`.

### Added

- **Request timeouts** — 30s by default, configurable per gateway via
  `timeoutMs`. Node's `fetch` has no default timeout, so a stalled gateway
  previously hung the caller forever. New codes: `TIMEOUT`, `NETWORK_ERROR`.
- **bKash auth-token caching** with TTL, concurrent-grant de-duplication and
  retry-on-401. A checkout used to burn four round-trips instead of two against
  a rate-limited endpoint.
- **Idempotency keys** — `idempotencyKey` is forwarded to Stripe; the natural
  key for each BDT gateway is documented.
- **Webhook helpers** — `verifySslcommerzIpn()` (constant-time signature check)
  and `parseNagadCallback()`.
- **`getGatewayCapabilities(name)`** reports which operations a gateway implements.
- `PaymentError.status` carries the HTTP status; `PaymentError.cause` chains the
  underlying error.
- Stripe SDK clients are cached, and a missing `stripe` peer dependency now
  reports `MISSING_DEPENDENCY` instead of a generic `CHARGE_FAILED`.
- Nagad: configurable `clientIp` (`X-KM-IP-V4`) and `baseUrl`.
- Test suite covering all four adapters with mocked `fetch` (101 tests), a
  type-definition test, and CI across Node 18/20/22/24.

### Changed

- **`resolveConfig()` only reads recognised credential and transport keys from
  per-call options.** It previously merged the entire options object, so business
  fields landed in the credential object and a field named like a credential
  could silently override a configured one. *Potentially breaking* for anyone
  relying on arbitrary passthrough — use `extra` instead.
- **Resolved credentials redact themselves** when logged or `JSON.stringify`-ed.
- **`configure()` rejects unknown gateway names** instead of silently ignoring
  typos. New code: `INVALID_CONFIG`.
- `execute()` on a gateway without it now throws `PaymentError`
  (`UNSUPPORTED_OPERATION`) rather than a bare `Error`.
- `clearConfig()` also clears cached auth tokens and SDK clients.
- Nagad refund signatures cover a canonical fixed-key payload; caller-supplied
  `extra` travels outside the signed bytes so it cannot invalidate the signature.

### Known limitations

- Nagad's `refund()` wire format and the SSLCommerz refund response envelope are
  implemented from the published specs, not from observed sandbox traffic —
  verify against your merchant account before going live.
- Nagad's sandbox is only published over plaintext HTTP. Override with
  `configure({ nagad: { baseUrl } })` if your account has an HTTPS endpoint.
- Node.js 18.19.1, 20.11.1 and 21.6.2 disabled RSA PKCS#1 v1.5 decryption
  (CVE-2023-46809), which Nagad requires. `charge()` now explains this when the
  decrypt fails. Upgrade to a later patch release.

## [1.0.3] — 2025

- Standardized gateway requests and error handling behind shared HTTP and
  wrapper utilities.
- Added SSLCommerz callback validation via `valId` in `retrieve()`.
