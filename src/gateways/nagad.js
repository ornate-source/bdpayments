import { httpClient } from "../utils/http.js";
import { withErrorHandling } from "../utils/wrapper.js";
import {
  requireOptions,
  requireAmount,
  formatAmount,
} from "../utils/validate.js";
import { PaymentError } from "../errors.js";
import {
  getTimestamp,
  generateChallenge,
  encryptWithPublicKey,
  signWithPrivateKey,
  decryptWithPrivateKey,
} from "../utils/crypto.js";

/**
 * Get the Nagad API base URL.
 *
 * NOTE: Nagad's sandbox is only published over plaintext HTTP. The payload
 * itself is RSA-encrypted, but headers and the merchant/order IDs in the path
 * are not. Override with `configure({ nagad: { baseUrl } })` if your account
 * has an HTTPS sandbox endpoint.
 *
 * @param {object} config
 * @returns {string}
 */
function getBaseUrl(config) {
  if (config.baseUrl) return String(config.baseUrl).replace(/\/+$/, "");
  return config.sandbox
    ? "http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs"
    : "https://api.mynagad.com/api/dfs";
}

/**
 * Standard Nagad request headers.
 *
 * @param {object} config
 * @param {object} [additional]
 * @returns {object}
 */
function nagadHeaders(config, additional = {}) {
  return {
    "Content-Type": "application/json",
    "X-KM-Api-Version": "v-0.2.0",
    // Nagad validates the caller IP on some merchant configurations.
    "X-KM-IP-V4": config.clientIp || "127.0.0.1",
    "X-KM-Client-Type": "PC_WEB",
    ...additional,
  };
}

/**
 * Throw if Nagad reported a business-level failure.
 *
 * Nagad answers business failures with HTTP 200 and a `reason`/`message` body,
 * so the HTTP status alone says nothing about whether the operation succeeded.
 *
 * @param {object} result - Parsed Nagad response.
 * @param {string} code - Error code to attach.
 * @param {string} fallbackMessage
 * @returns {object} The same result.
 */
function assertNagadOk(result, code, fallbackMessage) {
  const failed =
    !result ||
    result.reason !== undefined ||
    result.status === "Failed" ||
    result.status === "Aborted" ||
    result.statusCode === "false";

  if (failed) {
    throw new PaymentError(
      result?.message || result?.reason || fallbackMessage,
      "nagad",
      code,
      result
    );
  }

  return result;
}

/**
 * Initialize and complete a Nagad payment.
 *
 * `orderId` is the natural idempotency key — reuse it when retrying.
 *
 * @param {object} config - Resolved credentials ({ merchantId, publicKey, privateKey, sandbox }).
 * @param {object} options
 * @param {number} options.amount - Payment amount.
 * @param {string} options.orderId - Your unique order ID.
 * @param {string} [options.callbackURL] - Callback URL after payment.
 * @param {string} [options.customerPhone] - Customer phone number.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized payment result.
 */
export const charge = withErrorHandling(async (config, options) => {
  // orderId is interpolated into the request path — an undefined one would
  // silently request ".../initialize/MERCHANT/undefined".
  requireOptions("nagad", options, ["orderId"]);
  requireAmount("nagad", options.amount);

  const baseUrl = getBaseUrl(config);
  const timestamp = getTimestamp();
  const challenge = generateChallenge();

  // Step 1: Initialize payment
  const sensitiveData = JSON.stringify({
    merchantId: config.merchantId,
    datetime: timestamp,
    orderId: options.orderId,
    challenge: challenge,
  });

  const signature = signWithPrivateKey(sensitiveData, config.privateKey);
  const encryptedData = encryptWithPublicKey(sensitiveData, config.publicKey);

  const initResult = await httpClient(
    `${baseUrl}/check-out/initialize/${encodeURIComponent(
      config.merchantId
    )}/${encodeURIComponent(options.orderId)}`,
    {
      method: "POST",
      headers: nagadHeaders(config),
      body: JSON.stringify({
        accountNumber: options.customerPhone || config.merchantId,
        dateTime: timestamp,
        sensitiveData: encryptedData,
        signature: signature,
      }),
    },
    "nagad",
    "CHARGE_FAILED",
    { timeoutMs: config.timeoutMs }
  );

  assertNagadOk(initResult, "CHARGE_FAILED", "Nagad initialization failed");

  // Decrypt the response sensitive data
  let decryptedInit;
  try {
    const decryptedStr = decryptWithPrivateKey(
      initResult.sensitiveData,
      config.privateKey
    );
    decryptedInit = JSON.parse(decryptedStr);
  } catch (error) {
    throw new PaymentError(
      "Failed to decrypt Nagad initialization response. " +
        "Note that Node.js 18.19.1, 20.11.1 and 21.6.2 disabled RSA PKCS#1 v1.5 " +
        "decryption (CVE-2023-46809), which Nagad's protocol requires — " +
        "upgrade to a later patch release if you are on one of those versions.",
      "nagad",
      "CHARGE_FAILED",
      error
    );
  }

  // Step 2: Complete payment
  const completeData = JSON.stringify({
    merchantId: config.merchantId,
    orderId: options.orderId,
    amount: formatAmount(options.amount),
    currencyCode: "050", // BDT
    challenge: decryptedInit.challenge,
  });

  const completeSignature = signWithPrivateKey(completeData, config.privateKey);
  const completeEncrypted = encryptWithPublicKey(completeData, config.publicKey);

  const completeResult = await httpClient(
    `${baseUrl}/check-out/complete/${encodeURIComponent(
      decryptedInit.paymentReferenceId
    )}`,
    {
      method: "POST",
      headers: nagadHeaders(config),
      body: JSON.stringify({
        sensitiveData: completeEncrypted,
        signature: completeSignature,
        merchantCallbackURL: options.callbackURL || "",
        additionalMerchantInfo: options.extra || {},
      }),
    },
    "nagad",
    "CHARGE_FAILED",
    { timeoutMs: config.timeoutMs }
  );

  assertNagadOk(completeResult, "CHARGE_FAILED", "Nagad payment failed");

  return {
    success: true,
    transactionId:
      completeResult.paymentRefId ||
      decryptedInit.paymentReferenceId ||
      options.orderId,
    status: completeResult.status || "CREATED",
    amount: options.amount,
    currency: "BDT",
    callBackUrl: completeResult.callBackUrl || null,
    gatewayResponse: completeResult,
  };
}, "nagad", "CHARGE_FAILED");

/**
 * Refund a Nagad payment.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The Nagad payment reference ID.
 * @param {number} options.amount - Refund amount.
 * @param {string} [options.referenceId] - Your internal reference for the refund.
 * @param {string} [options.reason] - Reason for refund.
 * @param {object} [options.extra] - Additional params (sent unsigned).
 * @returns {Promise<object>} Normalized refund result.
 */
export const refund = withErrorHandling(async (config, options) => {
  requireOptions("nagad", options, ["transactionId"]);
  requireAmount("nagad", options.amount);

  const baseUrl = getBaseUrl(config);

  // Signed payload: fixed key order, no caller-supplied keys. Signing
  // `{...body, ...extra}` would make the signed bytes depend on JS key
  // insertion order and on whatever the caller happened to pass in `extra`.
  const signedPayload = {
    merchantId: config.merchantId,
    originalPaymentReferenceId: options.transactionId,
    refundAmount: formatAmount(options.amount),
    referenceId: options.referenceId || `REF_${Date.now()}`,
    reason: options.reason || "Refund requested",
  };

  const canonical = JSON.stringify(signedPayload);
  const signature = signWithPrivateKey(canonical, config.privateKey);

  const result = await httpClient(
    `${baseUrl}/purchase/refund`,
    {
      method: "POST",
      headers: nagadHeaders(config, { "X-KM-SIGNATURE": signature }),
      // Extras travel outside the signed payload so they cannot invalidate it.
      body: JSON.stringify({ ...signedPayload, ...options.extra }),
    },
    "nagad",
    "REFUND_FAILED",
    { timeoutMs: config.timeoutMs }
  );

  assertNagadOk(result, "REFUND_FAILED", "Nagad refund failed");

  return {
    success: true,
    refundId: result.refundPaymentReferenceId || null,
    transactionId: options.transactionId,
    status: result.status || "REFUNDED",
    amount: options.amount,
    currency: "BDT",
    gatewayResponse: result,
  };
}, "nagad", "REFUND_FAILED");

/**
 * Verify/retrieve a Nagad payment by payment reference ID.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The Nagad payment reference ID.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized retrieve result.
 */
export const retrieve = withErrorHandling(async (config, options) => {
  requireOptions("nagad", options, ["transactionId"]);

  const baseUrl = getBaseUrl(config);

  const result = await httpClient(
    `${baseUrl}/verify/payment/${encodeURIComponent(options.transactionId)}`,
    {
      method: "GET",
      headers: nagadHeaders(config),
    },
    "nagad",
    "RETRIEVE_FAILED",
    { timeoutMs: config.timeoutMs }
  );

  assertNagadOk(result, "RETRIEVE_FAILED", "Nagad verification failed");

  return {
    success: result.status === "Success",
    transactionId:
      result.paymentRefId || result.orderId || options.transactionId,
    status: result.status || result.statusCode || "UNKNOWN",
    amount: parseFloat(result.amount || "0"),
    currency: "BDT",
    gatewayResponse: result,
  };
}, "nagad", "RETRIEVE_FAILED");
