import { PaymentError } from "../errors.js";

/**
 * Get the SSLCommerz API base URL.
 *
 * @param {boolean} sandbox
 * @returns {string}
 */
function getBaseUrl(sandbox) {
  return sandbox
    ? "https://sandbox.sslcommerz.com"
    : "https://securepay.sslcommerz.com";
}

/**
 * Initialize a payment session with SSLCommerz.
 *
 * @param {object} config - Resolved credentials ({ storeId, storePassword, sandbox }).
 * @param {object} options
 * @param {number} options.amount - Total amount.
 * @param {string} options.currency - Currency code (e.g. "BDT").
 * @param {string} options.transactionId - Your unique transaction/order ID.
 * @param {string} options.successUrl - URL for successful payment redirect.
 * @param {string} options.failUrl - URL for failed payment redirect.
 * @param {string} options.cancelUrl - URL for cancelled payment redirect.
 * @param {string} [options.ipnUrl] - Instant Payment Notification URL.
 * @param {string} [options.customerName] - Customer name.
 * @param {string} [options.customerEmail] - Customer email.
 * @param {string} [options.customerPhone] - Customer phone.
 * @param {string} [options.customerAddress] - Customer address.
 * @param {string} [options.customerCity] - Customer city.
 * @param {string} [options.customerCountry] - Customer country.
 * @param {string} [options.productName] - Product name.
 * @param {string} [options.productCategory] - Product category (e.g. "general").
 * @param {string} [options.productProfile] - Product profile (e.g. "general").
 * @param {string} [options.shippingMethod] - Shipping method.
 * @param {object} [options.extra] - Additional params merged into the request body.
 * @returns {Promise<object>} Normalized payment result with gateway URL.
 */
export async function charge(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);

    const body = new URLSearchParams({
      store_id: config.storeId,
      store_passwd: config.storePassword,
      total_amount: String(options.amount),
      currency: options.currency || "BDT",
      tran_id: options.transactionId,
      success_url: options.successUrl,
      fail_url: options.failUrl,
      cancel_url: options.cancelUrl,
      ...(options.ipnUrl && { ipn_url: options.ipnUrl }),
      cus_name: options.customerName || "N/A",
      cus_email: options.customerEmail || "N/A",
      cus_phone: options.customerPhone || "N/A",
      cus_add1: options.customerAddress || "N/A",
      cus_city: options.customerCity || "N/A",
      cus_country: options.customerCountry || "Bangladesh",
      product_name: options.productName || "N/A",
      product_category: options.productCategory || "general",
      product_profile: options.productProfile || "general",
      shipping_method: options.shippingMethod || "NO",
    });

    // Merge extra params
    if (options.extra) {
      for (const [key, value] of Object.entries(options.extra)) {
        body.set(key, String(value));
      }
    }

    const response = await fetch(
      `${baseUrl}/gwprocess/v4/api.php`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );

    if (!response.ok) {
      throw new PaymentError(
        "SSLCommerz API request failed",
        "sslcommerz",
        "CHARGE_FAILED"
      );
    }

    const result = await response.json();

    if (result.status !== "SUCCESS") {
      throw new PaymentError(
        result.failedreason || "SSLCommerz session init failed",
        "sslcommerz",
        "CHARGE_FAILED",
        result
      );
    }

    return {
      success: true,
      transactionId: options.transactionId,
      sessionKey: result.sessionkey,
      status: result.status,
      amount: options.amount,
      currency: options.currency || "BDT",
      gatewayPageURL: result.GatewayPageURL,
      redirectGatewayURL: result.redirectGatewayURL || null,
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "SSLCommerz charge failed",
      "sslcommerz",
      "CHARGE_FAILED",
      error
    );
  }
}

/**
 * Refund an SSLCommerz transaction.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The bank transaction ID to refund.
 * @param {number} options.amount - Refund amount.
 * @param {string} [options.refundRemarks] - Remarks for the refund.
 * @param {string} [options.refundRefId] - Your reference ID for the refund.
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized refund result.
 */
export async function refund(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);

    const body = new URLSearchParams({
      store_id: config.storeId,
      store_passwd: config.storePassword,
      bank_tran_id: options.transactionId,
      refund_amount: String(options.amount),
      refund_remarks: options.refundRemarks || "Refund requested",
      ...(options.refundRefId && { refe_id: options.refundRefId }),
    });

    if (options.extra) {
      for (const [key, value] of Object.entries(options.extra)) {
        body.set(key, String(value));
      }
    }

    const response = await fetch(
      `${baseUrl}/validator/api/merchantTransIDvalidationAPI.php`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );

    if (!response.ok) {
      throw new PaymentError(
        "SSLCommerz refund API request failed",
        "sslcommerz",
        "REFUND_FAILED"
      );
    }

    const result = await response.json();

    return {
      success: result.status === "success" || result.APIConnect === "DONE",
      refundId: result.refund_ref_id || null,
      transactionId: options.transactionId,
      status: result.status || "UNKNOWN",
      amount: options.amount,
      currency: null,
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "SSLCommerz refund failed",
      "sslcommerz",
      "REFUND_FAILED",
      error
    );
  }
}

/**
 * Retrieve/validate an SSLCommerz transaction.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} [options.transactionId] - The transaction ID to query (optional if valId is provided).
 * @param {string} [options.valId] - The validation ID to query (optional if transactionId is provided).
 * @param {object} [options.extra] - Additional params.
 * @returns {Promise<object>} Normalized retrieve result.
 */
export async function retrieve(config, options) {
  try {
    const baseUrl = getBaseUrl(config.sandbox);
    const useValId = !!options.valId;

    const body = new URLSearchParams({
      store_id: config.storeId,
      store_passwd: config.storePassword,
    });

    let endpoint;
    if (useValId) {
      body.set("val_id", options.valId);
      body.set("v", "1");
      body.set("format", "json");
      endpoint = `${baseUrl}/validator/api/validationserverAPI.php`;
    } else {
      body.set("tran_id", options.transactionId);
      endpoint = `${baseUrl}/validator/api/merchantTransIDvalidationAPI.php`;
    }

    if (options.extra) {
      for (const [key, value] of Object.entries(options.extra)) {
        body.set(key, String(value));
      }
    }

    const response = await fetch(
      useValId ? `${endpoint}?${body.toString()}` : endpoint,
      {
        method: useValId ? "GET" : "POST",
        ...(!useValId && {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        }),
      }
    );

    if (!response.ok) {
      throw new PaymentError(
        "SSLCommerz retrieve API request failed",
        "sslcommerz",
        "RETRIEVE_FAILED"
      );
    }

    const result = await response.json();
    const element = result.element?.[0] || result;

    const success = useValId
      ? (result.status === "VALID" || result.status === "VALIDATED")
      : result.APIConnect === "DONE";

    return {
      success: !!success,
      transactionId: element.tran_id || options.transactionId || null,
      status: element.status || result.status || "UNKNOWN",
      amount: parseFloat(element.amount || element.currency_amount || "0"),
      currency: element.currency || null,
      gatewayResponse: result,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      error.message || "SSLCommerz retrieve failed",
      "sslcommerz",
      "RETRIEVE_FAILED",
      error
    );
  }
}
