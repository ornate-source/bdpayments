import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import * as nagad from "../../src/gateways/nagad.js";
import { mockFetch, rejectsWithCode } from "../helpers/mock-fetch.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const config = {
  merchantId: "M123",
  publicKey,
  privateKey,
  sandbox: true,
};

/** Encrypt a payload the way Nagad would, so the adapter can decrypt it. */
function encryptForMerchant(payload) {
  return crypto
    .publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(JSON.stringify(payload), "utf-8")
    )
    .toString("base64");
}

afterEach(() => mock.restoreAll());

describe("nagad.charge", () => {
  it("completes the two-step checkout and normalizes the result", async () => {
    const calls = mockFetch([
      {
        body: {
          sensitiveData: encryptForMerchant({
            paymentReferenceId: "PRF1",
            challenge: "chal-response",
          }),
        },
      },
      {
        body: {
          status: "Success",
          paymentRefId: "PRF1",
          callBackUrl: "https://mynagad.com/pay/PRF1",
        },
      },
    ]);

    const result = await nagad.charge(config, {
      amount: 500,
      orderId: "ORD-1",
      callbackURL: "https://ex.com/cb",
    });

    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /check-out\/initialize\/M123\/ORD-1$/);
    assert.match(calls[1].url, /check-out\/complete\/PRF1$/);
    assert.equal(result.success, true);
    assert.equal(result.transactionId, "PRF1");
    assert.equal(result.callBackUrl, "https://mynagad.com/pay/PRF1");
  });

  it("sends the Bangladesh-local timestamp, not UTC", async () => {
    const calls = mockFetch([
      {
        body: {
          sensitiveData: encryptForMerchant({
            paymentReferenceId: "PRF2",
            challenge: "c",
          }),
        },
      },
      { body: { status: "Success", paymentRefId: "PRF2" } },
    ]);

    await nagad.charge(config, { amount: 100, orderId: "ORD-2" });

    const sent = calls[0].json.dateTime;
    const expected = new Date(Date.now() + 6 * 3_600_000)
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 12); // minute precision, to stay stable across the call

    assert.equal(sent.length, 14);
    assert.equal(sent.slice(0, 12), expected);
  });

  it("uses the configured client IP header", async () => {
    const calls = mockFetch([
      {
        body: {
          sensitiveData: encryptForMerchant({
            paymentReferenceId: "PRF3",
            challenge: "c",
          }),
        },
      },
      { body: { status: "Success", paymentRefId: "PRF3" } },
    ]);

    await nagad.charge(
      { ...config, clientIp: "203.0.113.9" },
      { amount: 100, orderId: "ORD-3" }
    );

    assert.equal(calls[0].headers["X-KM-IP-V4"], "203.0.113.9");
  });

  it("throws when initialization reports a reason", async () => {
    mockFetch([{ body: { reason: "Merchant_Not_Found", message: "Unknown merchant" } }]);

    const error = await rejectsWithCode(
      assert,
      () => nagad.charge(config, { amount: 100, orderId: "ORD-4" }),
      "CHARGE_FAILED"
    );

    assert.equal(error.message, "Unknown merchant");
  });

  it("requires an orderId before hitting the network", async () => {
    const calls = mockFetch([]);

    await rejectsWithCode(
      assert,
      () => nagad.charge(config, { amount: 100 }),
      "INVALID_REQUEST"
    );

    assert.equal(calls.length, 0);
  });

  it("explains a PKCS#1 decrypt failure", async () => {
    mockFetch([{ body: { sensitiveData: "not-valid-ciphertext" } }]);

    const error = await rejectsWithCode(
      assert,
      () => nagad.charge(config, { amount: 100, orderId: "ORD-5" }),
      "CHARGE_FAILED"
    );

    assert.match(error.message, /decrypt/i);
    assert.match(error.message, /CVE-2023-46809/);
  });
});

describe("nagad.refund", () => {
  it("throws when Nagad reports a failure reason", async () => {
    // Regression: refund used to return success:true for any 2xx response.
    mockFetch([{ body: { reason: "Refund_Not_Allowed", message: "Too late" } }]);

    const error = await rejectsWithCode(
      assert,
      () => nagad.refund(config, { transactionId: "PRF1", amount: 100 }),
      "REFUND_FAILED"
    );

    assert.equal(error.message, "Too late");
  });

  it("throws on status Failed", async () => {
    mockFetch([{ body: { status: "Failed" } }]);

    await rejectsWithCode(
      assert,
      () => nagad.refund(config, { transactionId: "PRF1", amount: 100 }),
      "REFUND_FAILED"
    );
  });

  it("signs a canonical payload and sends extras outside it", async () => {
    const calls = mockFetch([
      { body: { status: "Success", refundPaymentReferenceId: "RF1" } },
    ]);

    const result = await nagad.refund(config, {
      transactionId: "PRF1",
      amount: 100,
      referenceId: "REF-1",
      extra: { note: "partial" },
    });

    const signature = calls[0].headers["X-KM-SIGNATURE"];
    const canonical = JSON.stringify({
      merchantId: "M123",
      originalPaymentReferenceId: "PRF1",
      refundAmount: "100.00",
      referenceId: "REF-1",
      reason: "Refund requested",
    });

    const verify = crypto.createVerify("SHA256");
    verify.update(canonical);
    verify.end();

    assert.ok(
      verify.verify(publicKey, signature, "base64"),
      "signature must cover exactly the canonical payload"
    );
    assert.equal(calls[0].json.note, "partial", "extras still travel in the body");
    assert.equal(result.refundId, "RF1");
  });
});

describe("nagad.retrieve", () => {
  it("throws when verification reports a reason", async () => {
    mockFetch([{ body: { reason: "Payment_Not_Found", message: "No such payment" } }]);

    await rejectsWithCode(
      assert,
      () => nagad.retrieve(config, { transactionId: "PRF404" }),
      "RETRIEVE_FAILED"
    );
  });

  it("reports success only for a successful payment", async () => {
    mockFetch([{ body: { status: "Success", paymentRefId: "PRF1", amount: "250.00" } }]);

    const result = await nagad.retrieve(config, { transactionId: "PRF1" });

    assert.equal(result.success, true);
    assert.equal(result.amount, 250);
  });

  it("reports success:false for a pending payment", async () => {
    mockFetch([{ body: { status: "Pending", paymentRefId: "PRF1" } }]);

    const result = await nagad.retrieve(config, { transactionId: "PRF1" });

    assert.equal(result.success, false);
    assert.equal(result.status, "Pending");
  });

  it("honours a baseUrl override", async () => {
    const calls = mockFetch([{ body: { status: "Success", paymentRefId: "PRF1" } }]);

    await nagad.retrieve(
      { ...config, baseUrl: "https://nagad.internal/api/dfs/" },
      { transactionId: "PRF1" }
    );

    assert.equal(calls[0].url, "https://nagad.internal/api/dfs/verify/payment/PRF1");
  });
});
