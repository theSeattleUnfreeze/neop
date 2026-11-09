/**
 * BIP-329 wallet labels. The extended key on an xpub line is never kept.
 */

export type LabelRecord = {
  type: "tx" | "addr" | "output";
  ref: string;
  label: string;
};

export type ParsedLabels =
  | { ok: true; records: LabelRecord[]; suggestedName: string | null }
  | { ok: false; error: string };

const TX = /^[0-9a-fA-F]{64}$/;
const OUT = /^[0-9a-fA-F]{64}:[0-9]+$/;
const MAX_LABEL = 200;

function fail(line: number): ParsedLabels {
  return { ok: false, error: `Line ${line} is not a label record.` };
}

export function parseBip329(text: string): ParsedLabels {
  const records: LabelRecord[] = [];
  let suggestedName: string | null = null;
  if (text.trim() === "") return { ok: true, records, suggestedName };
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return fail(index + 1);
    }
    if (!value || typeof value !== "object") return fail(index + 1);
    const type = (value as { type?: unknown }).type;
    const ref = (value as { ref?: unknown }).ref;
    const label = (value as { label?: unknown }).label;
    if (typeof type !== "string" || typeof ref !== "string" || ref.trim() === "") return fail(index + 1);
    if (type === "xpub") {
      if (!suggestedName && typeof label === "string" && label.trim()) suggestedName = label.trim().slice(0, MAX_LABEL);
      continue;
    }
    if (type === "pubkey" || type === "input" || type === "spscan") continue;
    if (type !== "tx" && type !== "addr" && type !== "output") continue;
    if (typeof label !== "string" || label.trim() === "") continue;
    const note = label.trim().slice(0, MAX_LABEL);
    if (type === "tx") {
      if (!TX.test(ref)) return fail(index + 1);
      records.push({ type, ref: ref.toLowerCase(), label: note });
      continue;
    }
    if (type === "output") {
      if (!OUT.test(ref)) return fail(index + 1);
      const [txid, vout] = ref.split(":");
      records.push({ type, ref: `${txid.toLowerCase()}:${vout}`, label: note });
      continue;
    }
    records.push({ type: "addr", ref: ref.trim(), label: note });
  }
  return { ok: true, records, suggestedName };
}

/** Output label wins. The transaction label is the fallback. */
export function noteForOutpoint(records: LabelRecord[], txid: string, vout: number): string {
  const key = `${txid.toLowerCase()}:${vout}`;
  const output = records.find((record) => record.type === "output" && record.ref === key);
  if (output) return output.label;
  const tx = records.find((record) => record.type === "tx" && record.ref === txid.toLowerCase());
  return tx?.label ?? "";
}

/** Server-side check. An xpub ref is refused even if the client labeled it as something else. */
export function acceptLabelRecords(input: unknown): ParsedLabels {
  if (!Array.isArray(input)) return { ok: false, error: "Missing labels." };
  if (input.length > 5000) return { ok: false, error: "Too many labels." };
  const records: LabelRecord[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return { ok: false, error: "A label record was missing." };
    const type = (item as { type?: unknown }).type;
    const ref = (item as { ref?: unknown }).ref;
    const label = (item as { label?: unknown }).label;
    if (type === "xpub" || (typeof ref === "string" && /^(xpub|ypub|zpub|tpub|upub|vpub)/i.test(ref))) {
      return { ok: false, error: "An extended key is not stored with the labels." };
    }
    if ((type !== "tx" && type !== "addr" && type !== "output") || typeof ref !== "string" || typeof label !== "string") {
      return { ok: false, error: "A label record was missing." };
    }
    if (type === "tx" && !TX.test(ref)) return { ok: false, error: "A transaction label was not a txid." };
    if (type === "output" && !OUT.test(ref)) return { ok: false, error: "An output label was not an outpoint." };
    const note = label.trim().slice(0, MAX_LABEL);
    if (!note) continue;
    records.push({
      type,
      ref: type === "addr" ? ref.trim() : type === "tx" ? ref.toLowerCase() : `${ref.split(":")[0].toLowerCase()}:${ref.split(":")[1]}`,
      label: note,
    });
  }
  return { ok: true, records, suggestedName: null };
}
