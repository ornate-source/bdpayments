import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import * as bkash from "../../src/gateways/bkash.js";
import { mockFetch, rejectsWithCode } from "../helpers/mock-fetch.js";

const config = {
  appKey: "app_key",
  appSecret: "app_secret",
  username: "user",
  password: "pass",
  sandbox: true,
};

const tokenOk = {
  body: { statusCode: "0000", id_token: "tok_1", expires_in: "3600" },
};

beforeEach(() => bkash.clearTokenCache());
afterEach(() => mock.restoreAll());

describe("bkash.charge", () => {
  it("grants a token, creates the payment, and normalizes the result", async () => {
    const calls = mockFetch([
      tokenOk,
      {
        body: {
          statusCode: "0000",
          paymentID: "TR001",
          bkashURL: "https://bka.sh/pay/TR001",
          amount: "500.00",
          transactionStatus: "Initiated",
        },
      },
    ]);

    const result = await bkash.charge(config, {
      amount: 500,
      invoiceNumber: "INV-1",
      payerReference: "01700000000",
    });

    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/token\/grant$/);
    assert.match(calls[1].url, /\/create$/);
    assert.equal(calls[1].headers.Authorization, "tok_1");
    assert.equal(calls[1].headers["X-APP-Key"], "app_key");
    assert.equal(calls[1].json.amount, "500.00");
    assert.equal(calls[1].json.merchantInvoiceNumber, "INV-1");

    assert.equal(result.success, true);
    assert.equal(result.transactionId, "TR001");
    assert.equal(result.bkashURL, "https://bka.sh/pay/TR001");
  });

  it("formats floating-point amounts to two decimals", async () => {
    const calls = mockFetch([
      tokenOk,
      { body: { statusCode: "0000", paymentID: "TR002" } },
    ]);

    await bkash.charge(config, { amount: 0.1 + 0.2, invoiceNumber: "INV-2" });

    assert.equal(calls[1].json.amount, "0.30");
  });

  it("reuses a cached token across operations", async () => {
    const calls = mockFetch([
      tokenOk,
      { body: { statusCode: "0000", paymentID: "TR003" } },
      { body: { statusCode: "0000", paymentID: "TR003", transactionStatus: "Completed" } },
    ]);

    await bkash.charge(config, { amount: 100, invoiceNumber: "INV-3" });
    await bkash.retrieve(config, { transactionId: "TR003" });

    assert.equal(calls.length, 3, "second operation must not re-grant a token");
    assert.equal(calls.filter((c) => c.url.endsWith("/token/grant")).length, 1);
  });

  it("de-duplicates concurrent token grants", async () => {
    const calls = mockFetch([
      tokenOk,
      { body: { statusCode: "0000", paymentID: "TR004" } },
      { body: { statusCode: "0000", paymentID: "TR005" } },
    ]);

    await Promise.all([
      bkash.charge(config, { amount: 10, invoiceNumber: "INV-4" }),
      bkash.charge(config, { amount: 10, invoiceNumber: "INV-5" }),
    ]);

    assert.equal(calls.filter((c) => c.url.endsWith("/token/grant")).length, 1);
  });

  it("fails when the grant returns 200 with no id_token", async () => {
    mockFetch([{ body: { statusMessage: "Invalid credentials" } }]);

    const error = await rejectsWithCode(
      assert,
      () => bkash.charge(config, { amount: 100, invoiceNumber: "INV-6" }),
      "AUTH_FAILED"
    );

    assert.equal(error.message, "Invalid credentials");
  });

  it("does not cache a failed token grant", async () => {
    const calls = mockFetch([
      { body: { statusCode: "9999", statusMessage: "nope" } },
      { body: { statusCode: "9999", statusMessage: "nope" } },
    ]);

    await assert.rejects(() =>
      bkash.charge(config, { amount: 100, invoiceNumber: "INV-7" })
    );
    await assert.rejects(() =>
      bkash.charge(config, { amount: 100, invoiceNumber: "INV-8" })
    );

    assert.equal(calls.length, 2, "each attempt must retry the grant");
  });

  it("throws on a business-level failure", async () => {
    mockFetch([
      tokenOk,
      { body: { statusCode: "2062", statusMessage: "Insufficient balance" } },
    ]);

    const error = await rejectsWithCode(
      assert,
      () => bkash.charge(config, { amount: 100, invoiceNumber: "INV-9" }),
      "CHARGE_FAILED"
    );

    assert.equal(error.message, "Insufficient balance");
  });

  it("throws when the response carries no paymentID", async () => {
    mockFetch([tokenOk, { body: {} }]);

    await rejectsWithCode(
      assert,
      () => bkash.charge(config, { amount: 100, invoiceNumber: "INV-10" }),
      "CHARGE_FAILED"
    );
  });

  it("requires an invoiceNumber before hitting the network", async () => {
    const calls = mockFetch([]);

    await rejectsWithCode(
      assert,
      () => bkash.charge(config, { amount: 100 }),
      "INVALID_REQUEST"
    );

    assert.equal(calls.length, 0);
  });
});

describe("bkash.execute", () => {
  it("executes and returns the trxID", async () => {
    const calls = mockFetch([
      tokenOk,
      {
        body: {
          statusCode: "0000",
          paymentID: "TR001",
          trxID: "TRX99",
          amount: "500.00",
          transactionStatus: "Completed",
        },
      },
    ]);

    const result = await bkash.execute(config, { paymentID: "TR001" });

    assert.match(calls[1].url, /\/execute$/);
    assert.equal(result.transactionId, "TRX99");
    assert.equal(result.trxID, "TRX99");
    assert.equal(result.amount, 500);
  });

  it("requires a paymentID", async () => {
    mockFetch([]);
    await rejectsWithCode(
      assert,
      () => bkash.execute(config, {}),
      "INVALID_REQUEST"
    );
  });
});

describe("bkash.refund", () => {
  it("requires both transactionId and trxID", async () => {
    const calls = mockFetch([]);

    const error = await rejectsWithCode(
      assert,
      () => bkash.refund(config, { amount: 100 }),
      "INVALID_REQUEST"
    );

    assert.match(error.message, /transactionId/);
    assert.match(error.message, /trxID/);
    assert.equal(calls.length, 0);
  });

  it("throws on a refund failure", async () => {
    mockFetch([
      tokenOk,
      { body: { statusCode: "2065", statusMessage: "Refund window expired" } },
    ]);

    await rejectsWithCode(
      assert,
      () =>
        bkash.refund(config, {
          transactionId: "TR001",
          trxID: "TRX99",
          amount: 100,
        }),
      "REFUND_FAILED"
    );
  });
});

describe("bkash token invalidation", () => {
  it("retries once with a fresh token after a 401", async () => {
    const calls = mockFetch([
      tokenOk,
      { status: 401, body: { statusMessage: "Invalid token" } },
      { body: { statusCode: "0000", id_token: "tok_2", expires_in: "3600" } },
      { body: { statusCode: "0000", paymentID: "TR100" } },
    ]);

    const result = await bkash.charge(config, {
      amount: 100,
      invoiceNumber: "INV-11",
    });

    assert.equal(result.transactionId, "TR100");
    assert.equal(calls.length, 4);
    assert.equal(calls[3].headers.Authorization, "tok_2");
  });
});
