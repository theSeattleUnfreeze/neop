"use client";

import { useState } from "react";
import { clearWalletsOverviewCache } from "@/lib/organizer/walletsCache";

const LOCAL = { "content-type": "application/json", "x-scoop-local": "1" };
const PM_NAME = "Scoop backup";

async function readError(res: Response): Promise<string> {
  try {
    const json = await res.json();
    if (typeof json.error === "string") return json.error;
  } catch {
    /* non-json */
  }
  return "request failed";
}

export function BackupClient() {
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const download = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm-password") ?? "");
    setSaveError(null);
    setSaveMsg(null);
    if (password !== confirm) {
      setSaveError("Those passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/organizer/backup", {
        method: "POST",
        headers: LOCAL,
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setSaveError(await readError(res));
        return;
      }
      const blob = await res.blob();
      const header = res.headers.get("Content-Disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(header)?.[1] ?? "scoop-backup.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = named;
      link.click();
      URL.revokeObjectURL(url);
      setSaveMsg(`Saved ${named}. Keep that file and the password. Scoop cannot recover either one.`);
      form.reset();
      const user = form.elements.namedItem("username");
      if (user instanceof HTMLInputElement) user.value = PM_NAME;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "backup failed");
    } finally {
      setSaving(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    setRestoreError(null);
    setRestoreMsg(null);
    if (!file) {
      setFileText(null);
      setFileName(null);
      return;
    }
    setFileName(file.name);
    setFileText(await file.text());
  };

  const restore = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    setRestoreError(null);
    setRestoreMsg(null);
    if (!fileText) {
      setRestoreError("Choose a backup file first.");
      return;
    }
    if (data.get("replace") !== "on") {
      setRestoreError("Confirm that this replaces the wallets currently in Scoop.");
      return;
    }
    setRestoring(true);
    try {
      const res = await fetch("/api/organizer/backup/restore", {
        method: "POST",
        headers: LOCAL,
        body: JSON.stringify({ password, file: fileText }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRestoreError(typeof json.error === "string" ? json.error : "restore failed");
        return;
      }
      clearWalletsOverviewCache();
      const n = Number(json.wallets ?? 0);
      setRestoreMsg(`Restored ${n} wallet${n === 1 ? "" : "s"}.`);
      const passwordInput = form.elements.namedItem("password");
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
      const replace = form.elements.namedItem("replace");
      if (replace instanceof HTMLInputElement) replace.checked = false;
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "restore failed");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>Backup</h2>
        <p className="muted">
          Scoop keeps wallets, watches, notes, and coin history in a local database. Clearing this
          browser does not delete them. Keep an encrypted file on your disk so you can reload that
          database if it is lost.
        </p>
        <p>
          The file is encrypted. Use a long password and let your password manager save it under{" "}
          <strong>{PM_NAME}</strong>. Scoop does not keep a copy of the password.
        </p>
      </section>

      <section className="scoop-panel">
        <h3>Save an encrypted backup</h3>
        <form autoComplete="on" onSubmit={download}>
          <label className="field" htmlFor="scoop-backup-username">
            <span>Password manager name</span>
            <input
              id="scoop-backup-username"
              name="username"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              defaultValue={PM_NAME}
            />
          </label>
          <label className="field" htmlFor="scoop-backup-password">
            <span>Backup password</span>
            <input
              id="scoop-backup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              minLength={8}
            />
          </label>
          <label className="field" htmlFor="scoop-backup-confirm">
            <span>Confirm password</span>
            <input
              id="scoop-backup-confirm"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              minLength={8}
            />
          </label>
          <button type="submit" className="scoop-btn" disabled={saving}>
            {saving ? "Encrypting…" : "Download encrypted backup"}
          </button>
        </form>
        {saveError ? <p className="banner bad">{saveError}</p> : null}
        {saveMsg ? <p className="banner ok">{saveMsg}</p> : null}
      </section>

      <section className="scoop-panel">
        <h3>Restore a backup</h3>
        <p className="muted">
          This replaces the wallets, tasks, and coin history currently in Scoop with the file you
          choose.
        </p>
        <form autoComplete="on" onSubmit={restore}>
          <label className="field" htmlFor="scoop-restore-username">
            <span>Password manager name</span>
            <input
              id="scoop-restore-username"
              name="username"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              defaultValue={PM_NAME}
            />
          </label>
          <label className="field" htmlFor="scoop-restore-password">
            <span>Backup password</span>
            <input
              id="scoop-restore-password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              minLength={8}
            />
          </label>
          <label className="field" htmlFor="scoop-restore-file">
            <span>Backup file</span>
            <input
              id="scoop-restore-file"
              name="backup-file"
              type="file"
              accept="application/json,.json"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          {fileName ? <p className="muted">{fileName}</p> : null}
          <label className="field field-check" htmlFor="scoop-restore-replace">
            <input id="scoop-restore-replace" name="replace" type="checkbox" />
            <span>Replace the wallets currently in Scoop</span>
          </label>
          <button type="submit" className="scoop-btn" disabled={restoring}>
            {restoring ? "Restoring…" : "Restore backup"}
          </button>
        </form>
        {restoreError ? <p className="banner bad">{restoreError}</p> : null}
        {restoreMsg ? <p className="banner ok">{restoreMsg}</p> : null}
      </section>
    </div>
  );
}
