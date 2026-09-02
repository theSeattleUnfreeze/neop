import { AccountDetailClient } from "@/components/AccountDetailClient";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AccountDetailClient id={Number(id)} />;
}
