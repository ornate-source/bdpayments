import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

import { configure, clearConfig, resolveConfig } from "../src/config.js";
import { ConfigurationError, PaymentError } from "../src/errors.js";

const ENV_KEYS = [
  "STRIPE_API_KEY",
  "SSLCOMMERZ_STORE_ID",
  "SSLCOMMERZ_STORE_PASSWORD",
  "SSLCOMMERZ_SANDBOX",
  "BKASH_APP_KEY",
  "BKASH_APP_SECRET",
  "BKASH_USERNAME",
  "BKASH_PASSWORD",
  "BKASH_SANDBOX",
  "NAGAD_MERCHANT_ID",
  "NAGAD_PUBLIC_KEY",
  "NAGAD_PRIVATE_KEY",
  "NAGAD_SANDBOX",
  "NAGAD_CLIENT_IP",
];

/** Tests must not inherit the developer's real credentials. */
beforeEach(() => {
  clearConfig();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("resolveConfig precedence", () => {
  it("resolves from configure()", () => {
    configure({ stripe: { apiKey: "sk_global" } });
    assert.equal(resolveConfig("stripe", {}).apiKey, "sk_global");
  });

  it("lets per-call options win over configure()", () => {
    configure({ stripe: { apiKey: "sk_global" } });
    assert.equal(resolveConfig("stripe", { apiKey: "sk_call" }).apiKey, "sk_call");
  });

  it("falls back to environment variables", () => {
    process.env.STRIPE_API_KEY = "sk_env";
    assert.equal(resolveConfig("stripe", {}).apiKey, "sk_env");
  });

  it("prefers configure() over environment variables", () => {
    process.env.STRIPE_API_KEY = "sk_env";
    configure({ stripe: { apiKey: "sk_global" } });
    assert.equal(resolveConfig("stripe", {}).apiKey, "sk_global");
  });

  it("coerces sandbox env vars to booleans", () => {
    process.env.SSLCOMMERZ_STORE_ID = "s";
    process.env.SSLCOMMERZ_STORE_PASSWORD = "p";
    process.env.SSLCOMMERZ_SANDBOX = "true";
    assert.equal(resolveConfig("sslcommerz", {}).sandbox, true);

    process.env.SSLCOMMERZ_SANDBOX = "false";
    assert.equal(resolveConfig("sslcommerz", {}).sandbox, false);
  });

  it("defaults sandbox to false", () => {
    configure({ stripe: { apiKey: "sk" } });
    assert.equal(resolveConfig("stripe", {}).sandbox, false);
  });

  it("throws ConfigurationError listing every missing key", () => {
    assert.throws(
      () => resolveConfig("bkash", {}),
      (error) => {
        assert.ok(error instanceof ConfigurationError);
        assert.deepEqual(error.missingKeys, [
          "appKey",
          "appSecret",
          "username",
          "password",
        ]);
        return true;
      }
    );
  });

  it("forgets credentials after clearConfig()", () => {
    configure({ stripe: { apiKey: "sk" } });
    clearConfig();
    assert.throws(() => resolveConfig("stripe", {}), ConfigurationError);
  });
});

describe("resolveConfig scoping", () => {
  it("does not copy business options into the credential object", () => {
    configure({ stripe: { apiKey: "sk" } });

    const resolved = resolveConfig("stripe", {
      amount: 1000,
      currency: "usd",
      extra: { foo: 1 },
      description: "order",
    });

    assert.deepEqual(Object.keys(resolved).sort(), ["apiKey", "sandbox"]);
  });

  it("still accepts recognised transport overrides", () => {
    configure({ stripe: { apiKey: "sk" } });
    assert.equal(resolveConfig("stripe", { timeoutMs: 5000 }).timeoutMs, 5000);
  });

  it("ignores a foreign gateway's credential key", () => {
    configure({ stripe: { apiKey: "sk" } });
    const resolved = resolveConfig("stripe", { storePassword: "leak" });
    assert.equal(resolved.storePassword, undefined);
  });
});

describe("credential redaction", () => {
  it("masks secrets in JSON.stringify", () => {
    configure({ bkash: { appKey: "k", appSecret: "s", username: "u", password: "p" } });
    const serialized = JSON.stringify(resolveConfig("bkash", {}));

    assert.ok(!serialized.includes('"s"'), serialized);
    assert.ok(!serialized.includes('"p"'), serialized);
    assert.match(serialized, /\[redacted\]/);
    assert.match(serialized, /"username":"u"/);
  });

  it("masks secrets in console.log / util.inspect", () => {
    configure({ stripe: { apiKey: "sk_live_secret" } });
    const shown = inspect(resolveConfig("stripe", {}));

    assert.ok(!shown.includes("sk_live_secret"), shown);
    assert.match(shown, /redacted/);
  });

  it("keeps the real value readable by adapters", () => {
    configure({ stripe: { apiKey: "sk_live_secret" } });
    assert.equal(resolveConfig("stripe", {}).apiKey, "sk_live_secret");
  });
});

describe("configure validation", () => {
  it("rejects unknown gateway names", () => {
    assert.throws(
      () => configure({ strip: { apiKey: "sk" } }),
      (error) => {
        assert.ok(error instanceof PaymentError);
        assert.equal(error.code, "INVALID_CONFIG");
        assert.match(error.message, /strip/);
        assert.match(error.message, /stripe/);
        return true;
      }
    );
  });

  it("rejects a non-object argument", () => {
    assert.throws(() => configure(null), PaymentError);
  });

  it("accepts every supported gateway name", () => {
    assert.doesNotThrow(() =>
      configure({
        stripe: { apiKey: "a" },
        sslcommerz: { storeId: "b", storePassword: "c" },
        bkash: { appKey: "d", appSecret: "e", username: "f", password: "g" },
        nagad: { merchantId: "h", publicKey: "i", privateKey: "j" },
      })
    );
  });
});
