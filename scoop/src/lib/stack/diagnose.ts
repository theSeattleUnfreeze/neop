import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { startBlockReason } from "@/lib/stack/control";
import type { StackService, StackServiceId } from "@/lib/stack/types";

export type StackStep = {
  title: string;
  body: string;
  /** Path Scoop can open in Explorer when allowed. */
  revealPath?: string;
  /** Suggested value to write into the stack config. */
  suggest?: { key: keyof StackService; value: string };
};

export type StackDiagnosis = {
  id: StackServiceId;
  label: string;
  platform: string;
  severity: "ok" | "busy" | "action" | "remote";
  headline: string;
  processRunning: boolean;
  portOpen: boolean | null;
  canStart: boolean;
  steps: StackStep[];
};

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function platformName(): string {
  if (process.platform === "win32") return "Windows";
  if (process.platform === "darwin") return "macOS";
  return "Linux";
}

async function tcpOpen(host: string, port: number, ms = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
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

async function processNamed(names: string[]): Promise<boolean> {
  if (process.platform === "win32") {
    for (const name of names) {
      const result = await run("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/NH"]);
      if (result.stdout.toLowerCase().includes(name.toLowerCase())) return true;
    }
    return false;
  }
  for (const name of names) {
    const result = await run("pgrep", ["-x", name.replace(/\.exe$/i, "")]);
    if (result.code === 0 && result.stdout.trim()) return true;
  }
  return false;
}

async function dockerEngineUp(): Promise<boolean> {
  const result = await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return result.code === 0 && Boolean(result.stdout.trim());
}

async function dockerContainerStatus(name: string): Promise<string | null> {
  if (!name) return null;
  const result = await run("docker", ["inspect", "-f", "{{.State.Status}}", name]);
  if (result.code !== 0) return null;
  return result.stdout.trim() || null;
}

const BITCOIND_CANDIDATES =
  process.platform === "win32"
    ? [
        "D:\\neop\\bin\\bitcoin-28.3\\bin\\bitcoind.exe",
        "C:\\Program Files\\Bitcoin\\daemon\\bitcoind.exe",
        path.join(process.env.LOCALAPPDATA ?? "", "Bitcoin", "bitcoind.exe"),
      ]
    : process.platform === "darwin"
      ? ["/usr/local/bin/bitcoind", "/opt/homebrew/bin/bitcoind"]
      : ["/usr/bin/bitcoind", "/usr/local/bin/bitcoind"];

function existingCandidates(list: string[]): string[] {
  return list.filter((candidate) => candidate && fs.existsSync(candidate));
}

async function diagnoseCoreNode(svc: StackService): Promise<StackDiagnosis> {
  const steps: StackStep[] = [];
  const binaryOk = Boolean(svc.binary && fs.existsSync(svc.binary));
  const datadirOk = Boolean(svc.datadir && fs.existsSync(svc.datadir));
  const cookieOk = Boolean(svc.cookieFile && fs.existsSync(svc.cookieFile));
  const processRunning = await processNamed(["bitcoind.exe", "bitcoind"]);
  const target = endpointHostPort(svc.endpoint);
  const portOpen = target ? await tcpOpen(target.host, target.port) : null;
  const found = existingCandidates(BITCOIND_CANDIDATES);
  const canStart = startBlockReason(svc) === null && binaryOk && datadirOk;

  if (!binaryOk) {
    steps.push({
      title: "Point Scoop at bitcoind",
      body:
        process.platform === "win32"
          ? "Scoop starts Core with the binary path in Details. Put Bitcoin Core 28.x on this PC (neop usually keeps it under D:\\neop\\bin\\bitcoin-28.3\\bin), then Save paths."
          : "Install Bitcoin Core or pre-RDTS Knots for the Core chain, then set the bitcoind path in Details and Save paths.",
      revealPath: found[0] || svc.binary || undefined,
      suggest: found[0] ? { key: "binary", value: found[0] } : undefined,
    });
    if (found[0]) {
      steps.push({
        title: "Use the bitcoind Scoop found",
        body: `Found ${found[0]}. Apply it, save, then Start.`,
        suggest: { key: "binary", value: found[0] },
        revealPath: found[0],
      });
    }
  }
  if (!datadirOk) {
    steps.push({
      title: "Set the Core data directory",
      body:
        process.platform === "win32"
          ? "This machine's mainnet datadir is often E:\\Bitcoin. It must contain bitcoin.conf and .cookie once the node has started."
          : "Set datadir to the folder that holds bitcoin.conf and the chainstate.",
      revealPath: svc.datadir || undefined,
    });
  }
  if (binaryOk && datadirOk && !processRunning && portOpen === false) {
    steps.push({
      title: "Start Core from Scoop",
      body: "The binary and datadir are set. Use Start Core below. Scoop runs bitcoind with that datadir on this PC only.",
    });
  }
  if (processRunning || portOpen) {
    steps.push({
      title: "Core is already on this PC",
      body: cookieOk
        ? "bitcoind is running (or its RPC port is open), but the health check timed out. That usually means initial block download. Leave it alone; Fulcrum will catch up when RPC answers again."
        : "bitcoind looks running, but the cookie file is missing. Open bitcoin.conf, confirm server=1, restart Core once, then check the cookie path in Details.",
      revealPath: svc.cookieFile || svc.configFile || undefined,
    });
  }
  if (!processRunning && portOpen === false && binaryOk && datadirOk) {
    // already covered by Start step
  }

  let severity: StackDiagnosis["severity"] = "action";
  let headline = "Core node needs setup or a start.";
  if (processRunning || portOpen) {
    severity = "busy";
    headline = "Core is running; RPC is too busy to answer the health check.";
  } else if (!binaryOk || !datadirOk) {
    headline = "Core is not configured for Start yet.";
  } else {
    headline = "Core is not running. Scoop can start it on this PC.";
  }

  return {
    id: svc.id,
    label: svc.label,
    platform: platformName(),
    severity,
    headline,
    processRunning,
    portOpen,
    canStart: canStart && !processRunning && portOpen !== true,
    steps,
  };
}

async function diagnoseCoreFulcrum(svc: StackService, coreBusy: boolean): Promise<StackDiagnosis> {
  const steps: StackStep[] = [];
  const dockerUp = await dockerEngineUp();
  const container = await dockerContainerStatus(svc.containerName);
  const target = endpointHostPort(svc.endpoint);
  const portOpen = target ? await tcpOpen(target.host, target.port) : null;
  const blocked = startBlockReason(svc);
  const configOk = !blocked;

  if (!dockerUp) {
    steps.push({
      title: process.platform === "win32" ? "Start Docker Desktop" : "Start the Docker engine",
      body:
        process.platform === "win32"
          ? "Core Fulcrum runs as a container. Open Docker Desktop and wait until the engine is running, then come back and Start Core Fulcrum."
          : "Install Docker and make sure `docker info` works, then Start Core Fulcrum from Scoop.",
    });
  }
  if (dockerUp && !configOk) {
    steps.push({
      title: "Fill the Fulcrum fields in Details",
      body: "Scoop needs the container name, image, index datadir, fulcrum.conf, and Docker publish spec (ip:host port:container port, for example 127.0.0.1:50111:50111).",
      revealPath: svc.configFile || svc.datadir || undefined,
    });
  }
  if (dockerUp && configOk && container !== "running") {
    steps.push({
      title: container ? "Start the Fulcrum container" : "Create and start the Fulcrum container",
      body: container
        ? `Container ${svc.containerName} exists but is ${container}. Scoop can docker start it.`
        : `Scoop will docker run ${svc.image} as ${svc.containerName} with your mounts.`,
    });
  }
  if (coreBusy) {
    steps.push({
      title: "Wait for Core RPC",
      body: "Fulcrum talks to bitcoind. While Core is in IBD or RPC is timing out, the Electrum port may hang even if the container is up. Fix Core first, then recheck.",
    });
  }
  if (container === "running" && portOpen && !coreBusy) {
    steps.push({
      title: "Container is up",
      body: "Docker says the container is running and the Electrum port is open. If Scoop still marks it down, the indexer may still be catching the tip.",
    });
  }

  let severity: StackDiagnosis["severity"] = "action";
  let headline = "Core Fulcrum needs Docker or a start.";
  if (!dockerUp) headline = "Docker is not answering on this PC.";
  else if (coreBusy && container === "running") {
    severity = "busy";
    headline = "Core Fulcrum is up in Docker, waiting on a busy Core node.";
  } else if (container === "running") {
    severity = "busy";
    headline = "Core Fulcrum container is running; the Electrum probe timed out.";
  } else if (configOk) {
    headline = "Core Fulcrum is not running. Scoop can start it.";
  }

  return {
    id: svc.id,
    label: svc.label,
    platform: platformName(),
    severity,
    headline,
    processRunning: container === "running",
    portOpen,
    canStart: dockerUp && configOk && container !== "running",
    steps,
  };
}

async function diagnoseKnotsNode(svc: StackService): Promise<StackDiagnosis> {
  const target = endpointHostPort(svc.endpoint);
  const portOpen = target ? await tcpOpen(target.host, target.port) : null;
  const steps: StackStep[] = [
    {
      title: "Enter LAN RPC credentials",
      body: "Knots on StartOS is observed from here. Scoop does not start or stop it. Put the RPC user and password in Details, Save paths, then recheck. The LAN RPC URL is usually the StartOS host on port 57747.",
    },
  ];
  if (portOpen) {
    steps.unshift({
      title: "LAN RPC is reachable",
      body: "The port answers. Without credentials Scoop can only say the node is up, not the tip height.",
    });
  }
  const needsCreds = portOpen && !svc.rpcUser;
  return {
    id: svc.id,
    label: svc.label,
    platform: platformName(),
    severity: needsCreds ? "action" : portOpen ? "ok" : "remote",
    headline: portOpen
      ? needsCreds
        ? "Knots RPC is on the LAN; add credentials for a height."
        : "Knots RPC is on the LAN."
      : "Knots RPC is not reachable from this PC.",
    processRunning: Boolean(portOpen),
    portOpen,
    canStart: false,
    steps,
  };
}

async function diagnoseKnotsFulcrum(svc: StackService): Promise<StackDiagnosis> {
  const target = endpointHostPort(svc.endpoint);
  const portOpen = target ? await tcpOpen(target.host, target.port) : null;
  return {
    id: svc.id,
    label: svc.label,
    platform: platformName(),
    severity: portOpen ? "ok" : "remote",
    headline: portOpen
      ? "Knots Fulcrum is answering on the LAN."
      : "Knots Fulcrum is not reachable. Check StartOS and the Electrum URL in Details.",
    processRunning: Boolean(portOpen),
    portOpen,
    canStart: false,
    steps: [
      {
        title: "Observed only",
        body: "Shrike and Scoop use this Electrum URL. Start the indexer on StartOS, not from this Scoop page.",
      },
    ],
  };
}

async function diagnoseLink(svc: StackService): Promise<StackDiagnosis> {
  const target = endpointHostPort(svc.endpoint);
  const portOpen = target ? await tcpOpen(target.host, target.port) : null;
  const blocked = startBlockReason(svc);
  const steps: StackStep[] = [];
  if (blocked) {
    steps.push({
      title: "Fill the tunnel fields",
      body: "Optional. Only needed if Docker Fulcrum must reach StartOS Knots RPC through a local cookie proxy. Set the script, StartOS host, and SSH identity in Details.",
      revealPath: svc.script || svc.identityFile || undefined,
    });
  } else {
    steps.push({
      title: "Start the optional tunnel",
      body: "Scoop runs the PowerShell tunnel script on this PC. Leave it stopped if wallets only use Electrum.",
      revealPath: svc.script || undefined,
    });
  }
  return {
    id: svc.id,
    label: svc.label,
    platform: platformName(),
    severity: portOpen ? "ok" : "action",
    headline: portOpen ? "Knots RPC tunnel is up." : "Optional Knots RPC tunnel is down.",
    processRunning: Boolean(portOpen),
    portOpen,
    canStart: !blocked && !portOpen,
    steps,
  };
}

export async function diagnoseStack(services: StackService[]): Promise<StackDiagnosis[]> {
  const byId = new Map(services.map((svc) => [svc.id, svc]));
  const core = byId.get("core-node");
  const coreDiag = core ? await diagnoseCoreNode(core) : null;
  const coreBusy = coreDiag?.severity === "busy";
  const out: StackDiagnosis[] = [];
  for (const svc of services) {
    if (svc.id === "core-node" && coreDiag) out.push(coreDiag);
    else if (svc.id === "core-fulcrum") out.push(await diagnoseCoreFulcrum(svc, Boolean(coreBusy)));
    else if (svc.id === "knots-node") out.push(await diagnoseKnotsNode(svc));
    else if (svc.id === "knots-fulcrum") out.push(await diagnoseKnotsFulcrum(svc));
    else if (svc.id === "knots-link") out.push(await diagnoseLink(svc));
  }
  return out;
}
