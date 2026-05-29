import { GatewayNotFoundError } from "../errors.js";

/**
 * Gateway registry — lazily imports adapters so SDKs are only loaded
 * when a gateway is actually used.
 */
const gateways = {
  stripe: () => import("./stripe.js"),
  paypal: () => import("./paypal.js"),
  sslcommerz: () => import("./sslcommerz.js"),
  bkash: () => import("./bkash.js"),
  nagad: () => import("./nagad.js"),
};

/**
 * Cache for already-loaded gateway modules.
 * @type {Map<string, object>}
 */
const cache = new Map();

/**
 * Get a gateway adapter by name. Lazily loads and caches the module.
 *
 * @param {string} name - Gateway name (e.g. "stripe", "bkash").
 * @returns {Promise<object>} The gateway adapter module with charge(), refund(), retrieve().
 * @throws {GatewayNotFoundError} If the gateway name is not recognized.
 */
export async function getGateway(name) {
  const normalized = name?.toLowerCase?.().trim();

  if (!normalized || !gateways[normalized]) {
    throw new GatewayNotFoundError(name);
  }

  if (cache.has(normalized)) {
    return cache.get(normalized);
  }

  const mod = await gateways[normalized]();
  cache.set(normalized, mod);
  return mod;
}

/**
 * List all supported gateway names.
 *
 * @returns {string[]}
 */
export function getSupportedGateways() {
  return Object.keys(gateways);
}
