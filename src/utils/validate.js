import { PaymentError } from "../errors.js";

/**
 * Assert that every required option is present and non-empty.
 *
 * Without this, missing options reach the gateway as the literal string
 * "undefined" (URLSearchParams), as a dropped JSON key, or interpolated into a
 * request path — all of which produce confusing downstream failures instead of
 * a clear client-side error.
 *
 * @param {string} gateway - Gateway name, for error reporting.
 * @param {object} options - The caller-supplied options.
 * @param {string[]} keys - Option names that must be present.
 * @throws {PaymentError} With code "INVALID_REQUEST" if any are missing.
 */
export function requireOptions(gateway, options, keys) {
  const missing = keys.filter((key) => {
    const value = options?.[key];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new PaymentError(
      `Missing required option(s) for ${gateway}: ${missing.join(", ")}.`,
      gateway,
      "INVALID_REQUEST"
    );
  }
}

/**
 * Assert that at least one of the given options is present.
 *
 * @param {string} gateway - Gateway name, for error reporting.
 * @param {object} options - The caller-supplied options.
 * @param {string[]} keys - Option names, one of which must be present.
 * @throws {PaymentError} With code "INVALID_REQUEST" if none are present.
 */
export function requireOneOf(gateway, options, keys) {
  const present = keys.some((key) => {
    const value = options?.[key];
    return value !== undefined && value !== null && value !== "";
  });

  if (!present) {
    throw new PaymentError(
      `${gateway} requires one of: ${keys.join(", ")}.`,
      gateway,
      "INVALID_REQUEST"
    );
  }
}

/**
 * Assert that an amount is a usable positive number.
 *
 * @param {string} gateway - Gateway name, for error reporting.
 * @param {any} amount - The amount to validate.
 * @param {object} [opts]
 * @param {boolean} [opts.integer=false] - Require an integer (minor currency units).
 * @throws {PaymentError} With code "INVALID_AMOUNT" if the amount is unusable.
 */
export function requireAmount(gateway, amount, { integer = false } = {}) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new PaymentError(
      `Invalid amount for ${gateway}: expected a positive finite number, got ${JSON.stringify(
        amount
      )}.`,
      gateway,
      "INVALID_AMOUNT"
    );
  }

  if (integer && !Number.isInteger(amount)) {
    throw new PaymentError(
      `Invalid amount for ${gateway}: expected an integer in the smallest currency unit, got ${amount}.`,
      gateway,
      "INVALID_AMOUNT"
    );
  }
}

/**
 * Format a decimal amount the way the BDT gateways expect.
 *
 * `String(0.1 + 0.2)` yields "0.30000000000000004", which bKash, SSLCommerz and
 * Nagad all reject. They accept at most two decimal places.
 *
 * @param {number} amount
 * @returns {string} e.g. "500.00"
 */
export function formatAmount(amount) {
  return Number(amount).toFixed(2);
}
