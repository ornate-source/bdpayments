import { PaymentError } from "../errors.js";
import crypto from "node:crypto";

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
 * Generate a UTC timestamp in the format Nagad expects.
 *
 * @returns {string} e.g. "20240101120000"
 */
function getTimestamp() {
  const now = new Date();
  return now
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
}

/**
 * Generate a random challenge string.
 *
 * @param {number} [length=40]
 * @returns {string}
 */
function generateChallenge(length = 40) {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

/**
 * Encrypt data with Nagad's public key (RSA).
 *
 * @param {string} data - Data to encrypt.
 * @param {string} publicKey - Nagad's PEM public key.
 * @returns {string} Base64-encoded ciphertext.
 */
function encryptWithPublicKey(data, publicKey) {
  const buffer = Buffer.from(data, "utf-8");
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return encrypted.toString("base64");
}

/**
 * Sign data with your merchant private key (RSA).
 *
 * @param {string} data - Data to sign.
 * @param {string} privateKey - Merchant's PEM private key.
 * @returns {string} Base64-encoded signature.
 */
function signWithPrivateKey(data, privateKey) {
  const sign = crypto.createSign("SHA256");
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, "base64");
}

/**
 * Decrypt a response from Nagad using your merchant private key.
 *
 * @param {string} data - Base64-encoded encrypted data from Nagad.
 * @param {string} privateKey - Merchant's PEM private key.
 * @returns {string} Decrypted data.
 */
function decryptWithPrivateKey(data, privateKey) {
  const buffer = Buffer.from(data, "base64");
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return decrypted.toString("utf-8");
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
export async function charge(config, options) {
  try {
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

    const initResponse = await fetch(
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
      }
    );

    if (!initResponse.ok) {
      const error = await initResponse.json().catch(() => ({}));
      throw new PaymentError(
        error.message || "Nagad payment initialization failed",
        "nagad",
        "CHARGE_FAILED",
        error
      );
    }

    const initResult = await initResponse.json();

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

    const completeResponse = await fetch(
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
      }
    );

    if (!completeResponse.ok) {
      const error = await completeResponse.json().catch(() => ({}));
      throw new PaymentError(
        error.message || "Nagad payment completion failed",
        "nagad",
        "CHARGE_FAILED",
        error
      );
    }

    const completeResult = await completeResponse.json();

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
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "Nagad charge failed",
      "nagad",
      "CHARGE_FAILED",
      error
    );
  }
}

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
export async function refund(config, options) {
  try {
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

    const response = await fetch(`${baseUrl}/purchase/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KM-Api-Version": "v-0.2.0",
        "X-KM-IP-V4": "127.0.0.1",
        "X-KM-Client-Type": "PC_WEB",
        "X-KM-SIGNATURE": signature,
      },
      body: JSON.stringify(refundBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new PaymentError(
        error.message || "Nagad refund failed",
        "nagad",
        "REFUND_FAILED",
        error
      );
    }

    const result = await response.json();

    return {
      success: true,
      refundId: result.refundPaymentReferenceId || null,
      transactionId: options.transactionId,
      status: result.status || "REFUNDED",
      amount: options.amount,
      currency: "BDT",
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "Nagad refund failed",
      "nagad",
      "REFUND_FAILED",
      error
    );
  }
}

/**
 * Verify/retrieve a Nagad payment by payment reference ID.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The Nagad payment reference ID.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized retrieve result.
 */
export async function retrieve(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);

    const response = await fetch(
      `${baseUrl}/verify/payment/${options.transactionId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-KM-Api-Version": "v-0.2.0",
          "X-KM-IP-V4": "127.0.0.1",
          "X-KM-Client-Type": "PC_WEB",
        },
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new PaymentError(
        error.message || "Nagad verification failed",
        "nagad",
        "RETRIEVE_FAILED",
        error
      );
    }

    const result = await response.json();

    return {
      success: true,
      transactionId:
        result.paymentRefId || result.orderId || options.transactionId,
      status: result.status || result.statusCode || "UNKNOWN",
      amount: parseFloat(result.amount || "0"),
      currency: "BDT",
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "Nagad retrieve failed",
      "nagad",
      "RETRIEVE_FAILED",
      error
    );
  }
}
