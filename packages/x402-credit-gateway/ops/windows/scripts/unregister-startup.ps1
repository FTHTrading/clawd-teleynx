$taskNameBoot = "JEFE-Bootstrap"
$taskNameWatchdog = "JEFE-Watchdog"

Unregister-ScheduledTask -TaskName $taskNameBoot -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskNameWatchdog -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "Scheduled startup tasks removed."
