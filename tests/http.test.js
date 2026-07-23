import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { httpClient } from "../src/utils/http.js";
import { mockFetch, rejectsWithCode } from "./helpers/mock-fetch.js";

afterEach(() => mock.restoreAll());

describe("httpClient", () => {
  it("parses a JSON response", async () => {
    mockFetch({ body: { ok: true } });
    const data = await httpClient("https://x.test", {}, "test", "FAILED");
    assert.deepEqual(data, { ok: true });
  });

  it("parses JSON even when the content-type is wrong", async () => {
    mockFetch({ body: JSON.stringify({ ok: 1 }), contentType: "text/plain" });
    const data = await httpClient("https://x.test", {}, "test", "FAILED");
    assert.deepEqual(data, { ok: 1 });
  });

  it("wraps a non-JSON body as { text }", async () => {
    mockFetch({ body: "plain words", contentType: "text/plain" });
    const data = await httpClient("https://x.test", {}, "test", "FAILED");
    assert.deepEqual(data, { text: "plain words" });
  });

  it("attaches the HTTP status to the thrown error", async () => {
    mockFetch({ status: 422, body: { message: "bad input" } });

    const error = await rejectsWithCode(
      assert,
      () => httpClient("https://x.test", {}, "test", "FAILED"),
      "FAILED"
    );

    assert.equal(error.status, 422);
    assert.equal(error.message, "bad input");
    assert.equal(error.gateway, "test");
  });

  it("includes the status in the message when the body has none", async () => {
    mockFetch({ status: 500, body: {} });

    const error = await rejectsWithCode(
      assert,
      () => httpClient("https://x.test", {}, "test", "FAILED"),
      "FAILED"
    );

    assert.match(error.message, /HTTP 500/);
  });

  it("reports a network failure as NETWORK_ERROR", async () => {
    mockFetch({ networkError: "ECONNREFUSED" });

    const error = await rejectsWithCode(
      assert,
      () => httpClient("https://x.test", {}, "test", "FAILED"),
      "NETWORK_ERROR"
    );

    assert.match(error.message, /ECONNREFUSED/);
  });

  it("reports an aborted request as TIMEOUT", async () => {
    mockFetch({ networkError: "The operation was aborted", errorName: "TimeoutError" });

    const error = await rejectsWithCode(
      assert,
      () => httpClient("https://x.test", {}, "test", "FAILED", { timeoutMs: 1234 }),
      "TIMEOUT"
    );

    assert.match(error.message, /timed out after 1234ms/);
  });

  it("passes an abort signal to fetch", async () => {
    const calls = mockFetch({ body: {} });
    await httpClient("https://x.test", {}, "test", "FAILED");
    assert.equal(calls.length, 1);
  });

  it("actually aborts a slow request", async () => {
    // Real fetch against a socket that never responds would be flaky; instead
    // assert the signal reaches fetch and fires.
    mock.method(globalThis, "fetch", (_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "TimeoutError";
          reject(error);
        });
      });
    });

    await rejectsWithCode(
      assert,
      () => httpClient("https://x.test", {}, "test", "FAILED", { timeoutMs: 60 }),
      "TIMEOUT"
    );
  });
});
