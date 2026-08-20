$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Audio Reactive Avatar: http://127.0.0.1:4782" -ForegroundColor Green
Write-Host "STT・LLM・TTSは使用しません。" -ForegroundColor DarkGray
Write-Host "終了するときはこのウィンドウで Ctrl+C を押してください。" -ForegroundColor DarkGray

& node (Join-Path $workspaceRoot "server.mjs")
