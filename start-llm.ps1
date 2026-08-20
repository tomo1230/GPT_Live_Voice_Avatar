$ErrorActionPreference = "Stop"

$lms = "C:\Users\devsu\.lmstudio\bin\lms.exe"
if (-not (Test-Path -LiteralPath $lms)) {
    throw "LM Studio CLIが見つかりません: $lms"
}

& $lms server start --port 1234
if ($LASTEXITCODE -ne 0) {
    throw "LM Studioサーバーを起動できませんでした。"
}

$models = & $lms ps
if ($models -notmatch "local-model") {
    & $lms load "ornith-1.0-9b-mtp" `
        --gpu max `
        --context-length 4096 `
        --parallel 1 `
        --identifier "local-model" `
        --speculative-draft-mtp `
        -y
    if ($LASTEXITCODE -ne 0) {
        throw "Ornith 1.0 9Bをロードできませんでした。"
    }
}

Write-Host "Local LLM: http://127.0.0.1:1234/v1" -ForegroundColor Green
