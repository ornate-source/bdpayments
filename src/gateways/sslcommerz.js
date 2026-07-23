import { httpClient } from "../utils/http.js";
import { withErrorHandling } from "../utils/wrapper.js";
import {
  requireOptions,
  requireOneOf,
  requireAmount,
  formatAmount,
} from "../utils/validate.js";
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
 * Merge caller-supplied `extra` params into a request body.
 *
 * @param {URLSearchParams} body
 * @param {object} [extra]
 */
function mergeExtra(body, extra) {
  if (!extra) return;
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }
}

/**
 * Initialize a payment session with SSLCommerz.
 *
 * `transactionId` (tran_id) is the natural idempotency key — reuse it when
 * retrying a session init.
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
export const charge = withErrorHandling(async (config, options) => {
  // URLSearchParams stringifies `undefined` to the literal "undefined", so a
  // missing URL would produce a live session pointing at "https://undefined".
  requireOptions("sslcommerz", options, [
    "transactionId",
    "successUrl",
    "failUrl",
    "cancelUrl",
  ]);
  requireAmount("sslcommerz", options.amount);

  const baseUrl = getBaseUrl(config.sandbox);

  const body = new URLSearchParams({
    store_id: config.storeId,
    store_passwd: config.storePassword,
    total_amount: formatAmount(options.amount),
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

  mergeExtra(body, options.extra);

  const result = await httpClient(
    `${baseUrl}/gwprocess/v4/api.php`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    "sslcommerz",
    "CHARGE_FAILED",
    { timeoutMs: config.timeoutMs }
  );

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
}, "sslcommerz", "CHARGE_FAILED");

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
export const refund = withErrorHandling(async (config, options) => {
  requireOptions("sslcommerz", options, ["transactionId"]);
  requireAmount("sslcommerz", options.amount);

  const baseUrl = getBaseUrl(config.sandbox);

  const body = new URLSearchParams({
    store_id: config.storeId,
    store_passwd: config.storePassword,
    bank_tran_id: options.transactionId,
    refund_amount: formatAmount(options.amount),
    refund_remarks: options.refundRemarks || "Refund requested",
    ...(options.refundRefId && { refe_id: options.refundRefId }),
  });

  mergeExtra(body, options.extra);

  const result = await httpClient(
    `${baseUrl}/validator/api/merchantTransIDvalidationAPI.php`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    "sslcommerz",
    "REFUND_FAILED",
    { timeoutMs: config.timeoutMs }
  );

  // `APIConnect: "DONE"` only means the API was reachable — SSLCommerz returns
  // it alongside `status: "failed"`. Treating it as success would report a
  // refund that never happened.
  if (result.APIConnect !== "DONE") {
    throw new PaymentError(
      result.errorReason ||
        result.APIConnect ||
        "SSLCommerz refund API did not connect",
      "sslcommerz",
      "REFUND_FAILED",
      result
    );
  }

  const status = String(result.status || "").toLowerCase();

  if (status === "failed") {
    throw new PaymentError(
      result.errorReason || "SSLCommerz refund failed",
      "sslcommerz",
      "REFUND_FAILED",
      result
    );
  }

  return {
    // "processing" is not a completed refund — report it honestly.
    success: status === "success",
    refundId: result.refund_ref_id || null,
    transactionId: options.transactionId,
    bankTransactionId: result.bank_tran_id || options.transactionId,
    status: result.status || "UNKNOWN",
    amount: options.amount,
    currency: result.currency || null,
    gatewayResponse: result,
  };
}, "sslcommerz", "REFUND_FAILED");

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
export const retrieve = withErrorHandling(async (config, options) => {
  requireOneOf("sslcommerz", options, ["transactionId", "valId"]);

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

  mergeExtra(body, options.extra);

  const result = await httpClient(
    useValId ? `${endpoint}?${body.toString()}` : endpoint,
    {
      method: useValId ? "GET" : "POST",
      ...(!useValId && {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    },
    "sslcommerz",
    "RETRIEVE_FAILED",
    { timeoutMs: config.timeoutMs }
  );

  const element = result.element?.[0] || result;

  const success = useValId
    ? result.status === "VALID" || result.status === "VALIDATED"
    : result.APIConnect === "DONE";

  return {
    success: !!success,
    transactionId: element.tran_id || options.transactionId || null,
    status: element.status || result.status || "UNKNOWN",
    amount: parseFloat(element.amount || element.currency_amount || "0"),
    currency: element.currency || null,
    gatewayResponse: result,
  };
}, "sslcommerz", "RETRIEVE_FAILED");
