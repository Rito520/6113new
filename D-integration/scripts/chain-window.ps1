param([string]$Mode = '')
$Host.UI.RawUI.WindowTitle = 'SC6113 chain (8546) - keep OPEN'
$env:PATH = 'C:\Users\11585\AppData\Local\Qianwen\User Data\qwen-agent\resources\bins;' + $env:PATH
Set-Location 'D:\Documents\qwen-agent\ajBjhW5orS\default\SC6113\D-integration\contracts'
Write-Host 'Starting local chain on port 8546... keep this window OPEN during the demo.'
& node node_modules\hardhat\internal\cli\cli.js node --port 8546
Write-Host ''
Write-Host 'Chain stopped. If unexpected, screenshot this window and send it to the assistant.'
if ($Mode -ne 'auto') { Read-Host 'Press Enter to close' }
