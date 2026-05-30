export { configure, clearConfig } from "./config.js";
export {
  PaymentError,
  GatewayNotFoundError,
  ConfigurationError,
} from "./errors.js";
export { getSupportedGateways } from "./gateways/index.js";

import { resolveConfig } from "./config.js";
import { getGateway } from "./gateways/index.js";

/**
 * Create a charge/payment through any supported gateway.
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name (e.g. "stripe", "bkash").
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
  const adapter = await getGateway(gateway);
  const config = resolveConfig(gateway, options);
  return adapter.charge(config, options);
}

/**
 * Refund a payment through any supported gateway.
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name.
 * @param {string} options.transactionId - The transaction/payment ID to refund.
 * @param {number} [options.amount] - Partial refund amount (omit for full refund where supported).
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
  const adapter = await getGateway(gateway);
  const config = resolveConfig(gateway, options);
  return adapter.refund(config, options);
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
  const adapter = await getGateway(gateway);
  const config = resolveConfig(gateway, options);
  return adapter.retrieve(config, options);
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
  const adapter = await getGateway(gateway);
  if (typeof adapter.execute !== "function") {
    throw new Error(`Gateway "${gateway}" does not support execute()`);
  }
  const config = resolveConfig(gateway, options);
  return adapter.execute(config, options);
}
