import { httpClient } from "../utils/http.js";
import { withErrorHandling } from "../utils/wrapper.js";
import { registerCache } from "../utils/cache.js";
import {
  requireOptions,
  requireAmount,
  formatAmount,
} from "../utils/validate.js";
import { PaymentError } from "../errors.js";

/**
 * Get the bKash API base URL.
 *
 * @param {boolean} sandbox
 * @returns {string}
 */
function getBaseUrl(sandbox) {
  return sandbox
    ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout"
    : "https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout";
}

/**
 * Cached auth tokens, keyed by credentials.
 *
 * bKash tokens are valid for ~1 hour and the grant endpoint is rate-limited, so
 * granting one per operation (4 round-trips for a 2-call checkout) is both slow
 * and a reliability risk under load.
 *
 * @type {Map<string, {token?: string, expiresAt?: number, inflight?: Promise<string>}>}
 */
const tokenCache = new Map();

/** Renew this long before the token actually expires. */
const TOKEN_SKEW_MS = 60_000;

/**
 * Drop all cached bKash tokens. Called by `clearConfig()`.
 */
export function clearTokenCache() {
  tokenCache.clear();
}

registerCache(clearTokenCache);

/**
 * @param {object} config
 * @returns {string}
 */
function cacheKey(config) {
  return `${config.sandbox ? "sbx" : "live"}:${config.appKey}:${config.username}`;
}

/**
 * Grant a bKash auth token.
 *
 * @param {object} config - Resolved credentials ({ appKey, appSecret, username, password, sandbox }).
 * @returns {Promise<object>} The raw grant payload (id_token, expires_in, refresh_token).
 */
async function grantToken(config) {
  const baseUrl = getBaseUrl(config.sandbox);

  const data = await httpClient(
    `${baseUrl}/token/grant`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        username: config.username,
        password: config.password,
      },
      body: JSON.stringify({
        app_key: config.appKey,
        app_secret: config.appSecret,
      }),
    },
    "bkash",
    "AUTH_FAILED",
    { timeoutMs: config.timeoutMs }
  );

  // A 200 with no id_token must fail here — otherwise every later call sends
  // `Authorization: undefined` and reports a misleading downstream error.
  if ((data.statusCode && data.statusCode !== "0000") || !data.id_token) {
    throw new PaymentError(
      data.statusMessage || "bKash token grant failed",
      "bkash",
      "AUTH_FAILED",
      data
    );
  }

  return data;
}

/**
 * Get a valid bKash token, using the cache and de-duplicating concurrent grants.
 *
 * @param {object} config - Resolved credentials.
 * @param {boolean} [forceRefresh=false] - Ignore any cached token.
 * @returns {Promise<string>} ID token.
 */
async function getToken(config, forceRefresh = false) {
  const key = cacheKey(config);
  const entry = tokenCache.get(key);

  if (!forceRefresh) {
    if (entry?.token && Date.now() < entry.expiresAt) return entry.token;
    if (entry?.inflight) return entry.inflight;
  }

  const inflight = grantToken(config)
    .then((data) => {
      const ttlMs = (Number(data.expires_in) || 3600) * 1000;
      tokenCache.set(key, {
        token: data.id_token,
        expiresAt: Date.now() + ttlMs - TOKEN_SKEW_MS,
      });
      return data.id_token;
    })
    .catch((error) => {
      tokenCache.delete(key);
      throw error;
    });

  // On a forced refresh the old token is known-bad — drop it so a concurrent
  // caller cannot read it back out of the cache while the new grant is in flight.
  tokenCache.set(key, forceRefresh ? { inflight } : { ...entry, inflight });
  return inflight;
}

/**
 * Make an authenticated bKash API call.
 *
 * Retries once with a fresh token if bKash rejects the current one, which can
 * happen when a cached token is revoked before its stated expiry.
 *
 * @param {object} config - Resolved credentials.
 * @param {string} path - Path appended to the base URL.
 * @param {object} body
 * @returns {Promise<object>}
 */
async function bkashFetch(config, path, body) {
  const baseUrl = getBaseUrl(config.sandbox);

  const call = async (token) =>
    httpClient(
      `${baseUrl}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: token,
          "X-APP-Key": config.appKey,
        },
        body: JSON.stringify(body),
      },
      "bkash",
      "API_FAILED",
      { timeoutMs: config.timeoutMs }
    );

  try {
    return await call(await getToken(config));
  } catch (error) {
    const unauthorized =
      error?.status === 401 ||
      error?.originalError?.statusCode === "2001" ||
      error?.originalError?.statusCode === "2002";

    if (!unauthorized) throw error;

    return call(await getToken(config, true));
  }
}

/**
 * Throw if bKash reported a business-level failure.
 *
 * @param {object} result - Parsed bKash response.
 * @param {string} code - Error code to attach.
 * @param {string} message - Fallback message.
 */
function assertBkashOk(result, code, message) {
  if (result.statusCode && result.statusCode !== "0000") {
    throw new PaymentError(
      result.statusMessage || message,
      "bkash",
      code,
      result
    );
  }
}

/**
 * Create a bKash payment.
 *
 * bKash has no idempotency-key header; `merchantInvoiceNumber` is the natural
 * idempotency key — reuse it when retrying a create.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {number} options.amount - Payment amount.
 * @param {string} [options.currency="BDT"] - Currency (default BDT).
 * @param {string} options.invoiceNumber - Your invoice/order number.
 * @param {string} [options.payerReference] - Payer reference (e.g. phone number).
 * @param {string} [options.callbackURL] - Callback URL after payment.
 * @param {string} [options.intent="sale"] - Payment intent ("sale" or "authorization").
 * @param {string} [options.mode="0011"] - bKash checkout mode.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized payment result.
 */
export const charge = withErrorHandling(async (config, options) => {
  requireOptions("bkash", options, ["invoiceNumber"]);
  requireAmount("bkash", options.amount);

  const createBody = {
    mode: options.mode || "0011",
    payerReference: options.payerReference || " ",
    callbackURL: options.callbackURL || " ",
    amount: formatAmount(options.amount),
    currency: options.currency || "BDT",
    intent: options.intent || "sale",
    merchantInvoiceNumber: options.invoiceNumber,
    ...options.extra,
  };

  const result = await bkashFetch(config, "/create", createBody);

  assertBkashOk(result, "CHARGE_FAILED", "bKash payment creation failed");

  if (!result.paymentID) {
    throw new PaymentError(
      "bKash payment creation returned no paymentID",
      "bkash",
      "CHARGE_FAILED",
      result
    );
  }

  return {
    success: true,
    transactionId: result.paymentID,
    paymentID: result.paymentID,
    status: result.transactionStatus || "CREATED",
    amount: parseFloat(result.amount || options.amount),
    currency: result.currency || options.currency || "BDT",
    bkashURL: result.bkashURL || null,
    callbackURL: result.callbackURL || null,
    gatewayResponse: result,
  };
}, "bkash", "CHARGE_FAILED");

/**
 * Execute a bKash payment (after customer approval).
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.paymentID - The bKash payment ID to execute.
 * @returns {Promise<object>} Normalized result.
 */
export const execute = withErrorHandling(async (config, options) => {
  requireOptions("bkash", options, ["paymentID"]);

  const result = await bkashFetch(config, "/execute", {
    paymentID: options.paymentID,
  });

  assertBkashOk(result, "EXECUTE_FAILED", "bKash payment execution failed");

  return {
    success: true,
    transactionId: result.trxID || result.paymentID,
    trxID: result.trxID || null,
    paymentID: result.paymentID,
    status: result.transactionStatus || "COMPLETED",
    amount: parseFloat(result.amount || "0"),
    currency: result.currency || "BDT",
    gatewayResponse: result,
  };
}, "bkash", "EXECUTE_FAILED");

/**
 * Refund a bKash payment.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The bKash payment ID to refund.
 * @param {string} options.trxID - The bKash transaction ID (trxID from execute).
 * @param {number} options.amount - Refund amount.
 * @param {string} [options.reason] - Reason for refund.
 * @param {string} [options.sku] - SKU of the product.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized refund result.
 */
export const refund = withErrorHandling(async (config, options) => {
  requireOptions("bkash", options, ["transactionId", "trxID"]);
  requireAmount("bkash", options.amount);

  const refundBody = {
    paymentID: options.transactionId,
    trxID: options.trxID,
    amount: formatAmount(options.amount),
    reason: options.reason || "Refund requested",
    sku: options.sku || "N/A",
    ...options.extra,
  };

  const result = await bkashFetch(config, "/payment/refund", refundBody);

  assertBkashOk(result, "REFUND_FAILED", "bKash refund failed");

  return {
    success: true,
    refundId: result.refundTrxID || null,
    transactionId: options.transactionId,
    status: result.transactionStatus || "REFUNDED",
    amount: parseFloat(result.amount || options.amount),
    currency: result.currency || "BDT",
    gatewayResponse: result,
  };
}, "bkash", "REFUND_FAILED");

/**
 * Query/retrieve a bKash payment status.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The bKash payment ID to query.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized retrieve result.
 */
export const retrieve = withErrorHandling(async (config, options) => {
  requireOptions("bkash", options, ["transactionId"]);

  const result = await bkashFetch(config, "/payment/status", {
    paymentID: options.transactionId,
    ...options.extra,
  });

  assertBkashOk(result, "RETRIEVE_FAILED", "bKash query failed");

  return {
    success: true,
    transactionId: result.paymentID || options.transactionId,
    trxID: result.trxID || null,
    status: result.transactionStatus || "UNKNOWN",
    amount: parseFloat(result.amount || "0"),
    currency: result.currency || "BDT",
    gatewayResponse: result,
  };
}, "bkash", "RETRIEVE_FAILED");
