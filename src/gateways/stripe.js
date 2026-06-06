import { withErrorHandling } from "../utils/wrapper.js";

/**
 * Initialize a Stripe SDK instance from the resolved config.
 *
 * @param {object} config - Resolved credentials ({ apiKey }).
 * @returns {import('stripe').default}
 */
function createClient(config) {
  const Stripe = /** @type {any} */ (
    /** @type {Function} */ (
      // Dynamic require-style — the `stripe` peer dependency must be installed.
      // eslint-disable-next-line
      import("stripe")
    )
  );
  // `stripe` v14+ exports default as the constructor
  return Stripe.then
    ? Stripe.then((m) => new (m.default || m)(config.apiKey))
    : new Stripe(config.apiKey);
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
 * @param {object} [options.extra] - Any additional params passed directly to the Stripe API.
 * @returns {Promise<object>} Normalized payment result.
 */
export const charge = withErrorHandling(async (config, options) => {
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

  const paymentIntent = await stripe.paymentIntents.create(params);

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
 * @param {object} [options.extra] - Additional params passed to the Stripe API.
 * @returns {Promise<object>} Normalized refund result.
 */
export const refund = withErrorHandling(async (config, options) => {
  const stripe = await createClient(config);

  const params = {
    payment_intent: options.transactionId,
    ...(options.amount && { amount: options.amount }),
    ...(options.reason && { reason: options.reason }),
    ...options.extra,
  };

  const refundResult = await stripe.refunds.create(params);

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
