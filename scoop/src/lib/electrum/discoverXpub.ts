import { ElectrumClient } from "@/lib/electrum/client";
import {
  DISCOVER_KINDS,
  expandAccountXpub,
  parseExtendedKey,
  type DerivedWatchScript,
  type ScriptKind,
} from "@/lib/electrum/xpub";

export type DiscoverHit = {
  scriptKind: ScriptKind;
  accountPath: string;
  hitCount: number;
  sampleAddresses: string[];
};

/**
 * Probe Electrum for the first `probe` receive addresses under each common script
 * type (bare xpub/tpub). Prefixed keys (zpub/ypub/…) already encode the type.
 */
export async function discoverXpubScriptKind(opts: {
  extendedKey: string;
  fulcrumUrl?: string;
  shulcrumUrl?: string;
  probe?: number;
  /** Force probing even for zpub/ypub. */
  force?: boolean;
  /**
   * Injected used-check (harness / unit tests). When set, skips live Electrum.
   * Return true if the scripthash has balance or history on any tip.
   */
  probeUsed?: (scripthash: string, address: string) => Promise<boolean> | boolean;
}): Promise<{
  scriptKind: ScriptKind;
  accountPath: string;
  discovered: boolean;
  hits: DiscoverHit[];
}> {
  const probe = Math.min(Math.max(opts.probe ?? 8, 1), 20);
  const parsed = parseExtendedKey(opts.extendedKey);
  const prefixIsHint = parsed.prefix !== "xpub" && parsed.prefix !== "tpub";

  if (prefixIsHint && !opts.force) {
    const expanded = expandAccountXpub({
      extendedKey: opts.extendedKey,
      scriptKind: parsed.kind,
      gapLimit: 1,
    });
    return {
      scriptKind: parsed.kind,
      accountPath: expanded.accountPath,
      discovered: false,
      hits: [],
    };
  }

  const urls = [opts.fulcrumUrl, opts.shulcrumUrl].filter(Boolean) as string[];
  const hits: DiscoverHit[] = [];

  for (const kind of DISCOVER_KINDS) {
    const expanded = expandAccountXpub({
      extendedKey: opts.extendedKey,
      scriptKind: kind,
      gapLimit: probe,
    });
    let hitCount = 0;
    const sampleAddresses: string[] = [];
    for (const s of expanded.scripts) {
      const active = opts.probeUsed
        ? await opts.probeUsed(s.scripthash, s.address)
        : await scripthashLooksUsed(s, urls);
      if (active) {
        hitCount += 1;
        if (sampleAddresses.length < 3) sampleAddresses.push(s.address);
      }
    }
    hits.push({
      scriptKind: kind,
      accountPath: expanded.accountPath,
      hitCount,
      sampleAddresses,
    });
  }

  hits.sort((a, b) => b.hitCount - a.hitCount);
  const best = hits[0];
  if (best && best.hitCount > 0) {
    return {
      scriptKind: best.scriptKind,
      accountPath: best.accountPath,
      discovered: true,
      hits,
    };
  }

  const fallbackKind: ScriptKind = prefixIsHint ? parsed.kind : "p2wpkh";
  const fallback = expandAccountXpub({
    extendedKey: opts.extendedKey,
    scriptKind: fallbackKind,
    gapLimit: 1,
  });
  return {
    scriptKind: fallbackKind,
    accountPath: fallback.accountPath,
    discovered: false,
    hits,
  };
}

async function scripthashLooksUsed(
  script: DerivedWatchScript,
  electrumUrls: string[]
): Promise<boolean> {
  if (!electrumUrls.length) return false;
  for (const url of electrumUrls) {
    const client = ElectrumClient.fromUrl(url);
    try {
      await client.connect(5_000);
      await client.serverVersion();
      const bal = (await client.getBalance(script.scripthash)) as {
        confirmed?: number;
        unconfirmed?: number;
      };
      if ((bal.confirmed ?? 0) > 0 || (bal.unconfirmed ?? 0) > 0) return true;
      const hist = (await client.getHistory(script.scripthash)) as unknown[];
      if (Array.isArray(hist) && hist.length > 0) return true;
    } catch {
      // tip unreachable
    } finally {
      client.close();
    }
  }
  return false;
}

/**
 * Scan receive (and optional change) addresses until one has history/balance.
 * Reuses one Electrum connection per tip so a 50-address gap check stays cheap.
 */
export async function probeWatchUsage(
  scripts: DerivedWatchScript[],
  electrumUrls: string[]
): Promise<{ used: boolean; reachable: boolean }> {
  if (!scripts.length) return { used: false, reachable: false };
  if (!electrumUrls.length) return { used: false, reachable: false };

  const clients: ElectrumClient[] = [];
  try {
    for (const url of electrumUrls) {
      const client = ElectrumClient.fromUrl(url);
      try {
        await client.connect(5_000);
        await client.serverVersion();
        clients.push(client);
      } catch {
        client.close();
      }
    }
    if (!clients.length) return { used: false, reachable: false };

    for (const script of scripts) {
      for (const client of clients) {
        try {
          const bal = (await client.getBalance(script.scripthash)) as {
            confirmed?: number;
            unconfirmed?: number;
          };
          if ((bal.confirmed ?? 0) > 0 || (bal.unconfirmed ?? 0) > 0) {
            return { used: true, reachable: true };
          }
          const hist = (await client.getHistory(script.scripthash)) as unknown[];
          if (Array.isArray(hist) && hist.length > 0) {
            return { used: true, reachable: true };
          }
        } catch {
          // this tip failed this address; try the other tip
        }
      }
    }
    return { used: false, reachable: true };
  } finally {
    for (const c of clients) c.close();
  }
}
