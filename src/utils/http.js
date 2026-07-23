import { PaymentError } from "../errors.js";

/** Default request timeout. Node's fetch has none, so a stalled gateway would hang forever. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Make an HTTP request and parse the JSON response.
 * Throws a PaymentError if the request fails, times out, or the response is not OK.
 *
 * @param {string} url - The URL to fetch.
 * @param {object} options - Fetch options.
 * @param {string} gateway - Gateway name for error reporting.
 * @param {string} defaultErrorCode - Default error code if the request fails.
 * @param {object} [settings]
 * @param {number} [settings.timeoutMs] - Abort the request after this many ms.
 * @returns {Promise<any>}
 */
export async function httpClient(
  url,
  options,
  gateway,
  defaultErrorCode,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: options?.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    throw new PaymentError(
      timedOut
        ? `${gateway} request timed out after ${timeoutMs}ms`
        : `${gateway} network request failed: ${error?.message || error}`,
      gateway,
      timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      error
    );
  }

  let responseData;
  const contentType = response.headers.get("content-type");
  try {
    if (contentType && contentType.includes("application/json")) {
      responseData = await response.json();
    } else {
      const text = await response.text();
      // Try parsing as JSON in case the content-type is missing or wrong
      try {
        responseData = JSON.parse(text);
      } catch {
        responseData = { text };
      }
    }
  } catch {
    responseData = {};
  }

  if (!response.ok) {
    const error = new PaymentError(
      responseData?.statusMessage ||
        responseData?.message ||
        `${gateway} API request failed with HTTP ${response.status}`,
      gateway,
      defaultErrorCode,
      responseData
    );
    error.status = response.status;
    throw error;
  }

  return responseData;
}
