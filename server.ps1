# Standalone PowerShell Web Server: server.ps1
# Serves static PWA files AND handles the /api/sync endpoint natively on Windows.

param(
    [int]$Port = 3000
)

$DataDir = Join-Path $PSScriptRoot "data"
$DbFile = Join-Path $DataDir "store.json"

if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

function Load-Store {
    if (Test-Path $DbFile) {
        try {
            $content = Get-Content -Path $DbFile -Raw -Encoding UTF8
            return ConvertFrom-Json $content
        } catch {}
    }
    return [PSCustomObject]@{
        pairs = @{}
        reminders = @{}
        responses = @{}
    }
}

function Save-Store($store) {
    try {
        $json = ConvertTo-Json $store -Depth 10
        Set-Content -Path $DbFile -Value $json -Encoding UTF8
    } catch {}
}

function Generate-PairCode {
    $chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $code = ""
    for ($i = 0; $i -lt 6; $i++) {
        $code += $chars[(Get-Random -Maximum $chars.Length)]
    }
    return $code
}

$MimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " Duo PWA Local Server running at http://localhost:$Port" -ForegroundColor Green
Write-Host " Static files + /api/sync endpoint active" -ForegroundColor Green
Write-Host " Press Ctrl+C in this terminal to stop the server" -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Cyan

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

        $rawUrl = $request.RawUrl
        $path = $request.Url.AbsolutePath

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        # Handle /api/sync
        if ($path -eq "/api/sync") {
            $response.ContentType = "application/json"
            $store = Load-Store

            if ($request.HttpMethod -eq "GET") {
                $pairId = $request.QueryString["pairId"]
                if ([string]::IsNullOrWhiteSpace($pairId)) {
                    $response.StatusCode = 400
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Missing pairId"}')
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }

                $pairId = $pairId.ToUpper()
                $pair = $store.pairs.$pairId
                if ($null -eq $pair) {
                    $response.StatusCode = 404
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Pair not found"}')
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }

                $remList = if ($store.reminders.$pairId) { $store.reminders.$pairId } else { @() }
                $respList = if ($store.responses.$pairId) { $store.responses.$pairId } else { @() }

                $outObj = @{
                    success = $true
                    pair = $pair
                    reminders = $remList
                    responses = $respList
                    serverTime = (Get-Date).ToString("o")
                }
                $json = ConvertTo-Json $outObj -Depth 10
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.StatusCode = 200
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }

            if ($request.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                $bodyText = $reader.ReadToEnd()
                $body = ConvertFrom-Json $bodyText

                if ($body.action -eq "create_pair") {
                    $pairId = Generate-PairCode
                    $user1Id = "u_" + (Get-Random -Minimum 100000 -Maximum 999999)
                    $user2Id = "u_" + (Get-Random -Minimum 100000 -Maximum 999999)

                    $newPair = @{
                        id = $pairId
                        user1 = @{ id = $user1Id; name = $(if ($body.userName) { $body.userName } else { 'Viswa' }) }
                        user2 = @{ id = $user2Id; name = $(if ($body.partnerName) { $body.partnerName } else { 'Friend' }) }
                        createdAt = (Get-Date).ToString("o")
                    }

                    $initialReminders = @(
                        @{
                            id = "rem_" + (Get-Random -Minimum 100000 -Maximum 999999)
                            pairId = $pairId
                            title = "Walking"
                            icon = "🚶"
                            time = "06:00"
                            repeat = "daily"
                            active = $true
                            createdAt = (Get-Date).ToString("o")
                        }
                    )

                    $store.pairs | Add-Member -NotePropertyName $pairId -NotePropertyValue $newPair -Force
                    $store.reminders | Add-Member -NotePropertyName $pairId -NotePropertyValue $initialReminders -Force
                    $store.responses | Add-Member -NotePropertyName $pairId -NotePropertyValue @() -Force
                    Save-Store $store

                    $outObj = @{
                        success = $true
                        pair = $newPair
                        currentUser = $newPair.user1
                        reminders = $initialReminders
                        responses = @()
                    }
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $outObj -Depth 10))
                    $response.StatusCode = 200
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }

                if ($body.action -eq "join_pair") {
                    $pairId = ($body.pairCode + "").Trim().ToUpper()
                    $pair = $store.pairs.$pairId

                    if ($null -eq $pair) {
                        $response.StatusCode = 404
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Pair code not found"}')
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                        $response.Close()
                        continue
                    }

                    if ($body.userName) {
                        $pair.user2.name = $body.userName
                        Save-Store $store
                    }

                    $outObj = @{
                        success = $true
                        pair = $pair
                        currentUser = $pair.user2
                        reminders = $(if ($store.reminders.$pairId) { $store.reminders.$pairId } else { @() })
                        responses = $(if ($store.responses.$pairId) { $store.responses.$pairId } else { @() })
                    }
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $outObj -Depth 10))
                    $response.StatusCode = 200
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }

                $pairId = ($body.pairId + "").ToUpper()
                if ($null -eq $store.pairs.$pairId) {
                    $response.StatusCode = 404
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Pair not found"}')
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }

                if ($body.action -eq "save_reminder") {
                    $remList = [System.Collections.ArrayList]@($(if ($store.reminders.$pairId) { $store.reminders.$pairId } else { @() }))
                    $found = $false
                    for ($i = 0; $i -lt $remList.Count; $i++) {
                        if ($remList[$i].id -eq $body.reminder.id) {
                            $remList[$i] = $body.reminder
                            $found = $true
                            break
                        }
                    }
                    if (-not $found) {
                        $remList.Add($body.reminder) | Out-Null
                    }
                    $store.reminders.$pairId = $remList
                    Save-Store $store

                    $outObj = @{ success = $true; reminders = $remList }
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $outObj -Depth 10))
                    $response.StatusCode = 200
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }

                if ($body.action -eq "submit_response") {
                    $respList = [System.Collections.ArrayList]@($(if ($store.responses.$pairId) { $store.responses.$pairId } else { @() }))
                    $newResp = @{
                        id = "resp_" + (Get-Random -Minimum 100000 -Maximum 999999)
                        reminderId = $body.reminderId
                        date = $body.date
                        userId = $body.userId
                        status = $body.status
                        respondedAt = $(if ($body.respondedAt) { $body.respondedAt } else { (Get-Date).ToString("o") })
                        snoozeUntil = $body.snoozeUntil
                    }
                    $found = $false
                    for ($i = 0; $i -lt $respList.Count; $i++) {
                        if ($respList[$i].reminderId -eq $body.reminderId -and $respList[$i].date -eq $body.date -and $respList[$i].userId -eq $body.userId) {
                            $respList[$i] = $newResp
                            $found = $true
                            break
                        }
                    }
                    if (-not $found) {
                        $respList.Add($newResp) | Out-Null
                    }
                    $store.responses.$pairId = $respList
                    Save-Store $store

                    $outObj = @{ success = $true; response = $newResp; responses = $respList }
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $outObj -Depth 10))
                    $response.StatusCode = 200
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
            }
        }

        # Static File Serving
        $localPath = $path.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($localPath)) { $localPath = "index.html" }
        $fullPath = Join-Path $PSScriptRoot $localPath

        if (Test-Path $fullPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
            $mime = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { "application/octet-stream" }
            $response.ContentType = $mime

            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            $response.StatusCode = 200
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
        } else {
            $response.StatusCode = 404
            $response.Close()
        }
    }
} finally {
    $listener.Stop()
}
