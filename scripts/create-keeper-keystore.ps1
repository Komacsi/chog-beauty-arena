param([string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'secrets\keeper-export'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use this wizard in Windows PowerShell.' }
$nodeCommand = Get-Command node -ErrorAction Stop
$exportDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$exportFile = Join-Path $exportDirectory 'keeper.keystore.json'
if (Test-Path -LiteralPath $exportDirectory) {
    if ((Get-Item -LiteralPath $exportDirectory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Export directory must not be a link.' }
    if (@(Get-ChildItem -LiteralPath $exportDirectory -Force).Count -gt 0) { throw 'Choose a new empty -OutputDirectory; existing exports are never overwritten.' }
} else {
    New-Item -ItemType Directory -Path $exportDirectory | Out-Null
}
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$privateAcl = New-Object Security.AccessControl.DirectorySecurity
$privateAcl.SetOwner($currentSid)
$privateAcl.SetAccessRuleProtection($true, $false)
$privateRule = New-Object Security.AccessControl.FileSystemAccessRule($currentSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$privateAcl.AddAccessRule($privateRule)
Set-Acl -LiteralPath $exportDirectory -AclObject $privateAcl

function Read-PlainSecureValue([Security.SecureString]$SecureValue) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
Write-Host 'Offline keeper keystore export. No network requests or transactions.'
Write-Host 'Expected keeper: 0x8e9Ec0de3f9113B5d41e5721B6C0A61d2feE9908'
Write-Host 'Enter secrets only in this local window, never in chat or a shell command.'
$passwordInput = $null; $confirmInput = $null; $keyInput = $null
$passwordText = $null; $confirmText = $null; $keyText = $null; $payload = $null
try {
    $passwordInput = Read-Host 'Create a NEW keystore password (at least 16 characters)' -AsSecureString
    $confirmInput = Read-Host 'Repeat the NEW keystore password' -AsSecureString
    $passwordText = Read-PlainSecureValue $passwordInput
    $confirmText = Read-PlainSecureValue $confirmInput
    if ($passwordText.Length -lt 16 -or $passwordText.Length -gt 1024 -or $passwordText -cne $confirmText) { throw 'Passwords must match and contain 16-1024 characters.' }
    $keyInput = Read-Host 'Paste ONLY the private key of the keeper account from Rabby' -AsSecureString
    $keyText = Read-PlainSecureValue $keyInput
    $payload = @{privateKey=$keyText; password=$passwordText} | ConvertTo-Json -Compress
    # ASCII transport over a local pipe also works in Windows PowerShell 5.1;
    # Unicode passwords are reconstructed as UTF-8 before encryption.
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeCommand.Source
    $startInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'create-keeper-keystore.mjs') + '" "' + $exportFile + '"'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $exportProcess = New-Object Diagnostics.Process
    $exportProcess.StartInfo = $startInfo
    $exportProcess.Start() | Out-Null
    $exportProcess.StandardInput.Write($payload)
    $exportProcess.StandardInput.Close()
    $outputTask = $exportProcess.StandardOutput.ReadToEndAsync()
    $errorTask = $exportProcess.StandardError.ReadToEndAsync()
    $exportProcess.WaitForExit()
    if ($exportProcess.ExitCode -ne 0) { throw 'Export failed. Check that the key belongs to the keeper, the password meets requirements and the output file is new.' }
    $result = $outputTask.Result | ConvertFrom-Json
    Write-Host ('Encrypted keystore saved: ' + $result.outputFile)
    Write-Host ('Verified public address: ' + $result.address)
    Write-Host 'The password was NOT saved. Keep it separately; do not send it in chat.'
} finally {
    foreach ($secretInput in @($passwordInput,$confirmInput,$keyInput)) { if ($null -ne $secretInput) { $secretInput.Dispose() } }
    $passwordText = $null; $confirmText = $null; $keyText = $null; $payload = $null
}
