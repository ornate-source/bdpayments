import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// Smoke Tests — BDPayments
// ============================================================================

const SUPPORTED = ["stripe", "sslcommerz", "bkash", "nagad"];

describe("BDPayments exports", () => {
  it("should export charge, execute, refund, retrieve functions", async () => {
    const mod = await import("../src/index.js");
    assert.equal(typeof mod.charge, "function");
    assert.equal(typeof mod.execute, "function");
    assert.equal(typeof mod.refund, "function");
    assert.equal(typeof mod.retrieve, "function");
  });

  it("should export configure and clearConfig", async () => {
    const mod = await import("../src/index.js");
    assert.equal(typeof mod.configure, "function");
    assert.equal(typeof mod.clearConfig, "function");
  });

  it("should export error classes", async () => {
    const mod = await import("../src/index.js");
    assert.equal(typeof mod.PaymentError, "function");
    assert.equal(typeof mod.GatewayNotFoundError, "function");
    assert.equal(typeof mod.ConfigurationError, "function");
  });

  it("should export webhook helpers", async () => {
    const mod = await import("../src/index.js");
    assert.equal(typeof mod.verifySslcommerzIpn, "function");
    assert.equal(typeof mod.parseNagadCallback, "function");
  });

  it("should export getSupportedGateways", async () => {
    const mod = await import("../src/index.js");
    assert.deepEqual(mod.getSupportedGateways().sort(), [...SUPPORTED].sort());
  });
});

describe("Gateway registry", () => {
  it(`should load all ${SUPPORTED.length} gateway adapters`, async () => {
    const { getGateway } = await import("../src/gateways/index.js");

    for (const name of SUPPORTED) {
      const adapter = await getGateway(name);
      assert.ok(adapter, `Adapter for ${name} should exist`);
      for (const op of ["charge", "refund", "retrieve"]) {
        assert.equal(
          typeof adapter[op],
          "function",
          `${name} should have ${op}()`
        );
      }
    }
  });

  it("should report per-gateway capabilities", async () => {
    const { getGatewayCapabilities } = await import("../src/gateways/index.js");

    assert.deepEqual(await getGatewayCapabilities("bkash"), {
      charge: true,
      execute: true,
      refund: true,
      retrieve: true,
    });

    assert.deepEqual(await getGatewayCapabilities("stripe"), {
      charge: true,
      execute: false,
      refund: true,
      retrieve: true,
    });
  });

  it("should throw GatewayNotFoundError for unknown gateways", async () => {
    const { getGateway } = await import("../src/gateways/index.js");
    const { GatewayNotFoundError } = await import("../src/errors.js");

    await assert.rejects(
      () => getGateway("unknown_gateway"),
      (err) => {
        assert.ok(err instanceof GatewayNotFoundError);
        assert.equal(err.code, "GATEWAY_NOT_FOUND");
        return true;
      }
    );
  });

  it("should only advertise gateways that actually exist", async () => {
    const { getGateway, getSupportedGateways } = await import(
      "../src/gateways/index.js"
    );

    const error = await getGateway("paypal").catch((e) => e);

    assert.deepEqual(error.supportedGateways, getSupportedGateways());
    for (const removed of ["paypal", "payoneer"]) {
      assert.ok(
        !error.message.includes(`${removed},`),
        `message must not advertise ${removed}: ${error.message}`
      );
    }
  });

  it("should handle case-insensitive gateway names", async () => {
    const { getGateway } = await import("../src/gateways/index.js");

    assert.ok(await getGateway("STRIPE"));
    assert.ok(await getGateway("  BkAsH  "));
  });

  it("should reject non-string gateway names", async () => {
    const { getGateway } = await import("../src/gateways/index.js");
    const { GatewayNotFoundError } = await import("../src/errors.js");

    for (const bad of [undefined, null, 42, {}]) {
      await assert.rejects(() => getGateway(bad), GatewayNotFoundError);
    }
  });
});

describe("Error classes", () => {
  it("PaymentError should have correct properties", async () => {
    const { PaymentError } = await import("../src/errors.js");

    const err = new PaymentError("test error", "stripe", "TEST_CODE", {
      raw: true,
    });
    assert.equal(err.message, "test error");
    assert.equal(err.gateway, "stripe");
    assert.equal(err.code, "TEST_CODE");
    assert.deepEqual(err.originalError, { raw: true });
    assert.equal(err.status, null);
    assert.equal(err.name, "PaymentError");
    assert.ok(err instanceof Error);
  });

  it("PaymentError should chain an Error cause", async () => {
    const { PaymentError } = await import("../src/errors.js");

    const root = new Error("socket hang up");
    const err = new PaymentError("wrapped", "bkash", "NETWORK_ERROR", root);
    assert.equal(err.cause, root);
  });

  it("GatewayNotFoundError should be a PaymentError", async () => {
    const { GatewayNotFoundError, PaymentError } = await import(
      "../src/errors.js"
    );

    const err = new GatewayNotFoundError("foobar", ["stripe"]);
    assert.ok(err instanceof PaymentError);
    assert.equal(err.name, "GatewayNotFoundError");
    assert.equal(err.code, "GATEWAY_NOT_FOUND");
    assert.ok(err.message.includes("foobar"));
    assert.ok(err.message.includes("stripe"));
    assert.deepEqual(err.supportedGateways, ["stripe"]);
  });

  it("GatewayNotFoundError should work without a supported list", async () => {
    const { GatewayNotFoundError } = await import("../src/errors.js");

    const err = new GatewayNotFoundError("foobar");
    assert.ok(err.message.includes("foobar"));
    assert.deepEqual(err.supportedGateways, []);
  });

  it("ConfigurationError should list missing keys", async () => {
    const { ConfigurationError, PaymentError } = await import(
      "../src/errors.js"
    );

    const err = new ConfigurationError("bkash", ["appKey", "appSecret"]);
    assert.ok(err instanceof PaymentError);
    assert.equal(err.code, "MISSING_CREDENTIALS");
    assert.deepEqual(err.missingKeys, ["appKey", "appSecret"]);
    assert.ok(err.message.includes("appKey"));
  });
});

describe("Global functions — validation", () => {
  it("should throw GatewayNotFoundError for an invalid gateway", async () => {
    const { charge, execute, refund, retrieve, GatewayNotFoundError } =
      await import("../src/index.js");

    const cases = [
      () => charge({ gateway: "nonexistent" }),
      () => execute({ gateway: "nonexistent", paymentID: "x" }),
      () => refund({ gateway: "nonexistent", transactionId: "abc" }),
      () => retrieve({ gateway: "nonexistent", transactionId: "abc" }),
    ];

    for (const run of cases) {
      await assert.rejects(run, GatewayNotFoundError);
    }
  });

  it("execute() should throw a PaymentError for gateways without it", async () => {
    const { execute, PaymentError } = await import("../src/index.js");

    await assert.rejects(
      () => execute({ gateway: "stripe", paymentID: "x" }),
      (err) => {
        assert.ok(err instanceof PaymentError, "must be a PaymentError");
        assert.equal(err.code, "UNSUPPORTED_OPERATION");
        return true;
      }
    );
  });
});
