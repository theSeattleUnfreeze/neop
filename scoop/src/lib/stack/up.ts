import net from "node:net";
import { spawn } from "node:child_process";
import { controlService, startBlockReason } from "@/lib/stack/control";
import type { StackConfig, StackService, StackServiceId } from "@/lib/stack/types";

const LOCAL_START = new Set<StackServiceId>(["core-node", "core-fulcrum", "knots-link"]);

export type UpStep =
  | { id: StackServiceId; label: string; kind: "already-up" }
  | { id: StackServiceId; label: string; kind: "local" }
  | { id: StackServiceId; label: string; kind: "remote" }
  | { id: StackServiceId; label: string; kind: "skip"; reason: string };

/** What scoop.cmd should do. The page uses a narrower set and never runs remoteStart. */
export function planStackUp(svc: StackService, portOpen: boolean | null): UpStep {
  if (portOpen === true) return { id: svc.id, label: svc.label, kind: "already-up" };
  if (portOpen === null) {
    return { id: svc.id, label: svc.label, kind: "skip", reason: "no endpoint to check" };
  }
  if (svc.control === "remote" || svc.id === "knots-node" || svc.id === "knots-fulcrum") {
    if (svc.remoteStart.trim()) return { id: svc.id, label: svc.label, kind: "remote" };
    return { id: svc.id, label: svc.label, kind: "skip", reason: "no start command" };
  }
  if (LOCAL_START.has(svc.id) && startBlockReason(svc) === null) {
    return { id: svc.id, label: svc.label, kind: "local" };
  }
  return {
    id: svc.id,
    label: svc.label,
    kind: "skip",
    reason: startBlockReason(svc) ?? "no start action",
  };
}

function endpointHostPort(endpoint: string): { host: string; port: number } | null {
  try {
    if (endpoint.startsWith("tcp://") || endpoint.startsWith("ssl://") || endpoint.startsWith("tls://")) {
      const rest = endpoint.replace(/^(tcp|ssl|tls):\/\//, "");
      const [host, portStr] = rest.split(":");
      const port = Number(portStr);
      if (!host || !Number.isFinite(port)) return null;
      return { host, port };
    }
    const url = new URL(endpoint);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!url.hostname || !Number.isFinite(port)) return null;
    return { host: url.hostname, port };
  } catch {
    return null;
  }
}

export function tcpOpen(endpoint: string, ms = 1500): Promise<boolean | null> {
  const target = endpointHostPort(endpoint);
  if (!target) return Promise.resolve(null);
  return new Promise((resolve) => {
    const sock = net.connect({ host: target.host, port: target.port });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, ms);
    sock.on("connect", () => {
      clearTimeout(timer);
      sock.end();
      resolve(true);
    });
    sock.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Operator's own shell line from stack.json. stdout is discarded so the command is not echoed back. */
export function runShell(command: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", command], { windowsHide: true })
        : spawn("/bin/sh", ["-c", command], { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout?.resume();
    child.on("error", (err) => resolve({ code: 1, stderr: err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

export async function bringUpStack(
  config: StackConfig,
  deps: {
    portOpen?: (endpoint: string) => Promise<boolean | null>;
    startLocal?: (svc: StackService) => Promise<string>;
    startRemote?: (svc: StackService) => Promise<string>;
  } = {}
): Promise<{ lines: string[]; failed: boolean }> {
  const portOpen = deps.portOpen ?? tcpOpen;
  const startLocal = deps.startLocal ?? ((svc: StackService) => controlService(svc, "start"));
  const startRemote =
    deps.startRemote ??
    (async (svc: StackService) => {
      const result = await runShell(svc.remoteStart);
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `start command exited ${result.code}`);
      }
      return "start command finished";
    });

  const lines: string[] = [];
  let failed = false;
  for (const svc of config.services) {
    const open = svc.endpoint ? await portOpen(svc.endpoint) : null;
    const step = planStackUp(svc, open);
    try {
      if (step.kind === "already-up") {
        lines.push(`${svc.label} is already answering.`);
      } else if (step.kind === "skip") {
        lines.push(`${svc.label}: left alone (${step.reason}).`);
      } else if (step.kind === "local") {
        lines.push(`${svc.label}: ${await startLocal(svc)}`);
      } else {
        lines.push(`${svc.label}: ${await startRemote(svc)}`);
      }
    } catch (err) {
      failed = true;
      lines.push(`${svc.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { lines, failed };
}
