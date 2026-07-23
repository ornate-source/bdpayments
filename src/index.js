export { configure, clearConfig } from "./config.js";
export {
  PaymentError,
  GatewayNotFoundError,
  ConfigurationError,
} from "./errors.js";
export {
  getSupportedGateways,
  getGatewayCapabilities,
} from "./gateways/index.js";
export { verifySslcommerzIpn, parseNagadCallback } from "./webhooks.js";

import { resolveConfig } from "./config.js";
import { getGateway } from "./gateways/index.js";
import { PaymentError } from "./errors.js";

/**
 * Resolve an adapter and assert it implements the requested operation.
 *
 * @param {string} gateway - Gateway name.
 * @param {string} operation - Operation name ("charge", "execute", …).
 * @returns {Promise<Function>} The adapter method.
 * @throws {PaymentError} With code "UNSUPPORTED_OPERATION" if unimplemented.
 */
async function getOperation(gateway, operation) {
  const adapter = await getGateway(gateway);

  if (typeof adapter[operation] !== "function") {
    throw new PaymentError(
      `Gateway "${gateway}" does not support ${operation}().`,
      gateway,
      "UNSUPPORTED_OPERATION"
    );
  }

  return adapter[operation];
}

/**
 * Create a charge/payment through any supported gateway.
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name (e.g. "stripe", "bkash").
 * @param {string} [options.idempotencyKey] - Safe-retry key (Stripe only; the
 *   BDT gateways use their own natural keys — see the README).
 * @param {object} [options.extra] - Additional gateway-specific params.
 * @returns {Promise<object>} Normalized payment result.
 *
 * @example
 * const result = await charge({
 *   gateway: 'stripe',
 *   amount: 1000,
 *   currency: 'usd',
 *   paymentMethod: 'pm_card_visa',
 * });
 */
export async function charge({ gateway, ...options }) {
  const op = await getOperation(gateway, "charge");
  const config = resolveConfig(gateway, options);
  return op(config, options);
}

/**
 * Refund a payment through any supported gateway.
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name.
 * @param {string} options.transactionId - The transaction/payment ID to refund.
 * @param {number} [options.amount] - Partial refund amount (omit for full refund where supported).
 * @param {string} [options.idempotencyKey] - Safe-retry key (Stripe only).
 * @returns {Promise<object>} Normalized refund result.
 *
 * @example
 * const result = await refund({
 *   gateway: 'stripe',
 *   transactionId: 'pi_...',
 *   amount: 500,
 * });
 */
export async function refund({ gateway, ...options }) {
  const op = await getOperation(gateway, "refund");
  const config = resolveConfig(gateway, options);
  return op(config, options);
}

/**
 * Retrieve payment details from any supported gateway.
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name.
 * @param {string} options.transactionId - The transaction/payment ID to retrieve.
 * @returns {Promise<object>} Normalized retrieve result.
 *
 * @example
 * const result = await retrieve({
 *   gateway: 'stripe',
 *   transactionId: 'pi_...',
 * });
 */
export async function retrieve({ gateway, ...options }) {
  const op = await getOperation(gateway, "retrieve");
  const config = resolveConfig(gateway, options);
  return op(config, options);
}

/**
 * Execute a payment through any supported gateway (e.g. bKash tokenized checkout).
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name (e.g. "bkash").
 * @param {string} options.paymentID - The payment ID to execute.
 * @returns {Promise<object>} Normalized execute result.
 *
 * @example
 * const result = await execute({
 *   gateway: 'bkash',
 *   paymentID: 'TR0011...',
 * });
 */
export async function execute({ gateway, ...options }) {
  const op = await getOperation(gateway, "execute");
  const config = resolveConfig(gateway, options);
  return op(config, options);
}
