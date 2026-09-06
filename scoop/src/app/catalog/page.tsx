import { CatalogClient } from "@/components/CatalogClient";

export default function CatalogNeapolitanPage() {
  return (
    <CatalogClient
      mode="neapolitan"
      title="Neapolitan"
      blurb="All watched coins, color-coded by tip presence (Core brown, Knots pink, both cream)."
    />
  );
}
