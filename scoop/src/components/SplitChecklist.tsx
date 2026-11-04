"use client";

import { splitSummary, type OutpointRow } from "@/lib/catalog/outpoints";

type ScriptWitness = { id: number; witnessState?: string | null };

export function SplitChecklist({
  rows,
  scripts = [],
}: {
  rows: OutpointRow[];
  scripts?: ScriptWitness[];
}) {
  const summary = splitSummary(rows, scripts);
  const empty = rows.length === 0 && scripts.length === 0;
  if (empty) return null;

  return (
    <section className="scoop-panel split-checklist">
      <h3>Split checklist</h3>
      <p>
        Replay risk is an outpoint that is unspent on both chains ({summary.replay}). An address
        that holds different outpoints on different chains is mixed. That mix is not itself replay
        risk. Knots-only outpoints: {summary.knotsOnly}. Core-only outpoints: {summary.coreOnly}.
      </p>
      {summary.unclassified > 0 ? (
        <p className="banner warn">
          {summary.unclassified} outpoint{summary.unclassified === 1 ? "" : "s"} waiting on both
          indexers. Do not treat those labels as a split list yet.
        </p>
      ) : null}
      {summary.publishedScripts > 0 ? (
        <p className="banner warn">
          A script in this wallet has already been spent on at least one chain. Its witness is
          public. Coins that remain on that policy are the ones a watcher can try to take.
        </p>
      ) : null}
      <ol>
        <li>
          Sign every live outpoint of this policy on a chain before you broadcast the first one.
          Pay a new policy. Leave no change on these keys.
        </li>
        <li>
          One transaction that spends them all, or several transactions released together, both
          cover the chain. Spacing those spends into later blocks is the window where a later coin
          can be taken.
        </li>
        <li>
          Knots transactions come from Shrike. With unified sighash they cannot confirm on Core.
          Core transactions are unsigned Sparrow PSBTs, one coin each. Garnish adds the OP_RETURN
          before anyone signs. Scoop does not build the spend or sign it.
        </li>
      </ol>
      <p className="muted">
        A multisig output is only a hash until it is spent. The first spend publishes every
        cosigner key in that script, on whichever chain sees the transaction. Paying an address of
        this same policy does not leave those keys. A single combined spend also tells the chain
        those coins share an owner. Fresh destination addresses, one per chunk of a same-wave set,
        avoid that common-input proof. They do not make a staggered exit safe.
      </p>
    </section>
  );
}
