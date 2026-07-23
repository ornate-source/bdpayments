import { mock } from "node:test";

/**
 * Replace global fetch with a scripted queue of responses.
 *
 * @param {Array<object>|object} responses - One spec per expected call:
 *   `{ status?, body?, contentType?, networkError?, errorName? }`.
 * @returns {Array<object>} Live array of recorded calls (url, method, headers, body, json, form).
 */
export function mockFetch(responses) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls = [];

  mock.method(globalThis, "fetch", async (url, options = {}) => {
    const spec = queue.shift();

    calls.push({
      url: String(url),
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      json: parseJson(options.body),
      form: parseForm(options.body),
      query: parseQuery(String(url)),
    });

    if (!spec) {
      throw new Error(`Unexpected fetch call #${calls.length} to ${url}`);
    }

    if (spec.networkError) {
      const error = new Error(spec.networkError);
      error.name = spec.errorName || "TypeError";
      throw error;
    }

    const { status = 200, body = {}, contentType = "application/json" } = spec;

    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      {
        status,
        headers: contentType ? { "content-type": contentType } : {},
      }
    );
  });

  return calls;
}

function parseJson(body) {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function parseForm(body) {
  if (typeof body !== "string" || body.trim().startsWith("{")) return undefined;
  return Object.fromEntries(new URLSearchParams(body));
}

function parseQuery(url) {
  const index = url.indexOf("?");
  if (index === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(index + 1)));
}

/**
 * Assert that a promise rejects with a PaymentError carrying the given code.
 *
 * @param {import('node:assert')} assert
 * @param {() => Promise<any>} fn
 * @param {string} code
 * @returns {Promise<Error>} The rejected error, for further assertions.
 */
export async function rejectsWithCode(assert, fn, code) {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected rejection with code ${code}, but it resolved`);
  assert.equal(
    caught.code,
    code,
    `expected code ${code}, got ${caught.code} (${caught.message})`
  );
  return caught;
}
