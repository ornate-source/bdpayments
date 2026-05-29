import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// Smoke Tests — BDPayments
// ============================================================================

describe("BDPayments exports", () => {
  it("should export charge, refund, retrieve functions", async () => {
    const mod = await import("../src/index.js");
    assert.equal(typeof mod.charge, "function");
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

  it("should export getSupportedGateways", async () => {
    const mod = await import("../src/index.js");
    assert.equal(typeof mod.getSupportedGateways, "function");
    const gateways = mod.getSupportedGateways();
    assert.ok(Array.isArray(gateways));
    assert.ok(gateways.includes("stripe"));
    assert.ok(gateways.includes("paypal"));
    assert.ok(gateways.includes("sslcommerz"));
    assert.ok(gateways.includes("bkash"));
    assert.ok(gateways.includes("nagad"));
  });
});

describe("Gateway registry", () => {
  it("should load all 6 gateway adapters", async () => {
    const { getGateway } = await import("../src/gateways/index.js");
    const gateways = [
      "stripe",
      "paypal",
      "sslcommerz",
      "bkash",
      "nagad",
    ];

    for (const name of gateways) {
      const adapter = await getGateway(name);
      assert.ok(adapter, `Adapter for ${name} should exist`);
      assert.equal(
        typeof adapter.charge,
        "function",
        `${name} should have charge()`
      );
      assert.equal(
        typeof adapter.refund,
        "function",
        `${name} should have refund()`
      );
      assert.equal(
        typeof adapter.retrieve,
        "function",
        `${name} should have retrieve()`
      );
    }
  });

  it("should throw GatewayNotFoundError for unknown gateways", async () => {
    const { getGateway } = await import("../src/gateways/index.js");
    const { GatewayNotFoundError } = await import("../src/errors.js");

    await assert.rejects(() => getGateway("unknown_gateway"), (err) => {
      assert.ok(err instanceof GatewayNotFoundError);
      assert.equal(err.code, "GATEWAY_NOT_FOUND");
      return true;
    });
  });

  it("should handle case-insensitive gateway names", async () => {
    const { getGateway } = await import("../src/gateways/index.js");

    const adapter = await getGateway("STRIPE");
    assert.ok(adapter);
    assert.equal(typeof adapter.charge, "function");

    const adapter2 = await getGateway("  BkAsH  ");
    assert.ok(adapter2);
    assert.equal(typeof adapter2.charge, "function");
  });
});

describe("Config module", () => {
  let configModule;

  beforeEach(async () => {
    configModule = await import("../src/config.js");
    configModule.clearConfig();
  });

  it("should store and resolve global config", () => {
    configModule.configure({
      stripe: { apiKey: "sk_test_123" },
    });

    const resolved = configModule.resolveConfig("stripe", {});
    assert.equal(resolved.apiKey, "sk_test_123");
  });

  it("should allow per-call overrides to take precedence", () => {
    configModule.configure({
      stripe: { apiKey: "sk_global" },
    });

    const resolved = configModule.resolveConfig("stripe", {
      apiKey: "sk_override",
    });
    assert.equal(resolved.apiKey, "sk_override");
  });

  it("should throw ConfigurationError for missing required keys", async () => {
    const { ConfigurationError } = await import("../src/errors.js");

    assert.throws(
      () => configModule.resolveConfig("stripe", {}),
      (err) => {
        assert.ok(err instanceof ConfigurationError);
        assert.ok(err.missingKeys.includes("apiKey"));
        return true;
      }
    );
  });

  it("should default sandbox to false", () => {
    configModule.configure({
      stripe: { apiKey: "sk_test_123" },
    });

    const resolved = configModule.resolveConfig("stripe", {});
    assert.equal(resolved.sandbox, false);
  });

  it("should read environment variables as fallback", () => {
    // Set env vars temporarily
    const originalKey = process.env.STRIPE_API_KEY;
    process.env.STRIPE_API_KEY = "sk_env_test";

    try {
      const resolved = configModule.resolveConfig("stripe", {});
      assert.equal(resolved.apiKey, "sk_env_test");
    } finally {
      // Restore
      if (originalKey === undefined) {
        delete process.env.STRIPE_API_KEY;
      } else {
        process.env.STRIPE_API_KEY = originalKey;
      }
    }
  });

  it("should clear config correctly", () => {
    const { ConfigurationError } = configModule;

    configModule.configure({
      stripe: { apiKey: "sk_test_123" },
    });
    configModule.clearConfig();

    // Should now fail because config was cleared
    assert.throws(
      () => configModule.resolveConfig("stripe", {}),
      (err) => err.code === "MISSING_CREDENTIALS"
    );
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
    assert.equal(err.name, "PaymentError");
    assert.ok(err instanceof Error);
  });

  it("GatewayNotFoundError should be a PaymentError", async () => {
    const { GatewayNotFoundError, PaymentError } = await import(
      "../src/errors.js"
    );

    const err = new GatewayNotFoundError("foobar");
    assert.ok(err instanceof PaymentError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, "GatewayNotFoundError");
    assert.equal(err.code, "GATEWAY_NOT_FOUND");
    assert.ok(err.message.includes("foobar"));
  });

  it("ConfigurationError should list missing keys", async () => {
    const { ConfigurationError, PaymentError } = await import(
      "../src/errors.js"
    );

    const err = new ConfigurationError("bkash", [
      "appKey",
      "appSecret",
    ]);
    assert.ok(err instanceof PaymentError);
    assert.equal(err.code, "MISSING_CREDENTIALS");
    assert.deepEqual(err.missingKeys, ["appKey", "appSecret"]);
    assert.ok(err.message.includes("appKey"));
  });
});

describe("Global functions — validation", () => {
  it("charge should throw GatewayNotFoundError for invalid gateway", async () => {
    const { charge, GatewayNotFoundError } = await import("../src/index.js");

    await assert.rejects(() => charge({ gateway: "nonexistent" }), (err) => {
      assert.ok(err instanceof GatewayNotFoundError);
      return true;
    });
  });

  it("refund should throw GatewayNotFoundError for invalid gateway", async () => {
    const { refund, GatewayNotFoundError } = await import("../src/index.js");

    await assert.rejects(
      () => refund({ gateway: "nonexistent", transactionId: "abc" }),
      (err) => {
        assert.ok(err instanceof GatewayNotFoundError);
        return true;
      }
    );
  });

  it("retrieve should throw GatewayNotFoundError for invalid gateway", async () => {
    const { retrieve, GatewayNotFoundError } = await import("../src/index.js");

    await assert.rejects(
      () => retrieve({ gateway: "nonexistent", transactionId: "abc" }),
      (err) => {
        assert.ok(err instanceof GatewayNotFoundError);
        return true;
      }
    );
  });
});
