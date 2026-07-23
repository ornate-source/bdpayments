import { withErrorHandling } from "../utils/wrapper.js";
import { registerCache } from "../utils/cache.js";
import { requireOptions, requireAmount } from "../utils/validate.js";
import { PaymentError } from "../errors.js";

/**
 * Cached Stripe SDK clients, keyed by API key. Constructing a client per call
 * would allocate a fresh HTTP agent and give up connection reuse.
 *
 * @type {Map<string, any>}
 */
const clients = new Map();

registerCache(() => clients.clear());

/**
 * Get (or build) a Stripe SDK instance for the resolved config.
 *
 * @param {object} config - Resolved credentials ({ apiKey }).
 * @returns {Promise<any>} The Stripe client.
 */
async function createClient(config) {
  const cached = clients.get(config.apiKey);
  if (cached) return cached;

  let mod;
  try {
    mod = await import("stripe");
  } catch (error) {
    throw new PaymentError(
      'The "stripe" peer dependency is not installed. Run: npm install stripe',
      "stripe",
      "MISSING_DEPENDENCY",
      error
    );
  }

  // `stripe` v12+ exports the constructor as the default export.
  const Stripe = mod.default || mod;
  const client = new Stripe(config.apiKey, { maxNetworkRetries: 2 });
  clients.set(config.apiKey, client);
  return client;
}

/**
 * Build the per-request options Stripe accepts as its second argument.
 *
 * @param {object} options
 * @returns {object|undefined}
 */
function requestOptions(options) {
  return options.idempotencyKey
    ? { idempotencyKey: options.idempotencyKey }
    : undefined;
}

/**
 * Create a charge (Payment Intent) via Stripe.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {number} options.amount - Amount in the smallest currency unit (e.g. cents).
 * @param {string} options.currency - ISO currency code (e.g. "usd").
 * @param {string} [options.paymentMethod] - Payment method ID.
 * @param {string} [options.customer] - Customer ID.
 * @param {string} [options.description] - Payment description.
 * @param {object} [options.metadata] - Arbitrary metadata.
 * @param {boolean} [options.confirm] - Whether to confirm the payment intent immediately.
 * @param {string} [options.returnUrl] - Return URL for redirect-based payment methods.
 * @param {string} [options.idempotencyKey] - Safe-retry key sent to Stripe.
 * @param {object} [options.extra] - Any additional params passed directly to the Stripe API.
 * @returns {Promise<object>} Normalized payment result.
 */
export const charge = withErrorHandling(async (config, options) => {
  requireOptions("stripe", options, ["currency"]);
  requireAmount("stripe", options.amount, { integer: true });

  const stripe = await createClient(config);

  const params = {
    amount: options.amount,
    currency: options.currency,
    ...(options.paymentMethod && {
      payment_method: options.paymentMethod,
    }),
    ...(options.customer && { customer: options.customer }),
    ...(options.description && { description: options.description }),
    ...(options.metadata && { metadata: options.metadata }),
    ...(options.confirm !== undefined && { confirm: options.confirm }),
    ...(options.returnUrl && {
      return_url: options.returnUrl,
    }),
    ...options.extra,
  };

  const paymentIntent = await stripe.paymentIntents.create(
    params,
    requestOptions(options)
  );

  return {
    success: true,
    transactionId: paymentIntent.id,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    gatewayResponse: paymentIntent,
  };
}, "stripe", "CHARGE_FAILED");

/**
 * Refund a Stripe payment.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The Payment Intent ID to refund.
 * @param {number} [options.amount] - Partial refund amount (omit for full refund).
 * @param {string} [options.reason] - Reason for refund.
 * @param {string} [options.idempotencyKey] - Safe-retry key sent to Stripe.
 * @param {object} [options.extra] - Additional params passed to the Stripe API.
 * @returns {Promise<object>} Normalized refund result.
 */
export const refund = withErrorHandling(async (config, options) => {
  requireOptions("stripe", options, ["transactionId"]);
  if (options.amount !== undefined) {
    requireAmount("stripe", options.amount, { integer: true });
  }

  const stripe = await createClient(config);

  const params = {
    payment_intent: options.transactionId,
    ...(options.amount !== undefined && { amount: options.amount }),
    ...(options.reason && { reason: options.reason }),
    ...options.extra,
  };

  const refundResult = await stripe.refunds.create(
    params,
    requestOptions(options)
  );

  return {
    success: true,
    refundId: refundResult.id,
    transactionId: options.transactionId,
    status: refundResult.status,
    amount: refundResult.amount,
    currency: refundResult.currency,
    gatewayResponse: refundResult,
  };
}, "stripe", "REFUND_FAILED");

/**
 * Retrieve a Stripe Payment Intent by ID.
 *
 * @param {object} config - Resolved credentials.
 * @param {object} options
 * @param {string} options.transactionId - The Payment Intent ID to retrieve.
 * @param {object} [options.extra] - Additional params passed to the Stripe API.
 * @returns {Promise<object>} Normalized retrieve result.
 */
export const retrieve = withErrorHandling(async (config, options) => {
  requireOptions("stripe", options, ["transactionId"]);

  const stripe = await createClient(config);

  const paymentIntent = await stripe.paymentIntents.retrieve(
    options.transactionId,
    options.extra || {}
  );

  return {
    success: true,
    transactionId: paymentIntent.id,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    gatewayResponse: paymentIntent,
  };
}, "stripe", "RETRIEVE_FAILED");
