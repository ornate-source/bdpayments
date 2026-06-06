import { PaymentError } from "../errors.js";

/**
 * Higher-order function to wrap gateway methods and standardize error handling.
 *
 * @param {Function} fn - The gateway method to wrap.
 * @param {string} gateway - The gateway name.
 * @param {string} defaultErrorCode - The default error code to use if none is provided.
 * @returns {Function} Wrapped method.
 */
export function withErrorHandling(fn, gateway, defaultErrorCode) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError(
        error.message || `${gateway} operation failed`,
        gateway,
        defaultErrorCode,
        error
      );
    }
  };
}
