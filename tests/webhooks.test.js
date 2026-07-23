import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { configure, clearConfig } from "../src/config.js";
import { verifySslcommerzIpn, parseNagadCallback } from "../src/webhooks.js";

const STORE_PASSWORD = "store_pass_123";

/** Build a payload signed the way SSLCommerz signs its IPNs. */
function signedPayload(fields) {
  const keys = Object.keys(fields).sort();
  const pairs = keys.map((key) => `${key}=${fields[key]}`);
  pairs.push(
    `store_passwd=${crypto.createHash("md5").update(STORE_PASSWORD).digest("hex")}`
  );

  return {
    ...fields,
    verify_key: keys.join(","),
    verify_sign: crypto.createHash("md5").update(pairs.join("&")).digest("hex"),
  };
}

beforeEach(() => {
  clearConfig();
  configure({
    sslcommerz: { storeId: "store", storePassword: STORE_PASSWORD },
  });
});

describe("verifySslcommerzIpn", () => {
  it("accepts a correctly signed payload", () => {
    const payload = signedPayload({
      tran_id: "TXN-1",
      val_id: "VAL-1",
      amount: "1000.00",
      status: "VALID",
    });

    assert.equal(verifySslcommerzIpn(payload), true);
  });

  it("rejects a tampered amount", () => {
    const payload = signedPayload({ tran_id: "TXN-1", amount: "10.00" });
    payload.amount = "10000.00";

    assert.equal(verifySslcommerzIpn(payload), false);
  });

  it("rejects a forged signature", () => {
    const payload = signedPayload({ tran_id: "TXN-1", amount: "10.00" });
    payload.verify_sign = "0".repeat(32);

    assert.equal(verifySslcommerzIpn(payload), false);
  });

  it("rejects the wrong store password", () => {
    const payload = signedPayload({ tran_id: "TXN-1" });

    assert.equal(
      verifySslcommerzIpn(payload, { storePassword: "wrong_password" }),
      false
    );
  });

  it("returns false for a payload with no signature", () => {
    assert.equal(verifySslcommerzIpn({ tran_id: "TXN-1" }), false);
    assert.equal(verifySslcommerzIpn(null), false);
  });

  it("is order-insensitive across verify_key fields", () => {
    const payload = signedPayload({ b: "2", a: "1", c: "3" });
    payload.verify_key = "c,a,b";

    assert.equal(verifySslcommerzIpn(payload), true);
  });
});

describe("parseNagadCallback", () => {
  it("normalizes an object of query params", () => {
    const result = parseNagadCallback({
      order_id: "ORD-1",
      payment_ref_id: "PRF-1",
      status: "Success",
      amount: "500.00",
    });

    assert.equal(result.orderId, "ORD-1");
    assert.equal(result.paymentRefId, "PRF-1");
    assert.equal(result.status, "Success");
    assert.equal(result.amount, 500);
    assert.equal(result.verified, false);
  });

  it("accepts a raw query string", () => {
    const result = parseNagadCallback("order_id=ORD-2&status=Aborted");
    assert.equal(result.orderId, "ORD-2");
    assert.equal(result.status, "Aborted");
    assert.equal(result.amount, null);
  });

  it("accepts URLSearchParams", () => {
    const result = parseNagadCallback(new URLSearchParams({ order_id: "ORD-3" }));
    assert.equal(result.orderId, "ORD-3");
  });

  it("never reports itself as verified", () => {
    assert.equal(parseNagadCallback({}).verified, false);
  });
});
