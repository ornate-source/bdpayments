import { PaymentError } from "../errors.js";

/**
 * Get the Payoneer API base URL.
 *
 * @param {boolean} sandbox
 * @returns {string}
 */
function getBaseUrl(sandbox) {
  return sandbox
    ? "https://api.sandbox.payoneer.com/v4"
    : "https://api.payoneer.com/v4";
}

/**
 * Build the basic auth header for Payoneer.
 *
 * @param {object} config
 * @returns {string}
 */
function getAuthHeader(config) {
  return `Basic ${Buffer.from(`${config.username}:${config.apiPassword}`).toString("base64")}`;
}

/**
 * Create a payout via Payoneer.
 *
 * Note: Payoneer's API is payout-oriented (send money to payees),
 * not a traditional "charge a customer" flow.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {number} options.amount - Payout amount.
 * @param {string} options.currency - ISO currency code.
 * @param {string} options.payeeId - The Payoneer payee ID.
 * @param {string} [options.description] - Payout description.
 * @param {string} [options.clientReferenceId] - Your internal reference ID.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized payment result.
 */
export async function charge(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);

    const payoutBody = {
      payee_id: options.payeeId,
      amount: options.amount,
      currency: options.currency,
      description: options.description || "Payout",
      ...(options.clientReferenceId && {
        client_reference_id: options.clientReferenceId,
      }),
      ...options.extra,
    };

    const response = await fetch(
      `${baseUrl}/programs/${config.partnerId}/payouts`,
      {
        method: "POST",
        headers: {
          Authorization: getAuthHeader(config),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payoutBody),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new PaymentError(
        error.description || "Payoneer payout creation failed",
        "payoneer",
        "CHARGE_FAILED",
        error
      );
    }

    const payout = await response.json();

    return {
      success: true,
      transactionId: payout.payout_id || payout.id || null,
      status: payout.status || "CREATED",
      amount: options.amount,
      currency: options.currency,
      gatewayResponse: payout,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "Payoneer charge failed",
      "payoneer",
      "CHARGE_FAILED",
      error
    );
  }
}

/**
 * Cancel or reverse a Payoneer payout.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The payout ID to cancel.
 * @param {string} [options.reason] - Reason for cancellation.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized refund result.
 */
export async function refund(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);

    const response = await fetch(
      `${baseUrl}/programs/${config.partnerId}/payouts/${options.transactionId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: getAuthHeader(config),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: options.reason || "Cancellation requested",
          ...options.extra,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new PaymentError(
        error.description || "Payoneer payout cancellation failed",
        "payoneer",
        "REFUND_FAILED",
        error
      );
    }

    const result = await response.json();

    return {
      success: true,
      refundId: result.id || options.transactionId,
      transactionId: options.transactionId,
      status: result.status || "CANCELLED",
      amount: result.amount || null,
      currency: result.currency || null,
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "Payoneer refund failed",
      "payoneer",
      "REFUND_FAILED",
      error
    );
  }
}

/**
 * Retrieve a Payoneer payout status.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The payout ID to retrieve.
 * @param {object} [options.extra] - Additional query params.
 * @returns {Promise<object>} Normalized retrieve result.
 */
export async function retrieve(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);

    const response = await fetch(
      `${baseUrl}/programs/${config.partnerId}/payouts/${options.transactionId}`,
      {
        method: "GET",
        headers: {
          Authorization: getAuthHeader(config),
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new PaymentError(
        error.description || "Payoneer retrieve failed",
        "payoneer",
        "RETRIEVE_FAILED",
        error
      );
    }

    const payout = await response.json();

    return {
      success: true,
      transactionId: payout.payout_id || payout.id || options.transactionId,
      status: payout.status,
      amount: payout.amount || null,
      currency: payout.currency || null,
      gatewayResponse: payout,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "Payoneer retrieve failed",
      "payoneer",
      "RETRIEVE_FAILED",
      error
    );
  }
}
