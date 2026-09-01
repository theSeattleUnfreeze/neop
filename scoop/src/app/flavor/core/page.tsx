import { CatalogClient } from "@/components/CatalogClient";

export default function CoreFlavorPage() {
  return (
    <CatalogClient
      mode="core"
      title="Core flavor"
      blurb="UTXOs present on the Core tip (including the Core side of both)."
    />
  );
}
