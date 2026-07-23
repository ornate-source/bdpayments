import { GatewayNotFoundError } from "../errors.js";

/**
 * Gateway registry — lazily imports adapters so SDKs are only loaded
 * when a gateway is actually used.
 */
const gateways = {
  stripe: () => import("./stripe.js"),
  sslcommerz: () => import("./sslcommerz.js"),
  bkash: () => import("./bkash.js"),
  nagad: () => import("./nagad.js"),
};

/** The operations an adapter may implement. */
const OPERATIONS = ["charge", "execute", "refund", "retrieve"];

/**
 * Cache for already-loaded gateway modules.
 * @type {Map<string, object>}
 */
const cache = new Map();

/**
 * Normalize a caller-supplied gateway name.
 *
 * @param {any} name
 * @returns {string|undefined}
 */
function normalize(name) {
  return typeof name === "string" ? name.toLowerCase().trim() : undefined;
}

/**
 * Get a gateway adapter by name. Lazily loads and caches the module.
 *
 * @param {string} name - Gateway name (e.g. "stripe", "bkash").
 * @returns {Promise<object>} The gateway adapter module with charge(), refund(), retrieve().
 * @throws {GatewayNotFoundError} If the gateway name is not recognized.
 */
export async function getGateway(name) {
  const normalized = normalize(name);

  if (!normalized || !gateways[normalized]) {
    throw new GatewayNotFoundError(name, getSupportedGateways());
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

/**
 * Report which operations a gateway supports.
 *
 * @param {string} name - Gateway name.
 * @returns {Promise<{charge: boolean, execute: boolean, refund: boolean, retrieve: boolean}>}
 * @throws {GatewayNotFoundError} If the gateway name is not recognized.
 */
export async function getGatewayCapabilities(name) {
  const adapter = await getGateway(name);
  return Object.fromEntries(
    OPERATIONS.map((op) => [op, typeof adapter[op] === "function"])
  );
}
