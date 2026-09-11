import { annotate, type Presence } from "@/lib/catalog/presence";
import { discoverXpubScriptKind } from "@/lib/electrum/discoverXpub";
import {
  expandAccountXpub,
  parseExtendedKey,
  type DerivedWatchScript,
  type ScriptKind,
} from "@/lib/electrum/xpub";
import { coinRowFromTips } from "@/lib/sync/buildRows";
import { MockTipLedger } from "@/lib/harness/mockTips";

export type ImportValidationResult = {
  valid: boolean;
  errors: string[];
  extendedKey: string;
  scriptKind: ScriptKind;
  accountPath: string;
  discovered: boolean;
  /** True when zpub/ypub/… prefix already encoded the script type. */
  prefixHinted: boolean;
  scripts: DerivedWatchScript[];
  rows: ReturnType<typeof coinRowFromTips>[];
  presenceCounts: Record<Presence, number>;
};

export type ValidateImportOpts = {
  extendedKey: string;
  ledger: MockTipLedger;
  /** Expected script kind (fixture assertion). */
  expectScriptKind?: ScriptKind;
  derivationPath?: string;
  gapLimit?: number;
  includeChange?: boolean;
  /**
   * Auto-detect script type via ledger.looksUsed (default: true for bare xpub).
   * Prefixed zpub/ypub skip discovery unless forceDiscover.
   */
  discover?: boolean;
  forceDiscover?: boolean;
};

/**
 * Validate an xpub import against a mock Electrum ledger:
 * parse key → optional discovery → expand gap → build dual-tip catalog rows.
 */
export async function validateWalletImport(
  opts: ValidateImportOpts
): Promise<ImportValidationResult> {
  const errors: string[] = [];
  const gapLimit = opts.gapLimit ?? 10;
  let parsed;
  try {
    parsed = parseExtendedKey(opts.extendedKey);
  } catch (e) {
    return {
      valid: false,
      errors: [e instanceof Error ? e.message : String(e)],
      extendedKey: opts.extendedKey,
      scriptKind: "p2wpkh",
      accountPath: "",
      discovered: false,
      prefixHinted: false,
      scripts: [],
      rows: [],
      presenceCounts: { both: 0, core_only: 0, knots_only: 0, none: 0 },
    };
  }

  const prefixHinted = parsed.prefix !== "xpub" && parsed.prefix !== "tpub";
  const wantDiscover =
    opts.forceDiscover === true ||
    (opts.discover !== false && !opts.derivationPath && !prefixHinted);

  let scriptKind = opts.expectScriptKind;
  let accountPath = opts.derivationPath;
  let discovered = false;

  if (wantDiscover || opts.forceDiscover) {
    const found = await discoverXpubScriptKind({
      extendedKey: opts.extendedKey,
      force: opts.forceDiscover,
      probe: Math.min(gapLimit, 10),
      probeUsed: async (scripthash) => opts.ledger.looksUsed(scripthash),
    });
    scriptKind = scriptKind ?? found.scriptKind;
    accountPath = accountPath ?? found.accountPath;
    discovered = found.discovered;
  }

  let scripts: DerivedWatchScript[] = [];
  try {
    const expanded = expandAccountXpub({
      extendedKey: opts.extendedKey,
      accountPath,
      scriptKind,
      gapLimit,
      includeChange: opts.includeChange === true,
    });
    scripts = expanded.scripts;
    scriptKind = expanded.scriptKind;
    accountPath = expanded.accountPath;
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
    return {
      valid: false,
      errors,
      extendedKey: opts.extendedKey,
      scriptKind: scriptKind ?? parsed.kind,
      accountPath: accountPath ?? parsed.accountPath,
      discovered,
      prefixHinted,
      scripts: [],
      rows: [],
      presenceCounts: { both: 0, core_only: 0, knots_only: 0, none: 0 },
    };
  }

  if (opts.expectScriptKind && scriptKind !== opts.expectScriptKind) {
    errors.push(
      `script kind mismatch: got ${scriptKind}, expected ${opts.expectScriptKind}`
    );
  }

  const rows = scripts.map((s, i) =>
    coinRowFromTips(
      i + 1,
      s.address,
      opts.ledger.snapshot("core", s.scripthash),
      opts.ledger.snapshot("knots", s.scripthash)
    )
  );

  const presenceCounts: Record<Presence, number> = {
    both: 0,
    core_only: 0,
    knots_only: 0,
    none: 0,
  };
  for (const r of rows) {
    presenceCounts[r.presence] += 1;
  }

  const valid = errors.length === 0 && scripts.length > 0;
  return {
    valid,
    errors,
    extendedKey: opts.extendedKey,
    scriptKind: scriptKind!,
    accountPath: accountPath!,
    discovered,
    prefixHinted,
    scripts,
    rows,
    presenceCounts,
  };
}

/** Annotate helper re-export for harness consumers. */
export { annotate };
