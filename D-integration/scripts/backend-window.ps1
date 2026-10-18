param([string]$Mode = '')
$Host.UI.RawUI.WindowTitle = 'SC6113 backend (3001) - keep OPEN'
$env:PATH = 'C:\Users\11585\AppData\Local\Qianwen\User Data\qwen-agent\resources\bins;' + $env:PATH
Set-Location 'D:\Documents\qwen-agent\ajBjhW5orS\default\SC6113\D-integration\backend'
Write-Host 'Starting backend API on port 3001... keep this window OPEN during the demo.'
& node dist\src\server.js
Write-Host ''
Write-Host 'Backend stopped. If unexpected, screenshot this window and send it to the assistant.'
if ($Mode -ne 'auto') { Read-Host 'Press Enter to close' }
