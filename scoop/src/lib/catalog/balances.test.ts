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
    assert.equal(totals.coreUtxoCount, 1);
    assert.equal(totals.knotsUtxoCount, 1);
    assert.equal(totals.utxoCount, 1);
  });

  it("does not count a core-bound outpoint as replay", () => {
    const row = annotate({
      scriptId: 4,
      address: "bc1q",
      core: { status: "spent", txid: "aa", vout: 0 },
      knots: { status: "unspent", txid: "aa", vout: 0, valueSats: 42 },
    });
    const [account] = aggregateAccountBalances(
      [{ id: 1, source: "electrum", watchAccountId: 1 }],
      [{ ...row, accountId: 1, watchAccountId: 1 }]
    );
    assert.equal(row.coreBoundOk, true);
    assert.equal(account.bothCount, 0);
    assert.equal(account.knotsSats, 42n);
    assert.equal(account.coreSats, 0n);
    assert.equal(account.coreUtxoCount, 0);
    assert.equal(account.knotsUtxoCount, 1);
    assert.equal(account.utxoCount, 1);
  });

  it("counts Core and Knots UTXOs separately without summing sats", () => {
    const rows = [
      {
        ...annotate({
          scriptId: 1,
          address: "bc1qa",
          core: { status: "unspent", valueSats: 100, txid: "aa", vout: 0 },
          knots: { status: "absent" },
        }),
        accountId: 1,
        watchAccountId: 1,
      },
      {
        ...annotate({
          scriptId: 2,
          address: "bc1qb",
          core: { status: "absent" },
          knots: { status: "unspent", valueSats: 200, txid: "bb", vout: 0 },
        }),
        accountId: 1,
        watchAccountId: 1,
      },
      {
        ...annotate({
          scriptId: 3,
          address: "bc1qc",
          core: { status: "unspent", valueSats: 300, txid: "cc", vout: 0 },
          knots: { status: "unspent", valueSats: 300, txid: "cc", vout: 0 },
        }),
        accountId: 1,
        watchAccountId: 1,
      },
    ];
    const [account] = aggregateAccountBalances(
      [{ id: 1, source: "electrum", watchAccountId: 1 }],
      rows
    );
    assert.equal(account.coreSats, 400n);
    assert.equal(account.knotsSats, 500n);
    assert.equal(account.coreUtxoCount, 2);
    assert.equal(account.knotsUtxoCount, 2);
    assert.equal(account.utxoCount, 3);
    assert.equal(account.bothCount, 1);
  });

  it("parses manual sats input", () => {
    assert.equal(parseSatsInput(null), null);
    assert.equal(parseSatsInput(""), null);
    assert.equal(parseSatsInput("1000"), 1000n);
    assert.throws(() => parseSatsInput("not-a-number"));
  });

  it("does not treat a missing Core tip as zero sats", () => {
    const row = {
      ...annotate({
        scriptId: 1,
        address: "bc1q",
        core: { status: "absent" },
        knots: { status: "unspent", valueSats: 900, txid: "aa", vout: 0 },
      }),
      accountId: 1,
      watchAccountId: 1,
    };
    const [account] = aggregateAccountBalances(
      [{ id: 1, source: "electrum", watchAccountId: 1 }],
      [row],
      { core: false, knots: true, coreError: "ECONNREFUSED", knotsError: null }
    );
    assert.equal(account.coreKnown, false);
    assert.equal(account.knotsKnown, true);
    assert.equal(account.coreSats, 0n);
    assert.equal(account.knotsSats, 900n);
    assert.equal(account.bothCount, 0);

    const totals = portfolioTotals([account], {
      core: false,
      knots: true,
      coreError: "ECONNREFUSED",
      knotsError: null,
    });
    assert.equal(totals.coreKnown, false);
    assert.equal(totals.knotsKnown, true);
    assert.equal(totals.coreError, "ECONNREFUSED");
  });
});
