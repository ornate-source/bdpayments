import { httpClient } from "../utils/http.js";
import { withErrorHandling } from "../utils/wrapper.js";
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
 * @param {boolean} sandbox
 * @returns {string}
 */
function getBaseUrl(sandbox) {
  return sandbox
    ? "http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs"
    : "https://api.mynagad.com/api/dfs";
}

/**
 * Initialize and complete a Nagad payment.
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
  const baseUrl = getBaseUrl(config.sandbox);
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
    `${baseUrl}/check-out/initialize/${config.merchantId}/${options.orderId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KM-Api-Version": "v-0.2.0",
        "X-KM-IP-V4": "127.0.0.1",
        "X-KM-Client-Type": "PC_WEB",
      },
      body: JSON.stringify({
        accountNumber: options.customerPhone || config.merchantId,
        dateTime: timestamp,
        sensitiveData: encryptedData,
        signature: signature,
      }),
    },
    "nagad",
    "CHARGE_FAILED"
  );

  if (initResult.reason) {
    throw new PaymentError(
      initResult.reason || "Nagad initialization failed",
      "nagad",
      "CHARGE_FAILED",
      initResult
    );
  }

  // Decrypt the response sensitive data
  let decryptedInit;
  try {
    const decryptedStr = decryptWithPrivateKey(
      initResult.sensitiveData,
      config.privateKey
    );
    decryptedInit = JSON.parse(decryptedStr);
  } catch {
    throw new PaymentError(
      "Failed to decrypt Nagad initialization response",
      "nagad",
      "CHARGE_FAILED",
      initResult
    );
  }

  // Step 2: Complete payment
  const completeData = JSON.stringify({
    merchantId: config.merchantId,
    orderId: options.orderId,
    amount: String(options.amount),
    currencyCode: "050", // BDT
    challenge: decryptedInit.challenge,
  });

  const completeSignature = signWithPrivateKey(
    completeData,
    config.privateKey
  );
  const completeEncrypted = encryptWithPublicKey(
    completeData,
    config.publicKey
  );

  const completeResult = await httpClient(
    `${baseUrl}/check-out/complete/${decryptedInit.paymentReferenceId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KM-Api-Version": "v-0.2.0",
        "X-KM-IP-V4": "127.0.0.1",
        "X-KM-Client-Type": "PC_WEB",
      },
      body: JSON.stringify({
        sensitiveData: completeEncrypted,
        signature: completeSignature,
        merchantCallbackURL: options.callbackURL || "",
        additionalMerchantInfo: options.extra || {},
      }),
    },
    "nagad",
    "CHARGE_FAILED"
  );

  if (completeResult.reason) {
    throw new PaymentError(
      completeResult.reason,
      "nagad",
      "CHARGE_FAILED",
      completeResult
    );
  }

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
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized refund result.
 */
export const refund = withErrorHandling(async (config, options) => {
  const baseUrl = getBaseUrl(config.sandbox);

  const refundBody = {
    merchantId: config.merchantId,
    originalPaymentReferenceId: options.transactionId,
    refundAmount: String(options.amount),
    referenceId: options.referenceId || `REF_${Date.now()}`,
    reason: options.reason || "Refund requested",
    ...options.extra,
  };

  const signature = signWithPrivateKey(
    JSON.stringify(refundBody),
    config.privateKey
  );

  const result = await httpClient(
    `${baseUrl}/purchase/refund`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KM-Api-Version": "v-0.2.0",
        "X-KM-IP-V4": "127.0.0.1",
        "X-KM-Client-Type": "PC_WEB",
        "X-KM-SIGNATURE": signature,
      },
      body: JSON.stringify(refundBody),
    },
    "nagad",
    "REFUND_FAILED"
  );

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
  const baseUrl = getBaseUrl(config.sandbox);

  const result = await httpClient(
    `${baseUrl}/verify/payment/${options.transactionId}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-KM-Api-Version": "v-0.2.0",
        "X-KM-IP-V4": "127.0.0.1",
        "X-KM-Client-Type": "PC_WEB",
      },
    },
    "nagad",
    "RETRIEVE_FAILED"
  );

  return {
    success: true,
    transactionId:
      result.paymentRefId || result.orderId || options.transactionId,
    status: result.status || result.statusCode || "UNKNOWN",
    amount: parseFloat(result.amount || "0"),
    currency: "BDT",
    gatewayResponse: result,
  };
}, "nagad", "RETRIEVE_FAILED");
