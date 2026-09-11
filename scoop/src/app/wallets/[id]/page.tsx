import { AccountDetailClient } from "@/components/AccountDetailClient";

export default async function WalletDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const walletId = Number(id);
  if (!Number.isFinite(walletId) || walletId <= 0) {
    return (
      <section className="scoop-panel">
        <p className="banner bad">Invalid wallet id.</p>
        <p className="muted">
          <a href="/wallets">← Wallets</a>
        </p>
      </section>
    );
  }
  return <AccountDetailClient id={walletId} />;
}
