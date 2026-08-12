param(
    [int]$Duration = 10
)

# Dravex desktop BLE scanner (Windows).
# Uses the native WinRT BluetoothLEAdvertisementWatcher through PowerShell —
# no drivers, no native node modules. Watches BLE advertisements for our
# service UUID (0000fffa-...) and emits JSON of heard beacon IDs + RSSI.
# The service data payload is: version byte (0x01) + 12 ASCII hex chars.

$ErrorActionPreference = "Stop"

# Load the WinRT interop assembly so the Windows.* types are callable.
Add-Type -AssemblyName System.Runtime.WindowsRuntime

try {
    [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher,
     Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementReceivedEventArgs,
     Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Bluetooth.BluetoothLEDevice,
     Windows.Devices.Bluetooth, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.DataReader,
     Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
} catch {
    Write-Output "[]"
    exit 0
}

$target = [guid]"0000fffa-0000-1000-8000-00805f9b34fb"
$found = [System.Collections.Generic.List[object]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new()

$watcher = New-Object Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher
$watcher.ScanningMode = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEScanningMode]::Active

$sub = Register-ObjectEvent -InputObject $watcher -EventName Received -Action {
    $advArgs = $event.SourceEventArgs
    $uuidMatch = $false
    foreach ($u in $advArgs.Advertisement.ServiceUuids) {
        if ($u -eq $target) { $uuidMatch = $true; break }
    }
    if (-not $uuidMatch) { return }

    $data = $advArgs.Advertisement.GetServiceDataForUuid($target)
    if ($null -eq $data -or $data.Length -lt 13) { return }

    $reader = [Windows.Storage.Streams.DataReader]::FromBuffer($data)
    $bytes = New-Object byte[] $data.Length
    $reader.ReadBytes($bytes)
    $reader.DetachStream()

    # Payload: [0x01] + 12 ASCII hex chars (beacon id).
    if ($bytes[0] -ne 0x01) { return }
    $beacon = [System.Text.Encoding]::ASCII.GetString($bytes, 1, 12)
    if ($beacon -notmatch "^[0-9a-f]{12}$") { return }
    if ($seen.Contains($beacon)) { return }
    $seen.Add($beacon) | Out-Null

    $found.Add([pscustomobject]@{
        beacon = $beacon
        rssi   = $advArgs.RawSignalStrengthInDBm
    }) | Out-Null
}
$watcher.Start()
Start-Sleep -Seconds $Duration
$watcher.Stop()
$sub | Unregister-Event -ErrorAction SilentlyContinue

# De-dupe again (the HashSet is only seeded per-run) and emit JSON.
$result = @()
$outSeen = [System.Collections.Generic.HashSet[string]]::new()
foreach ($b in $found) {
    if ($outSeen.Add($b.beacon)) {
        $result += @{ beacon = $b.beacon; rssi = $b.rssi }
    }
}
$result | ConvertTo-Json -Compress
