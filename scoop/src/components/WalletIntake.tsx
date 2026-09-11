"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
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
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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
    setTouched({});
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
  const xpubErr = xpubError(xpub);
  const pathErr = derivationPathError(derivationPath);
  const gapErr = gapLimitError(gapLimit);
  const addrErr = addressError(address);
  const shErr = scripthashError(scripthash);
  const coreErr = satsError(manualCore);
  const knotsErr = satsError(manualKnots);

  const canProceed = (() => {
    if (step === "kind") return kindOk;
    if (step === "label") return !labelErr;
    if (step === "xpub") return !xpubErr && !pathErr && !gapErr;
    if (step === "address") return !addrErr && !shErr;
    if (step === "manual") return !labelErr && !coreErr && !knotsErr;
    if (step === "review") return !previewing && !busy;
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
      body.xpub = xpub.trim();
      if (derivationPath.trim()) body.derivationPath = derivationPath.trim();
      body.gapLimit = parseGapLimit(gapLimit);
      body.includeChange = includeChange;
      body.discover = discover;
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not check this wallet");
      const emptyWatch = Boolean(json.emptyWatch);
      setPreview({
        emptyWatch,
        reachable: Boolean(json.reachable),
        used: Boolean(json.used),
        gapLimit: Number(json.gapLimit ?? parseGapLimit(gapLimit)),
        addressCount: Number(json.addressCount ?? 0),
        sampleAddress: json.sampleAddress,
        accountPath: json.accountPath,
        scriptKind: json.scriptKind,
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "create failed");
      await onCreated();
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
                onClick={() => setKind("wallet")}
              >
                <strong>Entire wallet</strong>
                <span>xpub from Sparrow or Shrike — a set of addresses</span>
              </button>
              <button
                type="button"
                className={`choice-card${kind === "address" ? " is-selected" : ""}`}
                onClick={() => setKind("address")}
              >
                <strong>Single address</strong>
                <span>One bc1… / 3… / 1… address</span>
              </button>
            </div>
            <p className="muted">
              <button
                type="button"
                className="text-link"
                onClick={() => setKind("manual")}
              >
                Or a notes-only estimate
              </button>
              {kind === "manual" ? " — selected" : ""}
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
            </p>
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
            {previewing ? (
              <p className="muted">Checking the first {gapLimit} receive addresses on Electrum…</p>
            ) : null}
            {preview && !preview.emptyWatch && preview.reachable ? (
              <p className="banner">
                Found activity. Watching {preview.addressCount} address
                {preview.addressCount === 1 ? "" : "es"}
                {preview.accountPath ? ` at ${preview.accountPath}` : ""}.
              </p>
            ) : null}
            {preview && !preview.reachable ? (
              <p className="banner warn">
                Electrum was unreachable, so we could not confirm activity. You can still add the
                wallet and sync later.
              </p>
            ) : null}
            {preview?.emptyWatch ? (
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
          disabled={busy || previewing || (stepIndex === 0 && !hasWallets)}
        >
          {stepIndex === 0 && hasWallets ? "Cancel" : "Back"}
        </button>
        <button
          type="button"
          className={`scoop-btn${busy ? " is-busy" : ""}`}
          onClick={next}
          disabled={!canProceed || busy || previewing}
        >
          {busy ? "Saving…" : isLast ? "Add wallet" : "Next"}
        </button>
      </div>
    </section>
  );
}
