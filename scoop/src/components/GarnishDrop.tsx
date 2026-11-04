"use client";

import { useState } from "react";
import { garnishUnsignedPsbt, nextWedge, wedgeCycleStart, type GarnishResult, type PayloadKind } from "@/lib/psbt/garnish";

const KIND_LABEL: Record<PayloadKind, string> = {
  bytes: "raw bytes",
  text: "text",
  hex: "hex",
  pushes: "several pushes",
};

type Item = {
  name: string;
  error?: string;
  result?: GarnishResult;
};

export function GarnishDrop() {
  const [items, setItems] = useState<Item[]>([]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Item[] = [];
    const start = wedgeCycleStart();
    for (const [index, file] of Array.from(files).entries()) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        next.push({ name: file.name, result: garnishUnsignedPsbt(bytes, nextWedge(start + index)) });
      } catch (err) {
        next.push({ name: file.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    setItems(next);
  };

  const download = (item: Item) => {
    if (!item.result) return;
    const bin = Uint8Array.from(atob(item.result.psbtBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bin], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name.replace(/\.psbt$/i, "") + ".garnish.psbt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>Core garnish</h2>
        <p>
          Drop unsigned Core PSBTs from Sparrow, one coin in each. Scoop adds an OP_RETURN whose
          script is longer than 83 bytes, so Knots will not accept the transaction while the
          reduced-data rule holds (through 2027-09-01). The script stays within 84 to 120 bytes, and
          the files in one drop rotate through raw bytes, text, hex, and several pushes. Nothing is
          shared between them. Scoop does not join the files, does not sign, and does not broadcast.
        </p>
        <p>
          In Sparrow, spend the whole coin to one fresh address and save the unsigned PSBT. No
          change output. Sign on the Coldcards only after the garnish is in the file. A signature
          commits to the outputs, so a PSBT that is already signed cannot take an OP_RETURN. The
          Shrike transactions, with unified sighash, are the Knots half. Do not drop those here.
        </p>
        <p className="banner warn">
          This machine’s Core node has no datacarrier override. Bitcoin Core 28 keeps the default
          83-byte limit, so it will refuse to relay the garnish until <span className="mono">datacarriersize</span> is
          set to at least 120 and the node is restarted. A script here is at most 120
          bytes. Do that before broadcast, not by stopping Core while Fulcrum is still downloading
          blocks.
        </p>
        <label className="field">
          <span>Unsigned PSBTs</span>
          <input
            type="file"
            multiple
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
      </section>
      {items.length ? (
        <section className="scoop-panel">
          <h3>Results</h3>
          <ul className="garnish-results">
            {items.map((item, index) => (
              <li key={`${index}:${item.name}`}>
                <strong className="mono">{item.name}</strong>
                {item.error ? <p className="banner bad">{item.error}</p> : null}
                {item.result ? (
                  <>
                    <p>
                      One input. {KIND_LABEL[item.result.kind]}, {item.result.dataBytes} data bytes. OP_RETURN
                      script is {item.result.scriptPubKeyLength} bytes. Fee{" "}
                      {item.result.feeSatsBefore.toLocaleString()} → {item.result.feeSatsAfter.toLocaleString()} sats.
                    </p>
                    <button type="button" className="scoop-btn" onClick={() => download(item)}>
                      Download garnished PSBT
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
