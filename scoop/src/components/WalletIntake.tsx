"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  addressError,
  derivationPathError,
  gapLimitError,
  labelError,
  parseGapLimit,
  satsError,
  scripthashError,
  xpubError,
  type IntakeKind,
} from "@/lib/organizer/walletIntake";
import { DEFAULT_GAP_LIMIT } from "@/lib/electrum/gap";

type Step = "kind" | "label" | "xpub" | "address" | "manual" | "review";

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

type Preview = {
  emptyWatch: boolean;
  reachable: boolean;
  used: boolean;
  gapLimit: number;
  addressCount: number;
  sampleAddress?: string | null;
  accountPath?: string;
  scriptKind?: string;
};

type Props = {
  hasWallets: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onCreated: () => Promise<void>;
};

function Optional() {
  return <em className="optional-tag">(optional)</em>;
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return <span className="field-error">{message}</span>;
}

export function WalletIntake({ hasWallets, open, onOpen, onClose, onCreated }: Props) {
  const [kind, setKind] = useState<IntakeKind | null>(null);
  const [step, setStep] = useState<Step>("kind");
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [reminder, setReminder] = useState("");
  const [xpub, setXpub] = useState("");
  const [derivationPath, setDerivationPath] = useState("");
  const [gapLimit, setGapLimit] = useState(String(DEFAULT_GAP_LIMIT));
  const [includeChange, setIncludeChange] = useState(false);
  const [discover, setDiscover] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [address, setAddress] = useState("");
  const [scripthash, setScripthash] = useState("");
  const [manualCore, setManualCore] = useState("");
  const [manualKnots, setManualKnots] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [savedPending, setSavedPending] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [sparrowPassword, setSparrowPassword] = useState("");
  const [sparrowNote, setSparrowNote] = useState("");
  const [sparrowChoices, setSparrowChoices] = useState<
    { label: string; xpub: string; derivationPath: string }[]
  >([]);
  const [sparrowFileName, setSparrowFileName] = useState("");
  const [multisig, setMultisig] = useState<{
    m: number;
    n: number;
    cosigners: {
      label: string;
      xpub: string;
      derivationPath: string;
      masterFingerprint: string;
    }[];
  } | null>(null);
  const sparrowFile = useRef("");

  const mark = (key: string) => setTouched((t) => ({ ...t, [key]: true }));
  const bind = (key: string, setter: (value: string) => void) => ({
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      mark(key);
      setter(e.target.value);
    },
    onBlur: () => mark(key),
  });

  const reset = useCallback(() => {
    setKind(null);
    setStep("kind");
    setDir("fwd");
    setLabel("");
    setNotes("");
    setReminder("");
    setXpub("");
    setDerivationPath("");
    setGapLimit(String(DEFAULT_GAP_LIMIT));
    setIncludeChange(false);
    setDiscover(true);
    setShowAdvanced(false);
    setAddress("");
    setScripthash("");
    setManualCore("");
    setManualKnots("");
    setBusy(false);
    setError(null);
    setPreview(null);
    setPreviewing(false);
    setSavedPending(false);
    setTouched({});
    setSparrowPassword("");
    setSparrowNote("");
    setSparrowChoices([]);
    setSparrowFileName("");
    setMultisig(null);
    sparrowFile.current = "";
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const steps: Step[] = useMemo(() => {
    if (kind === "wallet") return ["kind", "label", "xpub", "review"];
    if (kind === "address") return ["kind", "label", "address"];
    if (kind === "manual") return ["kind", "label", "manual"];
    return ["kind"];
  }, [kind]);

  const stepIndex = Math.max(0, steps.indexOf(step));
  const isLast = step === steps[steps.length - 1];

  const kindOk = kind !== null;
  const labelErr = labelError(label);
  const xpubErr = multisig ? null : xpubError(xpub);
  const pathErr = derivationPathError(derivationPath);
  const gapErr = gapLimitError(gapLimit);
  const addrErr = addressError(address);
  const shErr = scripthashError(scripthash);
  const coreErr = satsError(manualCore);
  const knotsErr = satsError(manualKnots);

  const canProceed = (() => {
    if (step === "kind") return kindOk;
    if (step === "label") return !labelErr;
    if (step === "xpub") return (Boolean(multisig) || !xpubErr) && !pathErr && !gapErr;
    if (step === "address") return !addrErr && !shErr;
    if (step === "manual") return !labelErr && !coreErr && !knotsErr;
    if (step === "review") return !busy;
    return false;
  })();

  const go = (next: Step, direction: "fwd" | "back") => {
    setError(null);
    setDir(direction);
    setStep(next);
  };

  const back = () => {
    if (stepIndex <= 0) {
      if (hasWallets) {
        reset();
        onClose();
      }
      return;
    }
    go(steps[stepIndex - 1], "back");
  };

  const buildBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      label: label.trim(),
      notes,
      reminder,
      source: kind === "manual" ? "manual" : "electrum",
    };
    if (kind === "manual") {
      if (manualCore.trim()) body.manualCoreSats = manualCore.trim();
      if (manualKnots.trim()) body.manualKnotsSats = manualKnots.trim();
    } else if (kind === "wallet") {
      if (multisig) {
        body.multisig = {
          m: multisig.m,
          cosigners: multisig.cosigners.map((c) => ({
            extendedKey: c.xpub,
            derivation: c.derivationPath || undefined,
            label: c.label || undefined,
            masterFingerprint: c.masterFingerprint || undefined,
          })),
        };
      } else {
        body.xpub = xpub.trim();
        if (derivationPath.trim()) body.derivationPath = derivationPath.trim();
        body.discover = discover;
      }
      body.gapLimit = parseGapLimit(gapLimit);
      body.includeChange = includeChange;
    } else {
      body.scripts = [
        {
          address: address.trim() || undefined,
          scripthash: scripthash.trim() || undefined,
        },
      ];
    }
    return body;
  };

  const readJson = async (res: Response): Promise<Record<string, unknown>> => {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: `HTTP ${res.status}` };
    }
  };

  const runPreview = useCallback(async () => {
    if (kind !== "wallet") return;
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch("/api/organizer/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...buildBody(), preview: true }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Could not check this wallet");
      }
      const emptyWatch = Boolean(json.emptyWatch);
      setPreview({
        emptyWatch,
        reachable: Boolean(json.reachable),
        used: Boolean(json.used),
        gapLimit: Number(json.gapLimit ?? parseGapLimit(gapLimit)),
        addressCount: Number(json.addressCount ?? 0),
        sampleAddress: typeof json.sampleAddress === "string" ? json.sampleAddress : null,
        accountPath: typeof json.accountPath === "string" ? json.accountPath : null,
        scriptKind: typeof json.scriptKind === "string" ? json.scriptKind : null,
      });
      if (emptyWatch) setShowAdvanced(true);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
    // buildBody reads latest state on call
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, label, notes, reminder, xpub, derivationPath, gapLimit, includeChange, discover]);

  useEffect(() => {
    if (open && step === "review" && kind === "wallet") {
      void runPreview();
    }
    // Gap edits on the empty-watch prompt use Check again, not this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, kind]);

  const inspectSparrow = async (fileBase64: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sparrow/inspect", {
        method: "POST",
        headers: { "content-type": "application/json", "x-scoop-local": "1" },
        body: JSON.stringify({ fileBase64, password: password || undefined }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "could not read that wallet file");
      const accounts = (json.accounts ?? []) as {
        label: string;
        xpub: string;
        derivationPath: string;
        masterFingerprint?: string;
      }[];
      setSparrowNote(typeof json.note === "string" ? json.note : "");
      const multiFromApi = json.multisig as
        | {
            m: number;
            n: number;
            cosigners: {
              label: string;
              xpub: string;
              derivationPath: string;
              masterFingerprint: string;
            }[];
          }
        | undefined;
      // Prefer the server multisig object. If an older bundle only sent cosigner
      // accounts for a MULTI Electrum file, rebuild the quorum from those keys.
      const namePolicy =
        typeof json.name === "string" ? /^(\d+)-of-(\d+)/i.exec(json.name) : null;
      const multi =
        multiFromApi && Array.isArray(multiFromApi.cosigners) && multiFromApi.cosigners.length >= 2
          ? multiFromApi
          : json.policyType === "MULTI" &&
              accounts.length >= 2 &&
              accounts.every((a) => /^(Zpub|Ypub|Vpub|Upub)/.test(a.xpub))
            ? {
                m: namePolicy ? Number(namePolicy[1]) : multiFromApi?.m ?? 0,
                n: namePolicy ? Number(namePolicy[2]) : accounts.length,
                cosigners: accounts.map((a) => ({
                  label: a.label,
                  xpub: a.xpub,
                  derivationPath: a.derivationPath,
                  masterFingerprint: a.masterFingerprint ?? "",
                })),
              }
            : null;
      if (multi && (!Number.isInteger(multi.m) || multi.m < 1 || multi.m > multi.n)) {
        setError("Could not read the multisig threshold from that file.");
        setBusy(false);
        return;
      }
      if (multi) {
        setMultisig({
          m: multi.m,
          n: multi.n,
          cosigners: multi.cosigners,
        });
        setXpub("");
        setDerivationPath(multi.cosigners[0]?.derivationPath || "");
        setSparrowChoices([]);
        setDiscover(false);
        setLabel(
          (current) => current.trim() || (typeof json.name === "string" ? json.name : "") || current
        );
      } else {
        setMultisig(null);
        setSparrowChoices(accounts);
        const first = accounts[0];
        if (first) {
          setXpub(first.xpub);
          if (first.derivationPath) setDerivationPath(first.derivationPath);
          setLabel(
            (current) => current.trim() || (typeof json.name === "string" ? json.name : "") || current
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSparrowFile = async (file: File | undefined) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    sparrowFile.current = bytesToBase64(buf);
    setSparrowFileName(file.name);
    await inspectSparrow(sparrowFile.current, sparrowPassword);
  };

  const create = async () => {
    if (!canProceed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/organizer/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await readJson(res);
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "create failed");
      }
      await onCreated();
      const sync = json.sync as { pending?: boolean } | undefined;
      if (sync?.pending) {
        setSavedPending(true);
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (!canProceed) return;
    if (isLast) {
      void create();
      return;
    }
    go(steps[stepIndex + 1], "fwd");
  };

  if (!open) {
    if (!hasWallets) return null;
    return (
      <section className="scoop-panel">
        <button type="button" className="scoop-btn" onClick={onOpen}>
          + Add a wallet
        </button>
      </section>
    );
  }

  return (
    <section className="scoop-panel">
      <div className="wizard-head">
        <h3>Add wallet</h3>
        <p className="muted wizard-progress">
          Step {stepIndex + 1} of {steps.length}
        </p>
      </div>
      {error ? <p className="banner bad">{error}</p> : null}

      <div className={`wizard-pane is-${dir}`} key={step}>
        {step === "kind" ? (
          <>
            <p className="muted">What do you want Scoop to watch?</p>
            <div className="choice-row">
              <button
                type="button"
                className={`choice-card${kind === "wallet" ? " is-selected" : ""}`}
                onClick={() => {
                  setKind("wallet");
                  go("label", "fwd");
                }}
              >
                <strong>Entire wallet</strong>
                <span>xpub from Sparrow or Shrike — a set of addresses</span>
              </button>
              <button
                type="button"
                className={`choice-card${kind === "address" ? " is-selected" : ""}`}
                onClick={() => {
                  setKind("address");
                  go("label", "fwd");
                }}
              >
                <strong>Single address</strong>
                <span>One bc1… / 3… / 1… address</span>
              </button>
            </div>
            <p className="muted">
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setKind("manual");
                  go("label", "fwd");
                }}
              >
                Or a notes-only estimate
              </button>
            </p>
          </>
        ) : null}

        {step === "label" ? (
          <>
            <label className="field">
              <span>Name</span>
              <input
                value={label}
                placeholder="Sparrow cold"
                {...bind("label", setLabel)}
              />
              <FieldError message={touched.label ? labelErr : null} />
            </label>
            <label className="field">
              <span>
                Notes <Optional />
              </span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Where / how watched"
              />
            </label>
            <label className="field">
              <span>
                Reminder <Optional />
              </span>
              <input
                value={reminder}
                onChange={(e) => setReminder(e.target.value)}
                placeholder="Check OP_RETURN wedge before spend"
              />
            </label>
          </>
        ) : null}

        {step === "xpub" ? (
          <>
            <p className="muted">
              In Sparrow or Shrike, open the wallet and the account <strong>Settings</strong> tab.
              Copy the <strong>Extended Public Key</strong>, and the derivation path if one is shown.
              Paste the key below. <strong>File → Export Wallet → Sparrow</strong> writes a{" "}
              <code>.mv.db</code> database so another Sparrow can open it. Scoop does not read that
              file. <strong>File → Export Wallet → Electrum</strong> writes a small JSON file this
              form can open. Scoop keeps the account key. A <code>zpub</code> or <code>ypub</code>{" "}
              uses its usual path; otherwise paste the derivation path too.
            </p>
            <label className="field">
              <span>Older wallet file</span>
              <input type="file" onChange={(e) => void onSparrowFile(e.target.files?.[0])} />
              <span className="muted">
                A JSON wallet, or an encrypted Sparrow file with no extension. The password opens it
                in memory. Scoop keeps the account xpub and drops the seed.
              </span>
            </label>
            <label className="field">
              <span>
                Wallet password <Optional />
              </span>
              <input
                type="password"
                value={sparrowPassword}
                autoComplete="off"
                onChange={(e) => setSparrowPassword(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="scoop-btn ghost"
              disabled={!sparrowFile.current || busy}
              onClick={() => void inspectSparrow(sparrowFile.current, sparrowPassword)}
            >
              {sparrowFileName ? `Open ${sparrowFileName}` : "Open file"}
            </button>
            {sparrowNote ? <p className="banner warn">{sparrowNote}</p> : null}
            {multisig ? (
              <p className="banner">
                Loaded a {multisig.m}-of-{multisig.n} multisig ({multisig.n} cosigners
                {derivationPath ? ` at ${derivationPath}` : ""}). Scoop will watch outpoints owned
                by that quorum — not each cosigner as a separate wallet. Continue with Next.
              </p>
            ) : null}
            {sparrowChoices.length > 1 && !multisig ? (
              <label className="field">
                <span>Which singlesig account to watch</span>
                <select
                  value={xpub}
                  onChange={(e) => {
                    const picked = sparrowChoices.find((account) => account.xpub === e.target.value);
                    if (!picked) return;
                    setXpub(picked.xpub);
                    if (picked.derivationPath) setDerivationPath(picked.derivationPath);
                  }}
                >
                  {sparrowChoices.map((account) => (
                    <option key={account.xpub} value={account.xpub}>
                      {account.label || account.derivationPath || "account"}
                    </option>
                  ))}
                </select>
                <span className="muted">
                  This picker is only for files with several separate singlesig accounts. A 2-of-3
                  Electrum export should load as one quorum wallet instead — re-open the file if you
                  still see this.
                </span>
              </label>
            ) : null}
            {!multisig ? (
              <>
                <label className="field">
                  <span>Extended public key</span>
                  <input
                    value={xpub}
                    placeholder="Sparrow → Settings → Copy Extended Public Key"
                    spellCheck={false}
                    {...bind("xpub", setXpub)}
                  />
                  <FieldError message={touched.xpub ? xpubErr : null} />
                </label>
                <label className="field">
                  <span>
                    Derivation path <Optional />
                  </span>
                  <input
                    value={derivationPath}
                    placeholder="default from key type — e.g. m/84'/0'/0'"
                    spellCheck={false}
                    {...bind("path", setDerivationPath)}
                  />
                  <FieldError message={touched.path ? pathErr : null} />
                </label>
                <p className="muted">
                  zpub → native segwit, ypub → nested, xpub → auto-detect unless you set a path.
                  Electrum multisig exports (Zpub / 2of3) load as the full policy above.
                </p>
              </>
            ) : null}
            <button
              type="button"
              className="scoop-btn ghost"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide advanced" : "Advanced settings"}
            </button>
            {showAdvanced ? (
              <div className="advanced-block">
                <label className="field">
                  <span>
                    Receive addresses to watch <Optional />
                  </span>
                  <input
                    value={gapLimit}
                    placeholder={String(DEFAULT_GAP_LIMIT)}
                    {...bind("gap", setGapLimit)}
                  />
                  <FieldError message={touched.gap ? gapErr : null} />
                  <span className="muted">Default {DEFAULT_GAP_LIMIT}. Raise this if the wallet has a large unused gap.</span>
                </label>
                <label className="field field-check">
                  <input
                    type="checkbox"
                    checked={discover}
                    onChange={(e) => setDiscover(e.target.checked)}
                  />
                  <span>
                    If this is a plain xpub, probe Electrum to detect native / nested / legacy /
                    taproot
                  </span>
                </label>
                <label className="field field-check">
                  <input
                    type="checkbox"
                    checked={includeChange}
                    onChange={(e) => setIncludeChange(e.target.checked)}
                  />
                  <span>Also watch change addresses (1/i)</span>
                </label>
              </div>
            ) : null}
          </>
        ) : null}

        {step === "address" ? (
          <>
            <label className="field">
              <span>Address</span>
              <input
                value={address}
                placeholder="bc1q… / 3… / 1…"
                spellCheck={false}
                {...bind("address", setAddress)}
              />
              <FieldError message={touched.address ? addrErr : null} />
            </label>
            <label className="field">
              <span>
                Electrum scripthash <Optional />
              </span>
              <input
                value={scripthash}
                placeholder="64 hex — only if you already have it"
                spellCheck={false}
                {...bind("scripthash", setScripthash)}
              />
              <FieldError message={touched.scripthash ? shErr : null} />
            </label>
          </>
        ) : null}

        {step === "manual" ? (
          <>
            <label className="field">
              <span>
                Estimated Core sats <Optional />
              </span>
              <input value={manualCore} {...bind("manualCore", setManualCore)} />
              <FieldError message={touched.manualCore ? coreErr : null} />
            </label>
            <label className="field">
              <span>
                Estimated Knots sats <Optional />
              </span>
              <input value={manualKnots} {...bind("manualKnots", setManualKnots)} />
              <FieldError message={touched.manualKnots ? knotsErr : null} />
            </label>
          </>
        ) : null}

        {step === "review" ? (
          <>
            {savedPending ? (
              <p className="banner warn">
                Wallet saved. We&apos;re trying to sync your wallet. The node isn&apos;t answering
                yet — check back later.
              </p>
            ) : null}
            {previewing && !savedPending ? (
              <p className="banner warn">
                We&apos;re trying to sync your wallet. You can add it now and check back later if
                the node isn&apos;t up.
              </p>
            ) : null}
            {preview && !preview.emptyWatch && preview.reachable && !savedPending ? (
              <p className="banner">
                Found activity. Watching {preview.addressCount} address
                {preview.addressCount === 1 ? "" : "es"}
                {preview.accountPath ? ` at ${preview.accountPath}` : ""}.
              </p>
            ) : null}
            {preview && !preview.reachable && !savedPending ? (
              <p className="banner warn">
                The node isn&apos;t answering yet. Add the wallet now. We&apos;re trying to sync
                it — check back later.
              </p>
            ) : null}
            {preview?.emptyWatch && !savedPending ? (
              <div className="banner warn">
                <p>
                  No transactions on the first {preview.gapLimit} receive addresses. If this
                  wallet has a large gap (many unused addresses before coins), raise the count
                  below and check again. Double-check the xpub if you expected a balance.
                </p>
                <label className="field">
                  <span>Receive addresses to watch</span>
                  <input
                    value={gapLimit}
                    placeholder={String(DEFAULT_GAP_LIMIT)}
                    {...bind("gap", setGapLimit)}
                  />
                  <FieldError message={touched.gap ? gapErr : null} />
                </label>
                <button
                  type="button"
                  className="scoop-btn ghost"
                  onClick={() => void runPreview()}
                  disabled={previewing || Boolean(gapErr)}
                >
                  Check again
                </button>
              </div>
            ) : null}
            {multisig ? (
              <p className="muted">
                Policy:{" "}
                <strong>
                  {multisig.m}-of-{multisig.n} multisig
                </strong>
              </p>
            ) : null}
            <p className="muted">
              Name: <strong>{label}</strong>
            </p>
          </>
        ) : null}
      </div>

      <div className="wizard-actions">
        <button
          type="button"
          className="scoop-btn ghost"
          onClick={back}
          disabled={busy || (stepIndex === 0 && !hasWallets)}
        >
          {stepIndex === 0 && hasWallets ? "Cancel" : "Back"}
        </button>
        <button
          type="button"
          className={`scoop-btn${busy ? " is-busy" : ""}`}
          onClick={() => {
            if (savedPending) onClose();
            else next();
          }}
          disabled={savedPending ? false : !canProceed || busy}
        >
          {savedPending ? "Done" : busy ? "Saving…" : isLast ? "Add wallet" : "Next"}
        </button>
      </div>
    </section>
  );
}
