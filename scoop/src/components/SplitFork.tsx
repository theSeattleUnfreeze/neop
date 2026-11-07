import Link from "next/link";
import type { CoinFork, ForkBranch, ForkOutput, ForkWallet } from "@/lib/fork/forks";

export const SPLIT_FORK_EMPTY =
  "No completed or in-progress splits recorded yet. Sync a wallet that has spent a dual-tip coin.";

function sats(value: string | null): string {
  if (value == null) return "—";
  try {
    return `${BigInt(value).toLocaleString()} sats`;
  } catch {
    return "—";
  }
}

function shortTx(txid: string, vout?: number): string {
  const head = `${txid.slice(0, 8)}…`;
  return vout == null ? head : `${head}:${vout}`;
}

function WalletLinks({ wallets }: { wallets: ForkWallet[] }) {
  if (!wallets.length) return null;
  return (
    <span className="fork-wallets">
      {wallets.map((wallet) => (
        <Link key={wallet.id} href={`/wallets/${wallet.id}`}>
          {wallet.label.trim() || "Wallet"}
        </Link>
      ))}
    </span>
  );
}

function OutputCard({ output, flavor }: { output: ForkOutput; flavor: "core" | "knots" }) {
  return (
    <li className="fork-output">
      <div className="fork-output-head">
        <span className={`presence-chip ${flavor}`}>{flavor === "core" ? "Core" : "Knots"}</span>
        <span>{sats(output.valueSats)}</span>
      </div>
      {output.address ? (
        <p className="fork-addr">{output.address}</p>
      ) : (
        <p className="fork-addr muted">{output.scriptLabel}</p>
      )}
      <WalletLinks wallets={output.wallets} />
    </li>
  );
}

function BranchColumn({
  flavor,
  branch,
}: {
  flavor: "core" | "knots";
  branch: ForkBranch;
}) {
  const label = flavor === "core" ? "Core" : "Knots";
  return (
    <div className={`fork-branch ${flavor}`}>
      <h4>
        <span className={`presence-chip ${flavor}`}>{label}</span>
      </h4>
      {branch.status === "unspent" ? (
        <p className="muted">Still unspent on {label}.</p>
      ) : (
        <>
          {branch.spendTxid ? (
            <p className="muted fork-spend">Spend {shortTx(branch.spendTxid)}</p>
          ) : null}
          <ul className="fork-outputs">
            {branch.outputs.map((output) => (
              <OutputCard key={output.vout} output={output} flavor={flavor} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function SplitFork({ fork }: { fork: CoinFork }) {
  return (
    <article className="split-fork" aria-label={`Split of ${shortTx(fork.parentTxid, fork.parentVout)}`}>
      <div className="fork-parent">
        <p className="fork-kicker">Parent coin</p>
        <p className="fork-amount">{sats(fork.parentValueSats)}</p>
        <p className="fork-outpoint">{shortTx(fork.parentTxid, fork.parentVout)}</p>
        {fork.parentAddress ? <p className="fork-addr">{fork.parentAddress}</p> : null}
        <WalletLinks wallets={fork.parentWallets} />
      </div>
      <BranchColumn flavor="core" branch={fork.core} />
      <BranchColumn flavor="knots" branch={fork.knots} />
    </article>
  );
}

export function SplitForkList({ forks }: { forks: CoinFork[] }) {
  if (!forks.length) return <p className="muted">{SPLIT_FORK_EMPTY}</p>;
  return (
    <div className="split-fork-list">
      {forks.map((fork) => (
        <SplitFork
          key={`${fork.scriptId}:${fork.parentTxid}:${fork.parentVout}`}
          fork={fork}
        />
      ))}
    </div>
  );
}
