<#
  NetWatch Live - Agent Wi-Fi (Windows)

  Dijalankan di laptop/PC teman. Agent ini memindai Wi-Fi di sekitar
  perangkat tersebut lalu mengirim hasilnya ke dashboard NetWatch Anda.

  Pemakaian:
    powershell -ExecutionPolicy Bypass -File agent.ps1 -Server https://xxx.trycloudflare.com -Key KUNCI -Name "Laptop Budi"
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Name = $env:COMPUTERNAME,
  [int]$Interval = 20,
  [switch]$Once
)

$ErrorActionPreference = 'Stop'

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
  # PowerShell 7 ke atas sudah memakai TLS modern secara default.
}

$Server = $Server.Trim()
if ($Server -notmatch '^https?://') { $Server = "https://$Server" }
$Server = $Server.TrimEnd('/')

$script:AgentId = ($Name.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
if (-not $script:AgentId) { $script:AgentId = 'agent' }

function Get-Band([int]$Channel) {
  if ($Channel -le 0) { return $null }
  if ($Channel -le 14) { return '2.4 GHz' }
  if ($Channel -le 196) { return '5 GHz' }
  return '6 GHz'
}

function Get-WifiScan {
  $text = (netsh wlan show networks mode=bssid) -join "`n"
  $list = New-Object System.Collections.ArrayList
  $cur = $null

  foreach ($line in ($text -split "`r?`n")) {
    if ($line -match '^\s*SSID\s+\d+\s*:\s*(.*)$') {
      $ssid = $matches[1].Trim()
      if (-not $ssid) { $ssid = '<tersembunyi>' }
      $cur = [ordered]@{
        ssid     = $ssid
        bssid    = $null
        signal   = $null
        channel  = $null
        band     = $null
        radio    = $null
        security = $null
      }
      [void]$list.Add($cur)
      continue
    }
    if ($null -eq $cur) { continue }
    if ($line -match '^\s*BSSID\s+\d+\s*:\s*([0-9a-fA-F:]{17})') { $cur.bssid = $matches[1].ToLower(); continue }
    if ($line -match '^\s*(?:Signal|Sinyal)\s*:\s*(\d+)\s*%') { $cur.signal = [int]$matches[1]; continue }
    if ($line -match '^\s*(?:Channel|Saluran)\s*:\s*(\d+)') {
      $cur.channel = [int]$matches[1]
      $cur.band = Get-Band $cur.channel
      continue
    }
    if ($line -match '^\s*(?:Radio type|Jenis radio)\s*:\s*(.+)$') { $cur.radio = $matches[1].Trim(); continue }
    if ($line -match '^\s*(?:Authentication|Otentikasi)\s*:\s*(.+)$') { $cur.security = $matches[1].Trim(); continue }
  }

  return $list
}

function Get-WifiCurrent($Scan) {
  $text = (netsh wlan show interfaces) -join "`n"
  if ($text -notmatch '(?im)^\s*(?:State|Status)\s*:\s*(connected|tersambung)') { return $null }

  $ssid = $null; $bssid = $null; $signal = $null; $radio = $null; $channel = $null

  if ($text -match '(?im)^\s*SSID\s*:\s*(.+)$') { $ssid = $matches[1].Trim() }
  if ($text -match '(?im)^\s*BSSID\s*:\s*([0-9a-fA-F:]{17})') { $bssid = $matches[1].ToLower() }
  if ($text -match '(?im)^\s*(?:Signal|Sinyal)\s*:\s*(\d+)\s*%') { $signal = [int]$matches[1] }
  if ($text -match '(?im)^\s*(?:Radio type|Jenis radio)\s*:\s*(.+)$') { $radio = $matches[1].Trim() }

  $match = $null
  if ($bssid) { $match = $Scan | Where-Object { $_.bssid -eq $bssid } | Select-Object -First 1 }
  if (-not $match -and $ssid) { $match = $Scan | Where-Object { $_.ssid -eq $ssid } | Select-Object -First 1 }
  if ($match) {
    $channel = $match.channel
    if (-not $radio) { $radio = $match.radio }
  }

  return [ordered]@{
    ssid     = $ssid
    bssid    = $bssid
    signal   = $signal
    channel  = $channel
    band     = Get-Band ([int]$channel)
    radio    = $radio
    security = if ($match) { $match.security } else { $null }
  }
}

function Get-Clients {
  $text = (arp -a) -join "`n"
  $seen = @{}
  $rows = New-Object System.Collections.ArrayList

  foreach ($line in ($text -split "`r?`n")) {
    if ($line -match '^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F-]{17})\s+(\w+)') {
      $ip = $matches[1]
      $mac = $matches[2].ToLower().Replace('-', ':')
      if ($mac -eq 'ff:ff:ff:ff:ff:ff') { continue }
      if ($mac -eq '00:00:00:00:00:00') { continue }
      if ($seen.ContainsKey($mac)) { continue }
      $seen[$mac] = $true
      [void]$rows.Add([ordered]@{
        ip     = $ip
        mac    = $mac
        name   = $ip
        status = 'online'
      })
      if ($rows.Count -ge 80) { break }
    }
  }

  return $rows
}

function Get-Prefix([string]$Mask) {
  if (-not $Mask) { return $null }
  $bits = 0
  foreach ($part in $Mask.Split('.')) {
    $value = [int]$part
    while ($value -gt 0) {
      if ($value -band 128) { $bits++ }
      $value = ($value -shl 1) -band 255
    }
  }
  return $bits
}

function Get-NetworkInfo {
  $text = (ipconfig) -join "`n"
  $ip = $null; $gw = $null; $mask = $null

  if ($text -match '(?im)^\s*(?:IPv4 Address|Alamat IPv4)[^:]*:\s*([\d.]+)') { $ip = $matches[1] }
  if ($text -match '(?im)^\s*(?:Default Gateway|Gerbang Default)[^:]*:\s*([\d.]+)') { $gw = $matches[1] }
  if ($text -match '(?im)^\s*Subnet Mask[^:]*:\s*([\d.]+)') { $mask = $matches[1] }

  $subnet = $null
  $prefix = Get-Prefix $mask
  if ($ip -and $prefix -ne $null) {
    $octets = $ip.Split('.')
    $subnet = "$($octets[0]).$($octets[1]).$($octets[2]).0/$prefix"
  }

  return [ordered]@{ localIp = $ip; gateway = $gw; subnet = $subnet }
}

function Send-Report {
  $scan = Get-WifiScan
  $current = Get-WifiCurrent $scan
  $clients = Get-Clients
  $network = Get-NetworkInfo

  $payload = [ordered]@{
    id       = $script:AgentId
    location = $Name
    source   = 'windows-agent'
    wifi     = [ordered]@{
      current = $current
      nearby  = @($scan | Select-Object -First 100)
    }
    clients  = @($clients)
    network  = $network
  }

  $json = $payload | ConvertTo-Json -Depth 6 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $headers = @{ 'x-agent-key' = $Key }

  $result = Invoke-RestMethod -Uri "$Server/api/agent/ingest" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 30

  $stamp = Get-Date -Format 'HH:mm:ss'
  $count = @($scan).Count
  $ssid = if ($current) { $current.ssid } else { '(tidak terhubung)' }
  Write-Host "[$stamp] terkirim: $count jaringan, aktif: $ssid, klien: $(@($clients).Count)" -ForegroundColor Green
}

Write-Host ''
Write-Host '  NetWatch Agent (Windows)' -ForegroundColor Cyan
Write-Host "  Server : $Server"
Write-Host "  Lokasi : $Name"
Write-Host "  ID     : $($script:AgentId)"
Write-Host ''

if ($Once) {
  Send-Report
  exit 0
}

Write-Host '  Tekan Ctrl+C untuk berhenti.' -ForegroundColor DarkGray
Write-Host ''

while ($true) {
  try {
    Send-Report
  } catch {
    $stamp = Get-Date -Format 'HH:mm:ss'
    Write-Host "[$stamp] gagal mengirim: $($_.Exception.Message)" -ForegroundColor Red
  }
  Start-Sleep -Seconds ([Math]::Max(5, $Interval))
}
