import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { revealablePaths } from "@/lib/stack/config";
import type { StackConfig, StackService, StackServiceId } from "@/lib/stack/types";

/** True for Docker -p specs that bind on this host (loopback, all-interfaces, or bare ports). */
export function isLocalDockerPublish(publish: string): boolean {
  const p = publish.trim();
  if (!p) return false;
  // Bare "50111:50111" publishes on all host interfaces.
  if (/^\d+:\d+$/.test(p)) return true;
  // ip:hostPort:containerPort — only loopback or all-interfaces.
  if (p.startsWith("127.0.0.1:") || p.startsWith("0.0.0.0:")) {
    return /^\d+\.\d+\.\d+\.\d+:\d+:\d+$/.test(p);
  }
  return false;
}

export function startBlockReason(svc: StackService): string | null {
  if (svc.control === "remote" || svc.id === "knots-node" || svc.id === "knots-fulcrum") {
    return `${svc.label} is observed from here. Start it on the machine that owns it.`;
  }
  if (svc.id === "core-node") {
    if (!svc.binary || !svc.datadir) return "Set the bitcoind binary and datadir first.";
    return null;
  }
  if (svc.id === "core-fulcrum") {
    if (!svc.containerName || !svc.image || !svc.datadir || !svc.configFile || !svc.publish) {
      return "Set the container name, image, datadir, config file, and published port first.";
    }
    // Allow loopback (127.0.0.1) or all-interfaces (0.0.0.0 / bare host:container) for LAN Sparrow.
    // Docker -p only binds addresses on this machine; reject anything that is not a local publish spec.
    if (!isLocalDockerPublish(svc.publish)) {
      return "Docker publish must be a local bind such as 127.0.0.1:50111:50111 or 0.0.0.0:50111:50111.";
    }
    return null;
  }
  if (svc.id === "knots-link") {
    if (!svc.script || !svc.startosHost || !svc.identityFile) {
      return "Set the tunnel script, StartOS host, and SSH identity first.";
    }
    return null;
  }
  return "No start action for this service.";
}

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

function cliBeside(binary: string): string {
  const dir = path.dirname(binary);
  const exe = path.join(dir, process.platform === "win32" ? "bitcoin-cli.exe" : "bitcoin-cli");
  return exe;
}

function pidFile(svc: StackService): string {
  const base = svc.logFile || svc.script;
  return `${base}.pid`;
}

export async function revealInExplorer(config: StackConfig, target: string): Promise<void> {
  const resolved = path.resolve(target);
  if (!revealablePaths(config).includes(resolved)) {
    throw new Error("That path is not one of the files configured for this stack.");
  }
  if (process.platform === "win32") {
    const child = spawn("explorer.exe", [`/select,${resolved}`], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }
  if (process.platform === "darwin") {
    const child = spawn("open", ["-R", resolved], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }
  const child = spawn("xdg-open", [path.dirname(resolved)], { detached: true, stdio: "ignore" });
  child.unref();
}

async function startCoreNode(svc: StackService): Promise<string> {
  if (!fs.existsSync(svc.binary)) throw new Error(`bitcoind not found at ${svc.binary}`);
  const child = spawn(svc.binary, [`-datadir=${svc.datadir}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return `Started Core node (pid ${child.pid ?? "unknown"}).`;
}

async function stopCoreNode(svc: StackService): Promise<string> {
  const cli = cliBeside(svc.binary);
  if (!fs.existsSync(cli)) throw new Error(`bitcoin-cli not found next to ${svc.binary}`);
  const result = await run(cli, [`-datadir=${svc.datadir}`, "stop"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "bitcoin-cli stop failed");
  return "Core node is stopping.";
}

async function startFulcrum(svc: StackService): Promise<string> {
  const inspect = await run("docker", ["inspect", "-f", "{{.State.Status}}", svc.containerName]);
  if (inspect.code === 0) {
    const status = inspect.stdout.trim();
    if (status === "running") return `${svc.containerName} is already running.`;
    const started = await run("docker", ["start", svc.containerName]);
    if (started.code !== 0) throw new Error(started.stderr.trim() || "docker start failed");
    return `Started ${svc.containerName}.`;
  }
  const cookieArgs = svc.cookieFile ? ["-v", `${svc.cookieFile}:/run/secrets/cookie:ro`] : [];
  const started = await run("docker", [
    "run",
    "-d",
    "--name",
    svc.containerName,
    "--entrypoint",
    "/usr/bin/Fulcrum",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    svc.publish,
    "-v",
    `${svc.datadir}:/data`,
    "-v",
    `${svc.configFile}:/forward.conf:ro`,
    ...cookieArgs,
    svc.image,
    "/forward.conf",
  ]);
  if (started.code !== 0) throw new Error(started.stderr.trim() || "docker run failed");
  return `Started ${svc.containerName}.`;
}

async function stopFulcrum(svc: StackService): Promise<string> {
  const stopped = await run("docker", ["stop", svc.containerName]);
  if (stopped.code !== 0) throw new Error(stopped.stderr.trim() || "docker stop failed");
  return `Stopped ${svc.containerName}.`;
}

async function startLink(svc: StackService): Promise<string> {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      svc.script,
      "-StartosHost",
      svc.startosHost,
      "-Identity",
      svc.identityFile,
      ...(svc.logFile ? ["-Log", svc.logFile] : []),
    ],
    { detached: true, stdio: "ignore", windowsHide: true }
  );
  child.unref();
  if (child.pid && svc.logFile) fs.writeFileSync(pidFile(svc), String(child.pid));
  return `Started the Knots tunnel (pid ${child.pid ?? "unknown"}).`;
}

async function stopLink(svc: StackService): Promise<string> {
  const file = pidFile(svc);
  if (!fs.existsSync(file)) throw new Error("No tunnel pid file. Stop the PowerShell process from the terminal that started it.");
  const pid = Number(fs.readFileSync(file, "utf8").trim());
  if (!Number.isFinite(pid)) throw new Error("Tunnel pid file is unreadable.");
  if (process.platform === "win32") {
    const killed = await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    if (killed.code !== 0) throw new Error(killed.stderr.trim() || "taskkill failed");
  } else {
    process.kill(pid);
  }
  fs.rmSync(file, { force: true });
  return "Stopped the Knots tunnel.";
}

export async function controlService(svc: StackService, action: "start" | "stop"): Promise<string> {
  const blocked = startBlockReason(svc);
  if (action === "start" && blocked) throw new Error(blocked);
  if (action === "stop" && (svc.control === "remote" || svc.id === "knots-node" || svc.id === "knots-fulcrum")) {
    throw new Error(blocked ?? "Remote services are not stopped from Scoop.");
  }
  if (svc.id === "core-node") return action === "start" ? startCoreNode(svc) : stopCoreNode(svc);
  if (svc.id === "core-fulcrum") return action === "start" ? startFulcrum(svc) : stopFulcrum(svc);
  if (svc.id === "knots-link") return action === "start" ? startLink(svc) : stopLink(svc);
  throw new Error("No control action for this service.");
}

export function isServiceId(value: string): value is StackServiceId {
  return (
    value === "core-node" ||
    value === "core-fulcrum" ||
    value === "knots-node" ||
    value === "knots-fulcrum" ||
    value === "knots-link"
  );
}
