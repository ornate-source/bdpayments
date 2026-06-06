import { PaymentError } from "../errors.js";

/**
 * Make an HTTP request and parse the JSON response.
 * Throws a PaymentError if the response is not OK.
 *
 * @param {string} url - The URL to fetch.
 * @param {object} options - Fetch options.
 * @param {string} gateway - Gateway name for error reporting.
 * @param {string} defaultErrorCode - Default error code if the request fails.
 * @returns {Promise<any>}
 */
export async function httpClient(url, options, gateway, defaultErrorCode) {
  const response = await fetch(url, options);

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
  } catch (error) {
    responseData = {};
  }

  if (!response.ok) {
    throw new PaymentError(
      responseData.statusMessage || responseData.message || `${gateway} API request failed`,
      gateway,
      defaultErrorCode,
      responseData
    );
  }

  return responseData;
}
