param(
    [string]$EnvFile = ".env.local",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$apiRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $apiRoot $EnvFile
if (-not (Test-Path $envPath)) {
    Write-Host "Missing $envPath" -ForegroundColor Red
    exit 1
}

$envMap = @{}
Get-Content $envPath | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) { return }
    $name = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $envMap[$name] = $value
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($existing) {
    $existing | ForEach-Object {
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

$envMap.GetEnumerator() | ForEach-Object {
    Set-Item -Path "Env:$($_.Key)" -Value $_.Value
}

$proc = Start-Process -FilePath python -ArgumentList "-m uvicorn main:app --host 127.0.0.1 --port $Port" -WorkingDirectory $apiRoot -PassThru
Start-Sleep -Seconds 3

$health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/health"
$ready = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/v1/billing/readiness"

Write-Host "pid=$($proc.Id) health=$($health.status) checkoutReady=$($ready.ready_for_checkout) webhookReady=$($ready.ready_for_webhook)" -ForegroundColor Green
