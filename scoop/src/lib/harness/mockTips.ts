import type { Tip } from "@/lib/catalog/presence";
import type { HistoryItem, ScriptTipSnapshot, UnspentItem } from "@/lib/sync/fetchTip";

export type TipFunding = {
  /** Confirmed sats (listunspent total). */
  sats: number;
  txid?: string;
  vout?: number;
  height?: number;
  /** If true, mark spent on this tip (history only, no unspent). */
  spent?: boolean;
  spendTxid?: string;
};

type TipState = {
  unspent: UnspentItem[];
  history: HistoryItem[];
};

function emptyState(): TipState {
  return { unspent: [], history: [] };
}

/**
 * In-memory Core / Knots Electrum tip ledger for import validation tests.
 * Keyed by Electrum scripthash.
 */
export class MockTipLedger {
  private core = new Map<string, TipState>();
  private knots = new Map<string, TipState>();

  private map(tip: Tip): Map<string, TipState> {
    return tip === "core" ? this.core : this.knots;
  }

  clear(): void {
    this.core.clear();
    this.knots.clear();
  }

  /** Fund (or spend) a scripthash on one tip. */
  set(tip: Tip, scripthash: string, funding: TipFunding): this {
    const sh = scripthash.toLowerCase();
    const txid = funding.txid ?? `mocktxid_${tip}_${sh.slice(0, 8)}`;
    const vout = funding.vout ?? 0;
    const height = funding.height ?? 800_000;
    if (funding.spent) {
      this.map(tip).set(sh, {
        unspent: [],
        history: [
          { tx_hash: txid, height },
          {
            tx_hash: funding.spendTxid ?? `mockspend_${tip}_${sh.slice(0, 8)}`,
            height: height + 1,
          },
        ],
      });
      return this;
    }
    this.map(tip).set(sh, {
      unspent: [
        {
          tx_hash: txid,
          tx_pos: vout,
          value: funding.sats,
          height,
        },
      ],
      history: [{ tx_hash: txid, height }],
    });
    return this;
  }

  /** Convenience: same outpoint unspent on both tips (replay-exposed / both). */
  fundBoth(scripthash: string, sats: number, txid?: string): this {
    const id = txid ?? `mocktxid_both_${scripthash.slice(0, 8)}`;
    return this.set("core", scripthash, { sats, txid: id }).set("knots", scripthash, {
      sats,
      txid: id,
    });
  }

  /** Split coin: unspent on Core only. */
  fundCoreOnly(scripthash: string, sats: number): this {
    return this.set("core", scripthash, { sats });
  }

  /** Split coin: unspent on Knots only. */
  fundKnotsOnly(scripthash: string, sats: number): this {
    return this.set("knots", scripthash, { sats });
  }

  getState(tip: Tip, scripthash: string): TipState {
    return this.map(tip).get(scripthash.toLowerCase()) ?? emptyState();
  }

  snapshot(tip: Tip, scripthash: string): ScriptTipSnapshot {
    const sh = scripthash.toLowerCase();
    const state = this.getState(tip, sh);
    return {
      tip,
      scripthash: sh,
      unspent: state.unspent,
      history: state.history,
      ok: true,
    };
  }

  /** True if either tip has balance or history — used by script-type discovery. */
  looksUsed(scripthash: string): boolean {
    const sh = scripthash.toLowerCase();
    for (const tip of ["core", "knots"] as Tip[]) {
      const s = this.getState(tip, sh);
      if (s.unspent.some((u) => u.value > 0)) return true;
      if (s.history.length > 0) return true;
    }
    return false;
  }

  balance(tip: Tip, scripthash: string): { confirmed: number; unconfirmed: number } {
    const s = this.getState(tip, scripthash);
    const confirmed = s.unspent.reduce((a, u) => a + u.value, 0);
    return { confirmed, unconfirmed: 0 };
  }
}
