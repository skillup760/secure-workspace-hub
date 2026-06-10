# Register Secure Workspace Hub as a Windows Service using NSSM.
# Run in an elevated PowerShell prompt.
#
#   .\install-service.ps1 -InstallDir C:\swh -DataDir D:\swh-data
param(
  [string]$InstallDir = "C:\swh",
  [string]$DataDir    = "C:\swh\data",
  [string]$NodeExe    = "$Env:ProgramFiles\nodejs\node.exe",
  [string]$ServiceName = "SecureWorkspaceHub"
)

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
  Write-Error "NSSM not found. Install from https://nssm.cc/ and add to PATH."
  exit 1
}

nssm install   $ServiceName $NodeExe "$InstallDir\index.js"
nssm set       $ServiceName AppDirectory $InstallDir
nssm set       $ServiceName AppEnvironmentExtra "DATA_DIR=$DataDir"
nssm set       $ServiceName AppStdout "$DataDir\logs\swh.out.log"
nssm set       $ServiceName AppStderr "$DataDir\logs\swh.err.log"
nssm set       $ServiceName Start SERVICE_AUTO_START

New-Item -ItemType Directory -Force -Path "$DataDir\logs" | Out-Null

Write-Host "Installed service '$ServiceName'. Start with: nssm start $ServiceName"
