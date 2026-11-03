for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $status = Invoke-RestMethod 'http://localhost:3210/api/health' -TimeoutSec 1
        if ($status.status -eq 'ok') { Start-Process 'http://localhost:3210'; exit }
    } catch { }
    Start-Sleep -Milliseconds 250
}
