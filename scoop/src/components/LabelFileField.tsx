"use client";

import { parseBip329, type LabelRecord } from "@/lib/labels/bip329";

export function LabelFileField({
  fileName,
  error,
  count,
  onParsed,
}: {
  fileName: string;
  error: string | null;
  count: number;
  onParsed: (fileName: string, records: LabelRecord[], suggestedName: string | null, error: string | null) => void;
}) {
  const read = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseBip329(text);
    if (!parsed.ok) {
      onParsed(file.name, [], null, parsed.error);
      return;
    }
    onParsed(file.name, parsed.records, parsed.suggestedName, null);
  };

  return (
    <label
      className="field label-drop"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void read(event.dataTransfer.files?.[0]);
      }}
    >
      <span>Wallet labels</span>
      <input type="file" accept=".jsonl,.json,.txt" onChange={(event) => void read(event.target.files?.[0])} />
      <span className="muted">
        Optional. Sparrow writes a <span className="mono">.jsonl</span> labels file, including the sidecar next to the
        wallet. An empty file is fine.
        {fileName ? ` ${fileName}: ${count} label${count === 1 ? "" : "s"}.` : ""}
      </span>
      {error ? <span className="banner bad">{error}</span> : null}
    </label>
  );
}
