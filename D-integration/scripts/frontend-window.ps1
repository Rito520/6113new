param([string]$Mode = '')
$Host.UI.RawUI.WindowTitle = 'SC6113 frontend (5173) - keep OPEN'
$env:PATH = 'C:\Users\11585\AppData\Local\Qianwen\User Data\qwen-agent\resources\bins;' + $env:PATH
Set-Location 'D:\Documents\qwen-agent\ajBjhW5orS\default\SC6113\D-integration\frontend'
Write-Host 'Starting frontend on port 5173... keep this window OPEN during the demo.'
& node node_modules\vite\bin\vite.js
Write-Host ''
Write-Host 'Frontend stopped. If unexpected, screenshot this window and send it to the assistant.'
if ($Mode -ne 'auto') { Read-Host 'Press Enter to close' }
