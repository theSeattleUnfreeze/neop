/**
 * Config lines and a pasteable Core restart for the garnish OP_RETURN.
 * No cookie, no RPC password, no wallet material.
 */

import path from "node:path";

/** Garnish scripts are 84–120 bytes. Core 28's default limit is 83. */
export const DATACARRIER_RAISE = "datacarriersize=120";
/** Core 28's own default. Put this back only after the Core transactions are in a block. */
export const DATACARRIER_REVERT = "datacarriersize=83";

export type DatacarrierAssist = {
  raise: string;
  revert: string;
  configFile: string | null;
  restart: string | null;
  shell: string;
};

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cliPath(binary: string, platform: NodeJS.Platform): string {
  const lib = platform === "win32" ? path.win32 : path.posix;
  const name = platform === "win32" ? "bitcoin-cli.exe" : "bitcoin-cli";
  return lib.join(lib.dirname(binary), name);
}

/**
 * One paste that stops Core and starts it again, so bitcoin.conf is read.
 * Returns null until both the bitcoind path and the data directory are known.
 */
export function coreRestartCommand(input: {
  platform: NodeJS.Platform;
  binary: string;
  datadir: string;
}): string | null {
  const binary = input.binary.trim();
  const datadir = input.datadir.trim();
  if (!binary || !datadir) return null;
  const cli = cliPath(binary, input.platform);
  if (input.platform === "win32") {
    // Start-Process joins -ArgumentList on spaces and does not quote the pieces,
    // so a datadir with whitespace would be split after stop already succeeded.
    // ProcessStartInfo.Arguments is one command line, with the path in quotes.
    return [
      `& ${psQuote(cli)} -datadir=${psQuote(datadir)} stop`,
      "Start-Sleep -Seconds 8",
      "$pinfo = New-Object System.Diagnostics.ProcessStartInfo",
      `$pinfo.FileName = ${psQuote(binary)}`,
      "$pinfo.UseShellExecute = $false",
      `$dd = ${psQuote(datadir)}`,
      "$pinfo.Arguments = \"-datadir=`\"$dd`\"\"",
      "[void][System.Diagnostics.Process]::Start($pinfo)",
    ].join("; ");
  }
  return `${shQuote(cli)} -datadir=${shQuote(datadir)} stop; sleep 8; ${shQuote(binary)} -datadir=${shQuote(datadir)}`;
}

export function datacarrierAssist(input: {
  platform: NodeJS.Platform;
  binary: string;
  datadir: string;
  configFile: string;
}): DatacarrierAssist {
  return {
    raise: DATACARRIER_RAISE,
    revert: DATACARRIER_REVERT,
    configFile: input.configFile.trim() || null,
    restart: coreRestartCommand(input),
    shell: input.platform === "win32" ? "PowerShell" : input.platform === "darwin" ? "Terminal" : "a shell",
  };
}
