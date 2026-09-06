import { AccountDetailClient } from "@/components/AccountDetailClient";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return (
      <section className="scoop-panel">
        <p className="banner bad">Invalid account id.</p>
        <p className="muted">
          <a href="/accounts">← Accounts</a>
        </p>
      </section>
    );
  }
  return <AccountDetailClient id={accountId} />;
}
