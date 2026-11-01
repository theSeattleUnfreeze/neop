import { CatalogClient } from "@/components/CatalogClient";

export default function SpillsPage() {
  return (
    <CatalogClient
      mode="spills"
      title="Spills"
      blurb="Likely replays: spent on both Core and Knots. Alarm if you expected a Core-only ceremony to leave Knots unspent."
    />
  );
}
