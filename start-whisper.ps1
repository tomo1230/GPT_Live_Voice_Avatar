$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
# ffmpeg is required by whisper-server for audio conversion.
# Set NEON_FFMPEG_DIR to the folder containing ffmpeg.exe, or leave it unset
# to use an ffmpeg.exe that is already on PATH.
$ffmpegDirectory = $env:NEON_FFMPEG_DIR

$localServerPath = Join-Path $workspaceRoot "tools\whisper\Release\whisper-server.exe"
$localModelPath = Join-Path $workspaceRoot "models\whisper\ggml-base.bin"

if (-not (Test-Path -LiteralPath $localServerPath)) {
    throw "whisper-server.exe が見つかりません: $localServerPath"
}

if (-not (Test-Path -LiteralPath $localModelPath)) {
    throw "Whisperモデルが見つかりません: $localModelPath"
}

if ($ffmpegDirectory) {
    if (-not (Test-Path -LiteralPath (Join-Path $ffmpegDirectory "ffmpeg.exe"))) {
        throw "ffmpeg.exe が見つかりません: $ffmpegDirectory"
    }
    $env:PATH = "$ffmpegDirectory;$env:PATH"
}
elseif (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    throw "ffmpeg.exe が見つかりません。PATHへ追加するか、環境変数 NEON_FFMPEG_DIR へffmpeg.exeのあるフォルダーを指定してください。"
}

# whisper.cpp on Windows cannot reliably open models through a path containing
# Japanese characters. Mount the workspace temporarily under an ASCII drive.
$driveLetter = @("V", "W", "X", "Y") |
    Where-Object { -not (Test-Path "$($_):\") } |
    Select-Object -First 1

if (-not $driveLetter) {
    throw "Whisper用の空きドライブ文字（V～Y）がありません。"
}

$driveRoot = "$driveLetter`:"
& subst.exe $driveRoot $workspaceRoot
if ($LASTEXITCODE -ne 0) {
    throw "Whisper用の仮想ドライブを作成できませんでした。"
}

try {
    $serverPath = "$driveRoot\tools\whisper\Release\whisper-server.exe"
    $modelPath = "$driveRoot\models\whisper\ggml-base.bin"
    $tempPath = "$driveRoot\.runtime\whisper-temp"
    New-Item -ItemType Directory -Path $tempPath -Force | Out-Null

    Write-Host "Whisper STT: http://127.0.0.1:8178/inference" -ForegroundColor Cyan
    Write-Host "Model: $modelPath" -ForegroundColor DarkGray

    & $serverPath `
        --model $modelPath `
        --host 127.0.0.1 `
        --port 8178 `
        --language ja `
        --convert `
        --tmp-dir $tempPath `
        --threads 8 `
        --no-gpu
}
finally {
    & subst.exe $driveRoot /D | Out-Null
}
