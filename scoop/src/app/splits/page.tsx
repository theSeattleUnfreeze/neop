import { Suspense } from "react";
import { SplitsClient } from "@/components/SplitsClient";

export default function SplitsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SplitsClient />
    </Suspense>
  );
}
