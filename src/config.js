import { ConfigurationError, PaymentError } from "./errors.js";
import { resetCaches } from "./utils/cache.js";

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
    clientIp: "NAGAD_CLIENT_IP",
  },
};

/**
 * Required credentials per gateway.
 * If any of these are missing after resolution, a ConfigurationError is thrown.
 */
const REQUIRED_KEYS = {
  stripe: ["apiKey"],
  sslcommerz: ["storeId", "storePassword"],
  bkash: ["appKey", "appSecret", "username", "password"],
  nagad: ["merchantId", "publicKey", "privateKey"],
};

/**
 * Credential/transport keys a caller may override per call.
 *
 * Only these are lifted out of the per-call options. Merging the whole options
 * object would put business fields (amount, currency, extra, …) into the
 * credential object and let a field named like a credential silently override
 * a configured one.
 */
const CONFIG_KEYS = {
  stripe: ["apiKey", "timeoutMs"],
  sslcommerz: ["storeId", "storePassword", "sandbox", "timeoutMs"],
  bkash: [
    "appKey",
    "appSecret",
    "username",
    "password",
    "sandbox",
    "timeoutMs",
  ],
  nagad: [
    "merchantId",
    "publicKey",
    "privateKey",
    "sandbox",
    "timeoutMs",
    "clientIp",
    "baseUrl",
  ],
};

/** Keys whose values must never reach a log line. */
const SECRET_KEYS = new Set([
  "apiKey",
  "storePassword",
  "appSecret",
  "password",
  "privateKey",
]);

/**
 * Set global credentials for one or more gateways.
 * Call this once at app startup.
 *
 * @param {object} configs - An object keyed by gateway name.
 * @throws {PaymentError} If an unknown gateway name is passed.
 * @example
 * configure({
 *   stripe: { apiKey: 'sk_test_...' },
 *   bkash: { appKey: '...', appSecret: '...', username: '...', password: '...', sandbox: true },
 * });
 */
export function configure(configs) {
  if (!configs || typeof configs !== "object") {
    throw new PaymentError(
      "configure() expects an object keyed by gateway name.",
      "config",
      "INVALID_CONFIG"
    );
  }

  const known = Object.keys(ENV_MAP);
  const unknown = Object.keys(configs).filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    // A typo here would otherwise fail much later as "missing credentials".
    throw new PaymentError(
      `Unknown gateway name(s) in configure(): ${unknown.join(", ")}. ` +
        `Valid gateways: ${known.join(", ")}.`,
      "config",
      "INVALID_CONFIG"
    );
  }

  for (const [gateway, config] of Object.entries(configs)) {
    globalConfig.set(gateway, { ...config });
  }

  // Credentials changed — drop cached auth tokens and SDK clients.
  resetCaches();
}

/**
 * Clear all stored global configuration, along with any cached auth tokens
 * and gateway SDK clients derived from it.
 *
 * Useful for testing or reconfiguration.
 */
export function clearConfig() {
  globalConfig.clear();
  resetCaches();
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
 * Return a copy of a config with secret values masked.
 *
 * @param {object} config
 * @returns {object}
 */
function redact(config) {
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = SECRET_KEYS.has(key) ? "[redacted]" : value;
  }
  return out;
}

/**
 * Attach non-enumerable serializers so a stray `console.log(config)` or
 * `JSON.stringify(config)` cannot dump live credentials.
 *
 * @param {object} config
 * @returns {object} The same object.
 */
function protectSecrets(config) {
  const serialize = () => redact(config);
  Object.defineProperty(config, "toJSON", {
    value: serialize,
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(config, Symbol.for("nodejs.util.inspect.custom"), {
    value: serialize,
    enumerable: false,
    configurable: true,
  });
  return config;
}

/**
 * Resolve credentials for a gateway using the three-tier strategy:
 *   per-call options → global configure() → environment variables
 *
 * Only recognised credential/transport keys are taken from `callOptions`;
 * business fields (amount, currency, …) are left alone.
 *
 * @param {string} gatewayName - The gateway to resolve credentials for.
 * @param {object} [callOptions={}] - Per-call credential overrides.
 * @returns {object} Merged credentials object.
 * @throws {ConfigurationError} If required credentials are still missing.
 */
export function resolveConfig(gatewayName, callOptions = {}) {
  const envConfig = readEnvConfig(gatewayName);
  const globalCfg = globalConfig.get(gatewayName) || {};

  const allowed = CONFIG_KEYS[gatewayName] || [];
  const overrides = {};
  for (const key of allowed) {
    if (callOptions[key] !== undefined) {
      overrides[key] = callOptions[key];
    }
  }

  // Merge: env (lowest priority) → global → per-call (highest priority)
  const merged = { ...envConfig, ...globalCfg, ...overrides };

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

  return protectSecrets(merged);
}
