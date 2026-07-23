import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import * as stripe from "../../src/gateways/stripe.js";
import { rejectsWithCode } from "../helpers/mock-fetch.js";

const config = { apiKey: "sk_test_dummy" };

afterEach(() => mock.restoreAll());

describe("stripe validation", () => {
  it("requires a currency", async () => {
    await rejectsWithCode(
      assert,
      () => stripe.charge(config, { amount: 1000 }),
      "INVALID_REQUEST"
    );
  });

  it("requires a positive amount", async () => {
    await rejectsWithCode(
      assert,
      () => stripe.charge(config, { amount: -1, currency: "usd" }),
      "INVALID_AMOUNT"
    );
  });

  it("requires integer minor units", async () => {
    const error = await rejectsWithCode(
      assert,
      () => stripe.charge(config, { amount: 10.5, currency: "usd" }),
      "INVALID_AMOUNT"
    );

    assert.match(error.message, /smallest currency unit/);
  });

  it("rejects NaN amounts", async () => {
    await rejectsWithCode(
      assert,
      () => stripe.charge(config, { amount: Number.NaN, currency: "usd" }),
      "INVALID_AMOUNT"
    );
  });

  it("requires a transactionId to refund", async () => {
    await rejectsWithCode(
      assert,
      () => stripe.refund(config, { amount: 100 }),
      "INVALID_REQUEST"
    );
  });

  it("requires a transactionId to retrieve", async () => {
    await rejectsWithCode(
      assert,
      () => stripe.retrieve(config, {}),
      "INVALID_REQUEST"
    );
  });
});
