import type { Tip } from "@/lib/catalog/presence";
import { ElectrumClient } from "@/lib/electrum/client";
import { loadStackConfig, serviceById } from "@/lib/stack/config";

export type UnspentItem = {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
};

export type HistoryItem = {
  tx_hash: string;
  height: number;
};

export type ScriptTipSnapshot = {
  tip: Tip;
  scripthash: string;
  unspent: UnspentItem[];
  history: HistoryItem[];
  ok: boolean;
  error?: string;
};

export async function fetchScriptTip(
  tip: Tip,
  url: string,
  scripthash: string
): Promise<ScriptTipSnapshot> {
  const client = ElectrumClient.fromUrl(url);
  try {
    await client.connect();
    await client.serverVersion();
    const unspent = (await client.listUnspent(scripthash)) as UnspentItem[];
    const history = (await client.getHistory(scripthash)) as HistoryItem[];
    return {
      tip,
      scripthash,
      unspent: Array.isArray(unspent) ? unspent : [],
      history: Array.isArray(history) ? history : [],
      ok: true,
    };
  } catch (err) {
    return {
      tip,
      scripthash,
      unspent: [],
      history: [],
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    client.close();
  }
}

export function envElectrumUrls(env: NodeJS.ProcessEnv = process.env): {
  fulcrum?: string;
  shulcrum?: string;
} {
  try {
    const config = loadStackConfig(undefined, env);
    const fulcrum = serviceById(config, "core-fulcrum").endpoint || env.FULCRUM_URL;
    const shulcrum = serviceById(config, "knots-fulcrum").endpoint || env.SHULCRUM_URL;
    return {
      fulcrum: fulcrum || undefined,
      shulcrum: shulcrum || undefined,
    };
  } catch {
    return {
      fulcrum: env.FULCRUM_URL,
      shulcrum: env.SHULCRUM_URL,
    };
  }
}
