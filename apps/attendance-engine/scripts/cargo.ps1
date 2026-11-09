# PowerShell equivalent of scripts/cargo.sh — see that file for the full rationale.
# Usage (from apps/attendance-engine):  .\scripts\cargo.ps1 test
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path" # this process only
}

$hostTriple = (rustc -vV | Select-String '^host: ').ToString().Substring(6).Trim()
if ($hostTriple -eq 'x86_64-pc-windows-gnu') {
    $sysroot = (rustc --print sysroot).Trim()
    $llvmAr = Join-Path $sysroot "lib\rustlib\$hostTriple\bin\llvm-ar.exe"
    if (-not (Test-Path $llvmAr)) { rustup component add llvm-tools }
    New-Item -ItemType Directory -Force 'target\tools' | Out-Null
    $dlltool = Join-Path (Get-Location) 'target\tools\llvm-dlltool.exe'
    Copy-Item $llvmAr $dlltool -Force
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS = "-C dlltool=$dlltool"
}

& cargo @args
exit $LASTEXITCODE
