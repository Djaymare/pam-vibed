param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedThumbprint,
    [Parameter(Mandatory = $true)][string]$SignToolPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    $file = Get-Item -LiteralPath $FilePath
    $tool = Get-Item -LiteralPath $SignToolPath
    if ($file.PSIsContainer -or $tool.PSIsContainer -or
        ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ($tool.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Fichiers ordinaires requis.'
    }
    $before = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($before -ne $ExpectedSha256.ToLowerInvariant()) { throw 'SHA-256 different du fichier attendu.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid') { throw "Signature invalide : $($signature.Status)." }
    if ($signature.SignatureType -ne 'Authenticode') { throw 'Signature embarquee Authenticode requise.' }
    if ($signature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint) { throw 'Signataire inattendu.' }
    if ($null -eq $signature.TimeStamperCertificate) { throw 'Horodatage requis.' }
    # /pa selects Authenticode, /all verifies every signature, /tw warns on missing timestamps.
    # SignTool warnings (exit 2) fail this check as well as errors (exit 1).
    $toolOutput = & $tool.FullName verify /pa /all /tw $file.FullName 2>&1
    $toolExit = $LASTEXITCODE
    if ($toolExit -ne 0) { throw "Verification SignTool echouee ($toolExit) : $toolOutput" }
    $after = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($after -ne $before) { throw 'Le fichier a change pendant la verification.' }
    [PSCustomObject]@{
        path = $file.FullName
        sha256 = $after
        thumbprint = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()
        status = 'Valid'
        timestamped = $true
        signtoolExitCode = $toolExit
        checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
