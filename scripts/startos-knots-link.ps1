<#
.SYNOPSIS
  Keep a Windows host's loopback link to a StartOS Knots node alive.

.DESCRIPTION
  Holds an SSH -L tunnel (127.0.0.1:LocalPort -> STARTOS_HOST 127.0.0.1:RemotePort) and probes
  JSON-RPC getblockcount through it every ProbeSeconds. The node queues probes behind a syncing
  Fulcrum's block downloads, so the timeout is generous. After FailThreshold failed probes in a row
  it repairs the far end:

    * proxy not listening (StartOS rebooted and wiped /tmp)  -> upload and start the proxy
    * proxy listening but stale (script hash differs)       -> replace and restart it
    * proxy listening and current but RPC still fails        -> restart proxy, then tunnel

  The proxy (scripts/startos-rpc-auth-proxy.py) injects the node cookie on StartOS, so no RPC
  secret is stored on this machine. Starting it needs passwordless sudo for the SSH user.

  Only state changes are logged. Stop with Ctrl+C or by killing the process; the tunnel child
  goes with it.

.EXAMPLE
  powershell -NoProfile -File scripts\startos-knots-link.ps1 -StartosHost STARTOS_HOST `
    -Identity $env:USERPROFILE\.ssh\id_startos -Log D:\neop\knots-link.log
#>
param(
    [Parameter(Mandatory)] [string] $StartosHost,
    [string] $User = "start9",
    [Parameter(Mandatory)] [string] $Identity,
    [int] $LocalPort = 15081,
    [int] $RemotePort = 15081,
    [string] $ProxyScript = (Join-Path $PSScriptRoot "startos-rpc-auth-proxy.py"),
    [string] $RemoteProxyPath = "/tmp/rpc-auth-proxy.py",
    [int] $ProbeSeconds = 30,
    [int] $FailThreshold = 4,
    [int] $ProbeTimeoutSeconds = 60,
    [int] $RemoteTimeoutSeconds = 120,
    [string] $Log = (Join-Path $env:TEMP "startos-knots-link.log")
)
$ErrorActionPreference = "Continue"
$target = "$User@$StartosHost"
$sshOpts = @("-i", $Identity, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=15")
$localHash = (Get-FileHash $ProxyScript -Algorithm SHA256).Hash.ToLower()

function Note([string] $m) {
    $line = "{0} {1}" -f (Get-Date -Format o), $m
    Add-Content -Path $Log -Value $line
    Write-Output $line
}

function Start-Tunnel {
    $sshArgs = $sshOpts + @("-o", "ServerAliveInterval=20", "-o", "ServerAliveCountMax=3",
        "-o", "ExitOnForwardFailure=yes", "-N", "-L", "127.0.0.1:${LocalPort}:127.0.0.1:${RemotePort}", $target)
    $p = Start-Process ssh -ArgumentList $sshArgs -WindowStyle Hidden -PassThru
    Note "tunnel started pid=$($p.Id)"
    return $p
}

function Test-Rpc {
    $body = '{"jsonrpc":"1.0","id":"link","method":"getblockcount","params":[]}'
    # Any credentials work; the proxy replaces them with the node cookie.
    $auth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("neop:neop"))
    try {
        # Fresh connection per probe: the node drops idle keep-alive connections (rpcservertimeout)
        # before the next probe, and a pooled dead socket reads as a failure.
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort" -Method Post -Body $body -DisableKeepAlive `
            -ContentType "application/json" -Headers @{ Authorization = $auth } -TimeoutSec $ProbeTimeoutSeconds
        return [int] $r.result
    } catch {
        $resp = $_.Exception.Response
        # 503 = node RPC work queue full: the whole path is up, the node is just busy.
        if ($resp -and [int] $resp.StatusCode -eq 503) { return 0 }
        $script:lastProbeError = if ($resp) { "HTTP $([int] $resp.StatusCode)" } else { $_.Exception.Message }
        return -1
    }
}

function Invoke-Bounded([string] $exe, [string[]] $argv) {
    # A wedged StartOS can accept the SSH login yet never run the command; ConnectTimeout and
    # ServerAlive do not catch that, so enforce a wall-clock limit or the watchdog stalls with it.
    $psi = New-Object System.Diagnostics.ProcessStartInfo $exe
    $psi.Arguments = ($argv | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.StandardInput.Close()
    $so = $p.StandardOutput.ReadToEndAsync()
    $se = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($RemoteTimeoutSeconds * 1000)) {
        try { $p.Kill() } catch { }
        return @{ Code = -1; Out = "$exe timed out after ${RemoteTimeoutSeconds}s" }
    }
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Out = ($so.Result + $se.Result).Trim() }
}

function Remote([string] $cmd) {
    # -n: without a console, ssh otherwise waits on stdin and never returns.
    return Invoke-Bounded "ssh" (@("-n") + $sshOpts + @($target, $cmd))
}

function Repair-Proxy {
    $st = Remote "ss -ltn | grep -q '127.0.0.1:$RemotePort ' && echo listening || echo down; sha256sum $RemoteProxyPath 2>/dev/null | cut -c1-64"
    if ($st.Code -ne 0) { Note "repair: ssh to $StartosHost failed ($($st.Out))"; return }
    $lines = $st.Out -split "`r?`n"
    $listening = $lines[0] -eq "listening"
    $remoteHash = if ($lines.Count -gt 1) { $lines[1].Trim() } else { "" }
    $why = if (-not $listening) { "proxy not listening" }
           elseif ($remoteHash -ne $localHash) { "proxy script is stale" }
           else { "proxy listening but RPC failing" }
    Note "repair: $why; redeploying proxy"
    $up = Invoke-Bounded "scp" ($sshOpts + @($ProxyScript, "${target}:$RemoteProxyPath"))
    if ($up.Code -ne 0) { Note "repair: upload failed ($($up.Out))"; return }
    # Anchored so pkill matches only the proxy, not the remote shell running this command line.
    $start = Remote ("sudo pkill -f '^python3 $RemoteProxyPath' ; sleep 1; " +
        "sudo sh -c 'nohup python3 $RemoteProxyPath >/tmp/rpc-auth-proxy.log 2>&1 &'; sleep 2; " +
        "ss -ltn | grep -q '127.0.0.1:$RemotePort ' && echo proxy_up || (echo proxy_down; tail -5 /tmp/rpc-auth-proxy.log)")
    Note "repair: $($start.Out -replace '\s+', ' ')"
}

Note "link watchdog starting: 127.0.0.1:$LocalPort -> ${StartosHost}:$RemotePort (proxy sha256 $($localHash.Substring(0,12)))"
# A stale proxy can still answer single probes (the pipelining bug only bites real clients),
# so compare the deployed script up front instead of waiting for probe failures.
$deployed = Remote "sha256sum $RemoteProxyPath 2>/dev/null | cut -c1-64"
if ($deployed.Code -eq 0 -and $deployed.Out -ne $localHash) { Repair-Proxy }
$tunnel = $null
$fails = 0
$healthy = $null
while ($true) {
    if ($null -eq $tunnel -or $tunnel.HasExited) {
        if ($null -ne $tunnel) { Note "tunnel exited code=$($tunnel.ExitCode)" }
        $tunnel = Start-Tunnel
        Start-Sleep -Seconds 5
    }
    $height = Test-Rpc
    if ($height -ge 0) {
        if ($healthy -ne $true) { Note $(if ($height -eq 0) { "rpc ok (node busy, 503)" } else { "rpc ok height=$height" }) }
        $healthy = $true
        $fails = 0
    } else {
        $fails++
        if ($healthy -ne $false) { Note "rpc failing: $script:lastProbeError" }
        $healthy = $false
        if ($fails -ge $FailThreshold) {
            Repair-Proxy
            if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
            $tunnel = $null
            $fails = 0
            Start-Sleep -Seconds 30
            continue
        }
    }
    Start-Sleep -Seconds $ProbeSeconds
}
