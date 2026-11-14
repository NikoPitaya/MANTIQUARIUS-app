$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$hostDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cefRoot = Join-Path $env:LOCALAPPDATA "MANTIQUARIUS\cef-sdk"
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA "MANTIQUARIUS\cef-host-target"
$cefDir = Join-Path $cefRoot "windows_x86_64"
$archiveName = "cef_binary_156.0.26+g8ea0c73+chromium-156.0.8078.88_windows64_minimal.tar.bz2"
$archivePath = Join-Path $cefRoot $archiveName
$archiveUrl = "https://cef-builds.spotifycdn.com/$archiveName"
$expectedSha1 = "15d29eea209d857c22dc163706080295aea69b5c"
$archiveMetadata = @{
  type = "minimal"
  name = $archiveName
  sha1 = $expectedSha1
} | ConvertTo-Json

New-Item -ItemType Directory -Force -Path $cefRoot | Out-Null

if (-not (Test-Path (Join-Path $cefDir "archive.json"))) {
  if (-not (Test-Path $archivePath)) {
    Write-Host "Baixando CEF 156 para Windows (aprox. 175 MB)..."
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
  }

  $actualSha1 = (Get-FileHash -Path $archivePath -Algorithm SHA1).Hash.ToLowerInvariant()
  if ($actualSha1 -ne $expectedSha1) {
    throw "O arquivo CEF baixado não passou na verificação SHA-1."
  }

  & tar.exe -xjf $archivePath -C $cefRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível extrair o arquivo CEF com tar.exe."
  }

  $extractedDir = Join-Path $cefRoot ($archiveName -replace "\.tar\.bz2$", "")
  New-Item -ItemType Directory -Force -Path $cefDir | Out-Null
  Move-Item -Path (Join-Path $extractedDir "Release\*") -Destination $cefDir -Force
  Move-Item -Path (Join-Path $extractedDir "Resources\*") -Destination $cefDir -Force
  foreach ($name in @("CMakeLists.txt", "cmake", "include", "libcef_dll", "CREDITS.html")) {
    Move-Item -Path (Join-Path $extractedDir $name) -Destination $cefDir -Force
  }
  Remove-Item -LiteralPath $extractedDir -Recurse -Force
  Set-Content -Path (Join-Path $cefDir "archive.json") -Value $archiveMetadata -Encoding ASCII
}

$env:CEF_PATH = $cefDir
$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
  throw "Visual Studio Build Tools com C++ são necessários para compilar o CEF."
}
$vsPath = & $vswhere -latest -products "*" -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) {
  throw "O compilador C++ do Visual Studio não foi encontrado."
}
$vsDevCmd = Join-Path $vsPath "Common7\Tools\VsDevCmd.bat"
$cmakeDir = Join-Path $vsPath "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin"
if (Test-Path (Join-Path $cmakeDir "cmake.exe")) {
  $env:PATH = "$cmakeDir;$env:PATH"
}
$cargoCommands = "cargo build --release --lib && cargo run --release --bin bundle-cef-host"
$command = 'call "{0}" -arch=x64 -host_arch=x64 && set "CEF_PATH={1}" && cd /d "{2}" && {3}' -f $vsDevCmd, $cefDir, $hostDir, $cargoCommands
& $env:ComSpec /c $command
if ($LASTEXITCODE -ne 0) {
  throw "A compilação ou preparação do runtime CEF falhou."
}
