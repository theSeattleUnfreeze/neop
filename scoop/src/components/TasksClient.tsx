"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { walletOutpointHref } from "@/lib/organizer/walletLinks";

type Task = {
  id: number;
  title: string;
  body: string;
  kind: string;
  status: string;
  accountId?: number | null;
  metadata?: { txid?: string; vout?: number | string } | null;
  dueAt?: string | null;
  createdAt: string;
};

function metadataVout(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return Number(value);
  return null;
}

function taskHref(task: Task): string | null {
  if (!task.accountId) return null;
  const txid = task.metadata?.txid;
  const vout = metadataVout(task.metadata?.vout);
  if (typeof txid === "string" && vout != null) {
    return walletOutpointHref(task.accountId, txid, vout);
  }
  return `/wallets/${task.accountId}`;
}

export function TasksClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<"open" | "done" | "dismissed" | "all">("open");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/organizer/tasks?status=${filter}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "failed to load tasks");
      return;
    }
    setTasks(json.tasks ?? []);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/organizer/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "create failed");
      setTitle("");
      setBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: number, status: "open" | "done" | "dismissed") => {
    await fetch(`/api/organizer/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
  };

  return (
    <div className="scoop-stack">
      <section className="scoop-panel">
        <h2>Tasks</h2>
        <p className="muted">
          Manual reminders plus auto suggestions for both-tip coins, spills, core-bound ceremonies,
          and replay receives. Dismissing a notification does not close its split task.
        </p>
        {error ? <p className="banner bad">{error}</p> : null}
        <div className="filter-row">
          {(["open", "done", "dismissed", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`scoop-btn ghost${filter === f ? " is-active-filter" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </section>

      <section className="scoop-panel">
        <h3>Add manual task</h3>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Notes</span>
          <input value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <button type="button" className="scoop-btn" onClick={create} disabled={busy || !title.trim()}>
          Add
        </button>
      </section>

      <section className="scoop-panel">
        <h3>{filter === "all" ? "All tasks" : `${filter} tasks`}</h3>
        {!tasks.length ? (
          <p className="muted">None. Sync an Electrum-linked wallet to auto-suggest split work.</p>
        ) : (
          <ul className="task-list">
            {tasks.map((t) => (
              <li key={t.id} className="task-item">
                <div className="task-head">
                  <span className={`kind-pill ${t.kind}`}>{t.kind.replace(/_/g, " ")}</span>
                  {taskHref(t) ? (
                    <Link href={taskHref(t)!} className="task-wallet-link">
                      <strong>{t.title}</strong>
                    </Link>
                  ) : (
                    <strong>{t.title}</strong>
                  )}
                </div>
                {t.body ? <p className="muted">{t.body}</p> : null}
                <div className="dash-actions">
                  {taskHref(t) ? (
                    <Link href={taskHref(t)!} className="scoop-btn ghost">
                      {metadataVout(t.metadata?.vout) != null && t.metadata?.txid
                        ? "View outpoint"
                        : "View wallet"}
                    </Link>
                  ) : null}
                  {t.status === "open" ? (
                    <>
                      <button
                        type="button"
                        className="scoop-btn ghost"
                        onClick={() => setStatus(t.id, "done")}
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        className="scoop-btn ghost"
                        onClick={() => setStatus(t.id, "dismissed")}
                      >
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="scoop-btn ghost"
                      onClick={() => setStatus(t.id, "open")}
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
