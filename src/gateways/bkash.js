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
 * Grant a bKash auth token.
 *
 * @param {object} config - Resolved credentials ({ appKey, appSecret, username, password, sandbox }).
 * @returns {Promise<string>} ID token.
 */
async function grantToken(config) {
  const baseUrl = getBaseUrl(config.sandbox);

  const response = await fetch(`${baseUrl}/token/grant`, {
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
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new PaymentError(
      error.statusMessage || "bKash token grant failed",
      "bkash",
      "AUTH_FAILED",
      error
    );
  }

  const data = await response.json();

  if (data.statusCode && data.statusCode !== "0000") {
    throw new PaymentError(
      data.statusMessage || "bKash token grant failed",
      "bkash",
      "AUTH_FAILED",
      data
    );
  }

  return data.id_token;
}

/**
 * Make an authenticated bKash API call.
 *
 * @param {string} url
 * @param {string} token
 * @param {string} appKey
 * @param {object} body
 * @returns {Promise<object>}
 */
async function bkashFetch(url, token, appKey, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: token,
      "X-APP-Key": appKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw error;
  }

  return response.json();
}

/**
 * Create a bKash payment.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {number} options.amount - Payment amount.
 * @param {string} [options.currency="BDT"] - Currency (default BDT).
 * @param {string} options.invoiceNumber - Your invoice/order number.
 * @param {string} [options.payerReference] - Payer reference (e.g. phone number).
 * @param {string} [options.callbackURL] - Callback URL after payment.
 * @param {string} [options.intent="sale"] - Payment intent ("sale" or "authorization").
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized payment result.
 */
export async function charge(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);
    const token = await grantToken(config);

    const createBody = {
      mode: "0011",
      payerReference: options.payerReference || " ",
      callbackURL: options.callbackURL || " ",
      amount: String(options.amount),
      currency: options.currency || "BDT",
      intent: options.intent || "sale",
      merchantInvoiceNumber: options.invoiceNumber,
      ...options.extra,
    };

    const result = await bkashFetch(
      `${baseUrl}/create`,
      token,
      config.appKey,
      createBody
    );

    if (result.statusCode && result.statusCode !== "0000") {
      throw new PaymentError(
        result.statusMessage || "bKash payment creation failed",
        "bkash",
        "CHARGE_FAILED",
        result
      );
    }

    return {
      success: true,
      transactionId: result.paymentID,
      status: result.transactionStatus || "CREATED",
      amount: parseFloat(result.amount || options.amount),
      currency: options.currency || "BDT",
      bkashURL: result.bkashURL || null,
      callbackURL: result.callbackURL || null,
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "bKash charge failed",
      "bkash",
      "CHARGE_FAILED",
      error
    );
  }
}

/**
 * Execute a bKash payment (after customer approval).
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.paymentID - The bKash payment ID to execute.
 * @returns {Promise<object>} Normalized result.
 */
export async function execute(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);
    const token = await grantToken(config);

    const result = await bkashFetch(
      `${baseUrl}/execute`,
      token,
      config.appKey,
      { paymentID: options.paymentID }
    );

    if (result.statusCode && result.statusCode !== "0000") {
      throw new PaymentError(
        result.statusMessage || "bKash payment execution failed",
        "bkash",
        "EXECUTE_FAILED",
        result
      );
    }

    return {
      success: true,
      transactionId: result.trxID || result.paymentID,
      paymentID: result.paymentID,
      status: result.transactionStatus || "COMPLETED",
      amount: parseFloat(result.amount || "0"),
      currency: result.currency || "BDT",
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "bKash execute failed",
      "bkash",
      "EXECUTE_FAILED",
      error
    );
  }
}

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
export async function refund(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);
    const token = await grantToken(config);

    const refundBody = {
      paymentID: options.transactionId,
      trxID: options.trxID,
      amount: String(options.amount),
      reason: options.reason || "Refund requested",
      sku: options.sku || "N/A",
      ...options.extra,
    };

    const result = await bkashFetch(
      `${baseUrl}/payment/refund`,
      token,
      config.appKey,
      refundBody
    );

    if (result.statusCode && result.statusCode !== "0000") {
      throw new PaymentError(
        result.statusMessage || "bKash refund failed",
        "bkash",
        "REFUND_FAILED",
        result
      );
    }

    return {
      success: true,
      refundId: result.refundTrxID || null,
      transactionId: options.transactionId,
      status: result.transactionStatus || "REFUNDED",
      amount: parseFloat(result.amount || options.amount),
      currency: result.currency || "BDT",
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "bKash refund failed",
      "bkash",
      "REFUND_FAILED",
      error
    );
  }
}

/**
 * Query/retrieve a bKash payment status.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The bKash payment ID to query.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized retrieve result.
 */
export async function retrieve(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);
    const token = await grantToken(config);

    const result = await bkashFetch(
      `${baseUrl}/payment/status`,
      token,
      config.appKey,
      { paymentID: options.transactionId, ...options.extra }
    );

    if (result.statusCode && result.statusCode !== "0000") {
      throw new PaymentError(
        result.statusMessage || "bKash query failed",
        "bkash",
        "RETRIEVE_FAILED",
        result
      );
    }

    return {
      success: true,
      transactionId: result.paymentID,
      trxID: result.trxID || null,
      status: result.transactionStatus || "UNKNOWN",
      amount: parseFloat(result.amount || "0"),
      currency: result.currency || "BDT",
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "bKash retrieve failed",
      "bkash",
      "RETRIEVE_FAILED",
      error
    );
  }
}
