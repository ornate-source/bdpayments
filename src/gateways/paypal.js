import { PaymentError } from "../errors.js";

/**
 * Get the PayPal base URL based on sandbox mode.
 *
 * @param {boolean} sandbox
 * @returns {string}
 */
function getBaseUrl(sandbox) {
  return sandbox
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

/**
 * Obtain an OAuth2 access token from PayPal.
 *
 * @param {object} config - Resolved credentials ({ clientId, clientSecret, sandbox }).
 * @returns {Promise<string>} Access token.
 */
async function getAccessToken(config) {
  const baseUrl = getBaseUrl(config.sandbox);
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`
  ).toString("base64");

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new PaymentError(
      error.error_description || "Failed to obtain PayPal access token",
      "paypal",
      "AUTH_FAILED",
      error
    );
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Create a PayPal order and optionally capture it.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {number} options.amount - Amount in major currency units (e.g. 10.00).
 * @param {string} options.currency - ISO currency code (e.g. "USD").
 * @param {string} [options.description] - Payment description.
 * @param {string} [options.returnUrl] - URL to redirect after approval.
 * @param {string} [options.cancelUrl] - URL to redirect on cancel.
 * @param {boolean} [options.capture=false] - If true, immediately capture the order.
 * @param {object} [options.extra] - Additional params merged into the order body.
 * @returns {Promise<object>} Normalized payment result.
 */
export async function charge(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);
    const accessToken = await getAccessToken(config);

    const orderBody = {
      intent: options.capture ? "CAPTURE" : "AUTHORIZE",
      purchase_units: [
        {
          amount: {
            currency_code: options.currency,
            value: String(options.amount),
          },
          ...(options.description && { description: options.description }),
        },
      ],
      ...(options.returnUrl && {
        payment_source: {
          paypal: {
            experience_context: {
              return_url: options.returnUrl,
              cancel_url: options.cancelUrl || options.returnUrl,
            },
          },
        },
      }),
      ...options.extra,
    };

    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new PaymentError(
        error.message || "PayPal order creation failed",
        "paypal",
        "CHARGE_FAILED",
        error
      );
    }

    const order = await response.json();

    // If capture was requested, capture immediately
    if (options.capture && order.status === "APPROVED") {
      return await captureOrder(baseUrl, accessToken, order.id);
    }

    return {
      success: true,
      transactionId: order.id,
      status: order.status,
      amount: options.amount,
      currency: options.currency,
      approvalUrl: order.links?.find((l) => l.rel === "approve")?.href || null,
      gatewayResponse: order,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "PayPal charge failed",
      "paypal",
      "CHARGE_FAILED",
      error
    );
  }
}

/**
 * Capture an approved PayPal order.
 *
 * @param {string} baseUrl
 * @param {string} accessToken
 * @param {string} orderId
 * @returns {Promise<object>}
 */
async function captureOrder(baseUrl, accessToken, orderId) {
  const response = await fetch(
    `${baseUrl}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new PaymentError(
      error.message || "PayPal capture failed",
      "paypal",
      "CAPTURE_FAILED",
      error
    );
  }

  const captured = await response.json();
  const captureData =
    captured.purchase_units?.[0]?.payments?.captures?.[0] || {};

  return {
    success: true,
    transactionId: captured.id,
    captureId: captureData.id || null,
    status: captured.status,
    amount: parseFloat(captureData.amount?.value || "0"),
    currency: captureData.amount?.currency_code || null,
    gatewayResponse: captured,
  };
}

/**
 * Refund a captured PayPal payment.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The capture ID to refund.
 * @param {number} [options.amount] - Partial refund amount (omit for full refund).
 * @param {string} [options.currency] - Currency code (required for partial refunds).
 * @param {string} [options.reason] - Reason for refund.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized refund result.
 */
export async function refund(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);
    const accessToken = await getAccessToken(config);

    const refundBody = {
      ...(options.amount && {
        amount: {
          value: String(options.amount),
          currency_code: options.currency,
        },
      }),
      ...(options.reason && { note_to_payer: options.reason }),
      ...options.extra,
    };

    const response = await fetch(
      `${baseUrl}/v2/payments/captures/${options.transactionId}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(refundBody),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new PaymentError(
        error.message || "PayPal refund failed",
        "paypal",
        "REFUND_FAILED",
        error
      );
    }

    const refundResult = await response.json();

    return {
      success: true,
      refundId: refundResult.id,
      transactionId: options.transactionId,
      status: refundResult.status,
      amount: parseFloat(refundResult.amount?.value || "0"),
      currency: refundResult.amount?.currency_code || null,
      gatewayResponse: refundResult,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "PayPal refund failed",
      "paypal",
      "REFUND_FAILED",
      error
    );
  }
}

/**
 * Retrieve a PayPal order by ID.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The order ID to retrieve.
 * @param {object} [options.extra] - Additional query params.
 * @returns {Promise<object>} Normalized retrieve result.
 */
export async function retrieve(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);
    const accessToken = await getAccessToken(config);

    const response = await fetch(
      `${baseUrl}/v2/checkout/orders/${options.transactionId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new PaymentError(
        error.message || "PayPal retrieve failed",
        "paypal",
        "RETRIEVE_FAILED",
        error
      );
    }

    const order = await response.json();
    const purchaseUnit = order.purchase_units?.[0] || {};

    return {
      success: true,
      transactionId: order.id,
      status: order.status,
      amount: parseFloat(purchaseUnit.amount?.value || "0"),
      currency: purchaseUnit.amount?.currency_code || null,
      gatewayResponse: order,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "PayPal retrieve failed",
      "paypal",
      "RETRIEVE_FAILED",
      error
    );
  }
}
