import crypto from "node:crypto";
import { resolveConfig } from "./config.js";

/**
 * Compare two strings without leaking timing information.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf-8");
  const bufB = Buffer.from(String(b), "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify the signature on an SSLCommerz IPN / success callback payload.
 *
 * SSLCommerz signs the payload by MD5-hashing the fields named in `verify_key`
 * (sorted, in `key=value` form) together with the MD5 of the store password,
 * and returns the result as `verify_sign`.
 *
 * This proves the payload came from SSLCommerz and was not tampered with. It is
 * *not* a substitute for `retrieve({ gateway: 'sslcommerz', valId })`, which
 * confirms the payment status server-to-server — prefer that as the source of
 * truth and use this as a cheap pre-filter.
 *
 * @param {object} payload - The parsed IPN body / callback query params.
 * @param {object} [options] - Optional credential overrides ({ storePassword }).
 * @returns {boolean} True if the signature is valid.
 *
 * @example
 * import { verifySslcommerzIpn } from 'bdpayments';
 * if (!verifySslcommerzIpn(req.body)) return res.sendStatus(400);
 */
export function verifySslcommerzIpn(payload, options = {}) {
  if (!payload || !payload.verify_sign || !payload.verify_key) return false;

  const config = resolveConfig("sslcommerz", options);

  const keys = String(payload.verify_key)
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .sort();

  const pairs = keys.map((key) => `${key}=${payload[key] ?? ""}`);

  const storePasswordHash = crypto
    .createHash("md5")
    .update(String(config.storePassword))
    .digest("hex");

  pairs.push(`store_passwd=${storePasswordHash}`);

  const expected = crypto
    .createHash("md5")
    .update(pairs.join("&"))
    .digest("hex");

  return safeEqual(expected, payload.verify_sign);
}

/**
 * Parse a Nagad callback query string into a normalized shape.
 *
 * Nagad's callback carries no signature, so the returned data must always be
 * confirmed with `retrieve({ gateway: 'nagad', transactionId })` before the
 * order is treated as paid. `verified` is therefore always false here.
 *
 * @param {object|URLSearchParams|string} query - The callback query params.
 * @returns {{orderId: string|null, paymentRefId: string|null, status: string|null, amount: number|null, verified: false, raw: object}}
 *
 * @example
 * const cb = parseNagadCallback(req.query);
 * const payment = await retrieve({ gateway: 'nagad', transactionId: cb.paymentRefId });
 */
export function parseNagadCallback(query) {
  let raw = query;
  if (typeof query === "string") {
    raw = Object.fromEntries(new URLSearchParams(query));
  } else if (query instanceof URLSearchParams) {
    raw = Object.fromEntries(query);
  }
  raw = raw || {};

  const amount = raw.amount !== undefined ? parseFloat(raw.amount) : null;

  return {
    orderId: raw.order_id ?? raw.orderId ?? null,
    paymentRefId: raw.payment_ref_id ?? raw.paymentRefId ?? null,
    status: raw.status ?? null,
    amount: Number.isFinite(amount) ? amount : null,
    // Nagad callbacks are unsigned — always confirm with retrieve().
    verified: false,
    raw,
  };
}
