export type ForkWallet = {
  id: number;
  label: string;
};

export type ForkOutput = {
  vout: number;
  valueSats: string;
  address: string | null;
  scriptLabel: string;
  wallets: ForkWallet[];
};

export type ForkBranch = {
  status: "spent" | "unspent";
  spendTxid: string | null;
  outputs: ForkOutput[];
};

export type CoinFork = {
  scriptId: number;
  parentTxid: string;
  parentVout: number;
  parentValueSats: string | null;
  parentAddress: string | null;
  parentWallets: ForkWallet[];
  core: ForkBranch;
  knots: ForkBranch;
};

export type SpendSide = {
  scriptId: number;
  tip: "core" | "knots";
  prevTxid: string;
  prevVout: number;
  spendTxid: string;
  valueSats: string | null;
  parentAddress: string | null;
  outputs: {
    vout: number;
    valueSats: string;
    address: string | null;
    scriptLabel: string;
  }[];
};

type WalletRow = { address: string; id: number; label: string };

function walletKey(address: string): string[] {
  const trimmed = address.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("bc1") || lower.startsWith("tb1") || lower.startsWith("bcrt1")) {
    return [lower];
  }
  return [trimmed];
}

export function indexWalletsByAddress(rows: WalletRow[]): Map<string, ForkWallet[]> {
  const index = new Map<string, ForkWallet[]>();
  for (const row of rows) {
    const wallet = { id: row.id, label: row.label };
    for (const key of walletKey(row.address)) {
      const list = index.get(key) ?? [];
      if (!list.some((item) => item.id === wallet.id)) list.push(wallet);
      index.set(key, list);
    }
  }
  return index;
}

export function walletsForAddress(
  index: Map<string, ForkWallet[]>,
  address: string | null | undefined
): ForkWallet[] {
  const trimmed = address?.trim();
  if (!trimmed) return [];
  const exact = index.get(trimmed);
  if (exact?.length) return exact;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("bc1") ||
    lower.startsWith("tb1") ||
    lower.startsWith("bcrt1")
  ) {
    return index.get(lower) ?? [];
  }
  return [];
}

function unspentBranch(): ForkBranch {
  return { status: "unspent", spendTxid: null, outputs: [] };
}

function spentBranch(
  side: SpendSide,
  wallets: Map<string, ForkWallet[]>
): ForkBranch {
  const outputs = [...side.outputs]
    .sort((a, b) => a.vout - b.vout)
    .map((output) => ({
      vout: output.vout,
      valueSats: output.valueSats,
      address: output.address,
      scriptLabel: output.scriptLabel,
      wallets: walletsForAddress(wallets, output.address),
    }));
  return {
    status: "spent",
    spendTxid: side.spendTxid.toLowerCase(),
    outputs,
  };
}

/**
 * One hop from a parent outpoint to the outputs of each flavor's spend.
 * Identical spend txids on both tips are a spill and are omitted.
 */
export function buildForks(
  sides: SpendSide[],
  wallets: Map<string, ForkWallet[]> = new Map()
): CoinFork[] {
  const groups = new Map<string, { core?: SpendSide; knots?: SpendSide }>();
  for (const side of sides) {
    const key = `${side.scriptId}:${side.prevTxid.toLowerCase()}:${side.prevVout}`;
    const group = groups.get(key) ?? {};
    group[side.tip] = side;
    groups.set(key, group);
  }

  const forks: CoinFork[] = [];
  for (const group of groups.values()) {
    const core = group.core;
    const knots = group.knots;
    if (
      core &&
      knots &&
      core.spendTxid.toLowerCase() === knots.spendTxid.toLowerCase()
    ) {
      continue;
    }
    const sample = core ?? knots;
    if (!sample) continue;
    const parentValue = core?.valueSats ?? knots?.valueSats ?? null;
    forks.push({
      scriptId: sample.scriptId,
      parentTxid: sample.prevTxid.toLowerCase(),
      parentVout: sample.prevVout,
      parentValueSats: parentValue,
      parentAddress: sample.parentAddress,
      parentWallets: walletsForAddress(wallets, sample.parentAddress),
      core: core ? spentBranch(core, wallets) : unspentBranch(),
      knots: knots ? spentBranch(knots, wallets) : unspentBranch(),
    });
  }

  forks.sort(
    (a, b) =>
      a.parentTxid.localeCompare(b.parentTxid) ||
      a.parentVout - b.parentVout ||
      a.scriptId - b.scriptId
  );
  return forks;
}
