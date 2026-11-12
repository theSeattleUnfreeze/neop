import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATACARRIER_RAISE, DATACARRIER_REVERT, coreRestartCommand, datacarrierAssist } from "./datacarrier.ts";

describe("datacarrier assist", () => {
  it("uses 120 for the garnish and 83 to put the limit back", () => {
    const assist = datacarrierAssist({ platform: "win32", binary: "", datadir: "", configFile: "" });
    assert.equal(assist.raise, DATACARRIER_RAISE);
    assert.equal(assist.raise, "datacarriersize=120");
    assert.equal(assist.revert, DATACARRIER_REVERT);
    assert.equal(assist.revert, "datacarriersize=83");
    assert.equal(assist.restart, null);
    assert.equal(assist.configFile, null);
  });

  it("builds a PowerShell restart that quotes paths and does not include a cookie", () => {
    const command = coreRestartCommand({
      platform: "win32",
      binary: "C:\\Program Files\\Bitcoin\\bitcoind.exe",
      datadir: "E:\\Bitcoin data",
    });
    assert.ok(command);
    assert.match(command, /bitcoin-cli\.exe/);
    assert.match(command, /Start-Sleep -Seconds 8/);
    assert.match(command, /ProcessStartInfo/);
    assert.match(command, /-datadir=/);
    assert.doesNotMatch(command, /Start-Process/);
    assert.match(command, /'C:\\Program Files\\Bitcoin\\bitcoind.exe'/);
    assert.match(command, /'E:\\Bitcoin data'/);
    assert.doesNotMatch(command, /cookie|rpcpassword|rpcuser/i);
  });

  it("builds a POSIX restart and keeps a quote inside the path", () => {
    const command = coreRestartCommand({
      platform: "linux",
      binary: "/opt/bitcoin/bitcoind",
      datadir: "/home/op/it's-data",
    });
    assert.ok(command);
    assert.match(command, /bitcoin-cli/);
    assert.match(command, /sleep 8/);
    assert.match(command, /it'\\''s-data/);
    assert.doesNotMatch(command, /cookie|rpcpassword/i);
  });

  it("does not invent a restart when the binary or datadir is missing", () => {
    assert.equal(coreRestartCommand({ platform: "win32", binary: "C:\\Bitcoin\\bitcoind.exe", datadir: "" }), null);
    assert.equal(coreRestartCommand({ platform: "darwin", binary: "", datadir: "/Users/op/Library/Application Support/Bitcoin" }), null);
  });

  it("names the shell the command is for", () => {
    assert.equal(datacarrierAssist({ platform: "win32", binary: "", datadir: "", configFile: "C:\\Bitcoin\\bitcoin.conf" }).shell, "PowerShell");
    assert.equal(datacarrierAssist({ platform: "darwin", binary: "", datadir: "", configFile: "" }).shell, "Terminal");
    assert.equal(datacarrierAssist({ platform: "linux", binary: "", datadir: "", configFile: "" }).shell, "a shell");
  });
});
