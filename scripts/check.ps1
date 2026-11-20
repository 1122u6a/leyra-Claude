$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $nodeMajor = & node.exe -p "process.versions.node.split('.')[0]"
    if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 24) {
        throw 'Leyra tests require Node.js 24 or later.'
    }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) {
        throw "Leyra tests failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
