import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import * as sslcommerz from "../../src/gateways/sslcommerz.js";
import { mockFetch, rejectsWithCode } from "../helpers/mock-fetch.js";

const config = {
  storeId: "store123",
  storePassword: "pass123",
  sandbox: true,
};

afterEach(() => mock.restoreAll());

describe("sslcommerz.charge", () => {
  it("posts a well-formed session request and normalizes the result", async () => {
    const calls = mockFetch({
      body: {
        status: "SUCCESS",
        sessionkey: "sess_1",
        GatewayPageURL: "https://sandbox.sslcommerz.com/pay/abc",
      },
    });

    const result = await sslcommerz.charge(config, {
      amount: 1000,
      currency: "BDT",
      transactionId: "TXN-1",
      successUrl: "https://ex.com/s",
      failUrl: "https://ex.com/f",
      cancelUrl: "https://ex.com/c",
      customerName: "Jane Doe",
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /sandbox\.sslcommerz\.com\/gwprocess\/v4\/api\.php$/);
    assert.equal(calls[0].form.tran_id, "TXN-1");
    assert.equal(calls[0].form.total_amount, "1000.00");
    assert.equal(calls[0].form.cus_name, "Jane Doe");

    assert.equal(result.success, true);
    assert.equal(result.transactionId, "TXN-1");
    assert.equal(result.gatewayPageURL, "https://sandbox.sslcommerz.com/pay/abc");
  });

  it("rejects missing URLs instead of sending the string 'undefined'", async () => {
    const calls = mockFetch([]);

    const error = await rejectsWithCode(
      assert,
      () =>
        sslcommerz.charge(config, {
          amount: 1000,
          transactionId: "TXN-1",
          successUrl: "https://ex.com/s",
          // failUrl and cancelUrl omitted
        }),
      "INVALID_REQUEST"
    );

    assert.match(error.message, /failUrl/);
    assert.match(error.message, /cancelUrl/);
    assert.equal(calls.length, 0, "must not reach the network");
  });

  it("rejects a non-positive amount", async () => {
    mockFetch([]);
    await rejectsWithCode(
      assert,
      () =>
        sslcommerz.charge(config, {
          amount: 0,
          transactionId: "TXN-1",
          successUrl: "https://ex.com/s",
          failUrl: "https://ex.com/f",
          cancelUrl: "https://ex.com/c",
        }),
      "INVALID_AMOUNT"
    );
  });

  it("throws when the gateway reports a failed session init", async () => {
    mockFetch({ body: { status: "FAILED", failedreason: "Invalid store" } });

    const error = await rejectsWithCode(
      assert,
      () =>
        sslcommerz.charge(config, {
          amount: 1000,
          transactionId: "TXN-1",
          successUrl: "https://ex.com/s",
          failUrl: "https://ex.com/f",
          cancelUrl: "https://ex.com/c",
        }),
      "CHARGE_FAILED"
    );

    assert.equal(error.message, "Invalid store");
  });

  it("surfaces the HTTP status on a non-2xx response", async () => {
    mockFetch({ status: 503, body: "<html>down</html>", contentType: "text/html" });

    const error = await rejectsWithCode(
      assert,
      () =>
        sslcommerz.charge(config, {
          amount: 1000,
          transactionId: "TXN-1",
          successUrl: "https://ex.com/s",
          failUrl: "https://ex.com/f",
          cancelUrl: "https://ex.com/c",
        }),
      "CHARGE_FAILED"
    );

    assert.equal(error.status, 503);
  });
});

describe("sslcommerz.refund", () => {
  it("throws when the refund failed, even though APIConnect is DONE", async () => {
    // Regression: `APIConnect === "DONE"` only means the API was reachable.
    mockFetch({
      body: {
        APIConnect: "DONE",
        status: "failed",
        errorReason: "Refund amount exceeds transaction amount",
      },
    });

    const error = await rejectsWithCode(
      assert,
      () =>
        sslcommerz.refund(config, { transactionId: "bank_tx_1", amount: 500 }),
      "REFUND_FAILED"
    );

    assert.equal(error.message, "Refund amount exceeds transaction amount");
  });

  it("reports success only for a completed refund", async () => {
    mockFetch({
      body: {
        APIConnect: "DONE",
        status: "success",
        refund_ref_id: "ref_1",
        bank_tran_id: "bank_tx_1",
      },
    });

    const result = await sslcommerz.refund(config, {
      transactionId: "bank_tx_1",
      amount: 500,
    });

    assert.equal(result.success, true);
    assert.equal(result.refundId, "ref_1");
    assert.equal(result.status, "success");
  });

  it("does not claim success while a refund is still processing", async () => {
    mockFetch({
      body: { APIConnect: "DONE", status: "processing", refund_ref_id: "ref_2" },
    });

    const result = await sslcommerz.refund(config, {
      transactionId: "bank_tx_1",
      amount: 500,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, "processing");
  });

  it("throws when the API did not connect", async () => {
    mockFetch({ body: { APIConnect: "INVALID_REQUEST" } });

    await rejectsWithCode(
      assert,
      () => sslcommerz.refund(config, { transactionId: "bank_tx_1", amount: 500 }),
      "REFUND_FAILED"
    );
  });

  it("formats the refund amount to two decimals", async () => {
    const calls = mockFetch({ body: { APIConnect: "DONE", status: "success" } });

    await sslcommerz.refund(config, {
      transactionId: "bank_tx_1",
      amount: 0.1 + 0.2,
    });

    assert.equal(calls[0].form.refund_amount, "0.30");
  });
});

describe("sslcommerz.retrieve", () => {
  it("validates by valId over GET", async () => {
    const calls = mockFetch({
      body: {
        status: "VALID",
        tran_id: "TXN-1",
        amount: "1000.00",
        currency: "BDT",
      },
    });

    const result = await sslcommerz.retrieve(config, { valId: "val_1" });

    assert.equal(calls[0].method, "GET");
    assert.match(calls[0].url, /validationserverAPI\.php\?/);
    assert.equal(calls[0].query.val_id, "val_1");
    assert.equal(result.success, true);
    assert.equal(result.transactionId, "TXN-1");
    assert.equal(result.amount, 1000);
  });

  it("queries by transactionId over POST", async () => {
    const calls = mockFetch({
      body: { APIConnect: "DONE", element: [{ tran_id: "TXN-1", status: "VALID", amount: "50" }] },
    });

    const result = await sslcommerz.retrieve(config, { transactionId: "TXN-1" });

    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].form.tran_id, "TXN-1");
    assert.equal(result.success, true);
    assert.equal(result.amount, 50);
  });

  it("requires either transactionId or valId", async () => {
    const calls = mockFetch([]);
    await rejectsWithCode(
      assert,
      () => sslcommerz.retrieve(config, {}),
      "INVALID_REQUEST"
    );
    assert.equal(calls.length, 0);
  });

  it("reports success:false for an invalid validation", async () => {
    mockFetch({ body: { status: "INVALID_TRANSACTION" } });
    const result = await sslcommerz.retrieve(config, { valId: "val_1" });
    assert.equal(result.success, false);
  });
});
