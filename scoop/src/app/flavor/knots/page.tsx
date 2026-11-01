import { CatalogClient } from "@/components/CatalogClient";

export default function KnotsFlavorPage() {
  return (
    <CatalogClient
      mode="knots"
      title="Knots flavor"
      blurb="UTXOs present on the Knots tip (including the Knots side of both)."
    />
  );
}
