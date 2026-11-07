/** Deep link from an alert/task to an outpoint on its wallet details page. */

export function walletOutpointHref(
  accountId: number,
  txid: string,
  vout: number
): string {
  const outpoint = `${txid.toLowerCase()}:${vout}`;
  return `/wallets/${accountId}?outpoint=${encodeURIComponent(outpoint)}`;
}

export function parseOutpointQuery(
  raw: string | null | undefined
): { txid: string; vout: number } | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  const idx = trimmed.lastIndexOf(":");
  if (idx <= 0) return null;
  const txid = trimmed.slice(0, idx);
  const vout = Number(trimmed.slice(idx + 1));
  if (!/^[0-9a-f]{64}$/.test(txid) || !Number.isInteger(vout) || vout < 0) return null;
  return { txid, vout };
}

export function outpointDomId(txid: string, vout: number): string {
  return `outpoint-${txid.toLowerCase()}-${vout}`;
}
