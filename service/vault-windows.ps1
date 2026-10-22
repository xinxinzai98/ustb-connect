#requires -Version 5.1
param([ValidateSet('Protect','Unprotect')][string]$Mode)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
$inputData=[Console]::In.ReadToEnd()
if($inputData.Length -gt 131072){throw 'Credential payload too large'}
$plain=$null
try {
    if($Mode -eq 'Protect') {
        $plain=[Text.Encoding]::UTF8.GetBytes($inputData)
        $encrypted=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
        [Console]::Out.Write([Convert]::ToBase64String($encrypted))
    } else {
        $plain=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputData.Trim()),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
        [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
    }
} finally {
    if($null -ne $plain){[Array]::Clear($plain,0,$plain.Length)}
    $inputData=$null
}
