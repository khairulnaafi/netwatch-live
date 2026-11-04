# NetWatch - penjaga hotspot
#
# Windows mematikan Mobile Hotspot sendiri kalau dianggap idle atau saat
# koneksi internet berubah. Skrip ini mengecek tiap 30 detik dan menyalakannya
# lagi bila mati, supaya perangkat tamu tetap terhubung dan DNS-nya tercatat.
#
# Jalankan:  powershell -ExecutionPolicy Bypass -File tools\hotspot-watch.ps1

param([int]$IntervalSec = 30)

$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]

function Write-Log([string]$Message) {
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message"
}

Write-Log "Watchdog hotspot aktif (cek tiap $IntervalSec detik). Tekan Ctrl+C untuk berhenti."

while ($true) {
  try {
    $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    if (-not $profile) {
      Write-Log "Tidak ada koneksi internet - hotspot dilewati."
    } else {
      $manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
      if ($manager.TetheringOperationalState -ne 'On') {
        Write-Log "Hotspot mati - menyalakan ulang..."
        $manager.StartTetheringAsync() | Out-Null
        Start-Sleep -Seconds 8
        $state = $manager.TetheringOperationalState
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -like '192.168.137.*' } |
          Select-Object -First 1).IPAddress
        Write-Log "Status: $state | IP hotspot: $(if ($ip) { $ip } else { '-' })"
      }
    }
  } catch {
    Write-Log "Gagal: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds $IntervalSec
}
