import { ConfigurationError } from "./errors.js";

/**
 * Module-level credential store.
 * @type {Map<string, object>}
 */
const globalConfig = new Map();

/**
 * Maps gateway names to their environment variable names.
 * Each entry maps a config key → env var name.
 */
const ENV_MAP = {
  stripe: {
    apiKey: "STRIPE_API_KEY",
  },
  paypal: {
    clientId: "PAYPAL_CLIENT_ID",
    clientSecret: "PAYPAL_CLIENT_SECRET",
    sandbox: "PAYPAL_SANDBOX",
  },

  sslcommerz: {
    storeId: "SSLCOMMERZ_STORE_ID",
    storePassword: "SSLCOMMERZ_STORE_PASSWORD",
    sandbox: "SSLCOMMERZ_SANDBOX",
  },
  bkash: {
    appKey: "BKASH_APP_KEY",
    appSecret: "BKASH_APP_SECRET",
    username: "BKASH_USERNAME",
    password: "BKASH_PASSWORD",
    sandbox: "BKASH_SANDBOX",
  },
  nagad: {
    merchantId: "NAGAD_MERCHANT_ID",
    publicKey: "NAGAD_PUBLIC_KEY",
    privateKey: "NAGAD_PRIVATE_KEY",
    sandbox: "NAGAD_SANDBOX",
  },
};

/**
 * Required credentials per gateway.
 * If any of these are missing after resolution, a ConfigurationError is thrown.
 */
const REQUIRED_KEYS = {
  stripe: ["apiKey"],
  paypal: ["clientId", "clientSecret"],

  sslcommerz: ["storeId", "storePassword"],
  bkash: ["appKey", "appSecret", "username", "password"],
  nagad: ["merchantId", "publicKey", "privateKey"],
};

/**
 * Set global credentials for one or more gateways.
 * Call this once at app startup.
 *
 * @param {object} configs - An object keyed by gateway name.
 * @example
 * configure({
 *   stripe: { apiKey: 'sk_test_...' },
 *   bkash: { appKey: '...', appSecret: '...', username: '...', password: '...', sandbox: true },
 * });
 */
export function configure(configs) {
  for (const [gateway, config] of Object.entries(configs)) {
    globalConfig.set(gateway, { ...config });
  }
}

/**
 * Clear all stored global configuration.
 * Useful for testing or reconfiguration.
 */
export function clearConfig() {
  globalConfig.clear();
}

/**
 * Read environment variables for a given gateway.
 *
 * @param {string} gatewayName
 * @returns {object} Resolved config from env vars (only includes keys that are set).
 */
function readEnvConfig(gatewayName) {
  const envMapping = ENV_MAP[gatewayName];
  if (!envMapping) return {};

  const envConfig = {};
  for (const [key, envVar] of Object.entries(envMapping)) {
    const value = process.env[envVar];
    if (value !== undefined && value !== "") {
      // Convert "true"/"false" strings to booleans for sandbox flags
      if (key === "sandbox") {
        envConfig[key] = value === "true" || value === "1";
      } else {
        envConfig[key] = value;
      }
    }
  }
  return envConfig;
}

/**
 * Resolve credentials for a gateway using the three-tier strategy:
 *   per-call options → global configure() → environment variables
 *
 * @param {string} gatewayName - The gateway to resolve credentials for.
 * @param {object} [callOptions={}] - Per-call credential overrides.
 * @returns {object} Merged credentials object.
 * @throws {ConfigurationError} If required credentials are still missing.
 */
export function resolveConfig(gatewayName, callOptions = {}) {
  const envConfig = readEnvConfig(gatewayName);
  const globalCfg = globalConfig.get(gatewayName) || {};

  // Merge: env (lowest priority) → global → per-call (highest priority)
  const merged = { ...envConfig, ...globalCfg, ...callOptions };

  // Default sandbox to false if not explicitly set
  if (merged.sandbox === undefined) {
    merged.sandbox = false;
  }

  // Validate required keys
  const required = REQUIRED_KEYS[gatewayName] || [];
  const missing = required.filter((key) => !merged[key]);

  if (missing.length > 0) {
    throw new ConfigurationError(gatewayName, missing);
  }

  return merged;
}
