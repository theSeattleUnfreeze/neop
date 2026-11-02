import fs from "node:fs";
import { ElectrumClient } from "@/lib/electrum/client";
import type { StackConfig, StackService, StackStatusRow } from "@/lib/stack/types";
import { summarizeStack } from "@/lib/stack/summarize";

const PROBE_MS = 8_000;

type RpcInfo = {
  blocks?: number;
  headers?: number;
  initialblockdownload?: boolean;
  verificationprogress?: number;
};

async function readCookie(cookieFile: string): Promise<{ user: string; password: string } | null> {
  if (!cookieFile || !fs.existsSync(cookieFile)) return null;
  const raw = fs.readFileSync(cookieFile, "utf8").trim();
  const split = raw.indexOf(":");
  if (split <= 0) return null;
  return { user: raw.slice(0, split), password: raw.slice(split + 1) };
}

async function probeRpc(svc: StackService): Promise<Pick<StackStatusRow, "state" | "height" | "headers" | "detail">> {
  if (!svc.endpoint) {
    return { state: "unset", height: null, headers: null, detail: "No RPC URL yet." };
  }
  const cookie = await readCookie(svc.cookieFile);
  const headers: Record<string, string> = { "content-type": "text/plain" };
  if (cookie) {
    headers.authorization = `Basic ${Buffer.from(`${cookie.user}:${cookie.password}`).toString("base64")}`;
  }
  try {
    const res = await fetch(svc.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "scoop",
        method: "getblockchaininfo",
        params: [],
      }),
      signal: AbortSignal.timeout(PROBE_MS),
    });
    const body = (await res.json()) as { result?: RpcInfo; error?: { message?: string } };
    if (!res.ok || body.error || !body.result) {
      const message = body.error?.message || `HTTP ${res.status}`;
      return { state: "down", height: null, headers: null, detail: message };
    }
    const info = body.result;
    const ibd = info.initialblockdownload ? " still syncing" : "";
    const progress =
      typeof info.verificationprogress === "number"
        ? ` (${Math.min(100, info.verificationprogress * 100).toFixed(1)}%)`
        : "";
    return {
      state: "up",
      height: typeof info.blocks === "number" ? info.blocks : null,
      headers: typeof info.headers === "number" ? info.headers : null,
      detail: `RPC answering${ibd}${progress}`,
    };
  } catch (err) {
    return {
      state: "down",
      height: null,
      headers: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeElectrum(
  svc: StackService
): Promise<Pick<StackStatusRow, "state" | "height" | "headers" | "detail">> {
  if (!svc.endpoint) {
    return { state: "unset", height: null, headers: null, detail: "No Electrum URL yet." };
  }
  const client = ElectrumClient.fromUrl(svc.endpoint);
  try {
    await client.connect(PROBE_MS);
    const version = (await client.serverVersion()) as unknown;
    const banner = Array.isArray(version) ? String(version[0]) : "Electrum";
    const tip = (await client.call("blockchain.headers.subscribe", [])) as { height?: number };
    const height = typeof tip?.height === "number" ? tip.height : null;
    return {
      state: "up",
      height,
      headers: height,
      detail: height != null ? `${banner} tip ${height.toLocaleString()}` : banner,
    };
  } catch (err) {
    return {
      state: "down",
      height: null,
      headers: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    client.close();
  }
}

async function probeLink(
  svc: StackService
): Promise<Pick<StackStatusRow, "state" | "height" | "headers" | "detail">> {
  if (!svc.endpoint) {
    return { state: "unset", height: null, headers: null, detail: "No tunnel RPC URL yet." };
  }
  return probeRpc(svc);
}

async function probeOne(svc: StackService): Promise<StackStatusRow> {
  const probed =
    svc.id === "core-fulcrum" || svc.id === "knots-fulcrum"
      ? await probeElectrum(svc)
      : svc.id === "knots-link"
        ? await probeLink(svc)
        : await probeRpc(svc);
  return {
    id: svc.id,
    label: svc.label,
    control: svc.control,
    endpoint: svc.endpoint,
    configFile: svc.configFile,
    datadir: svc.datadir,
    files: svc.files,
    ...probed,
  };
}

export async function probeStack(config: StackConfig): Promise<{
  catalogReady: boolean;
  summary: string;
  rows: StackStatusRow[];
}> {
  const rows = await Promise.all(config.services.map((svc) => probeOne(svc)));
  const head = summarizeStack(rows);
  return { ...head, rows };
}
