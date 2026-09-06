import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateAccountBalances,
  aggregateScriptBalances,
  parseSatsInput,
  portfolioTotals,
  sumUnspent,
} from "./balances.ts";
import { annotate } from "./presence.ts";

describe("balances", () => {
  it("sums all unspent outputs", () => {
    assert.equal(
      sumUnspent([
        { tx_hash: "aa", tx_pos: 0, value: 100, height: 1 },
        { tx_hash: "bb", tx_pos: 1, value: 250, height: 1 },
      ]),
      350n
    );
    assert.equal(sumUnspent([]), 0n);
  });

  it("aggregates script and account balances", () => {
    const row = {
      ...annotate({
        scriptId: 1,
        address: "bc1q",
        core: { status: "unspent", valueSats: 1000, txid: "aa", vout: 0 },
        knots: { status: "unspent", valueSats: 1000, txid: "aa", vout: 0 },
      }),
      accountId: 9,
      watchAccountId: 9,
    };
    const scripts = aggregateScriptBalances([row]);
    assert.equal(scripts[0].coreSats, 1000n);
    assert.equal(scripts[0].both, true);

    const accounts = aggregateAccountBalances(
      [
        {
          id: 1,
          source: "electrum",
          watchAccountId: 9,
        },
        {
          id: 2,
          source: "manual",
          manualCoreSats: 50n,
          manualKnotsSats: 0n,
        },
      ],
      [row]
    );
    assert.equal(accounts[0].coreSats, 1000n);
    assert.equal(accounts[0].estimate, false);
    assert.equal(accounts[1].coreSats, 50n);
    assert.equal(accounts[1].estimate, true);

    const totals = portfolioTotals(accounts);
    assert.equal(totals.coreSats, 1050n);
    assert.equal(totals.accountCount, 2);
    assert.equal(totals.bothCount, 1);
  });

  it("parses manual sats input", () => {
    assert.equal(parseSatsInput(null), null);
    assert.equal(parseSatsInput(""), null);
    assert.equal(parseSatsInput("1000"), 1000n);
    assert.throws(() => parseSatsInput("not-a-number"));
  });
});
