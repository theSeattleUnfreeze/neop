import { Suspense } from "react";
import { SplitFlow } from "@/components/SplitFlow";

export default function SplitPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SplitFlow />
    </Suspense>
  );
}
