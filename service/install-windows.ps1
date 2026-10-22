#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$OwnerSid)
$ErrorActionPreference='Stop'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator required'}
if($OwnerSid -notmatch '^S-1-5-21-(?:\d+-){3}\d+$'){throw 'Unexpected controller identity'}
if($Source.StartsWith('\\') -or $Source -match '[\r\n"]'){throw 'Local application path required'}
$Source=[IO.Path]::GetFullPath($Source)
if(!(Test-Path -LiteralPath (Join-Path $Source 'USTB Connect.exe'))){throw 'Application executable missing'}
if(Get-ChildItem -LiteralPath $Source -Recurse -Force|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}|Select-Object -First 1){throw 'Application source contains a reparse point'}
$old=Get-ScheduledTask -TaskName 'BKQL-Reconnect-Boot' -ErrorAction SilentlyContinue
if($old -and [string]$old.State -in @('Running','Queued')){throw '旧版 BKQL 脚本仍在运行。请先用原停止入口停用；本安装器没有修改旧版。'}
$root=Join-Path $env:ProgramData 'BKQL Connect'
$application=Join-Path $env:ProgramFiles 'BKQL Connect Service'
$taskName='BKQL-Connect-Service'
if((Test-Path $root) -and ((Get-Item $root).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'System data path is a link'}
if((Test-Path $application) -and ((Get-Item $application).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Service app path is a link'}
$existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($existing){
    if(@($existing.Actions).Count -ne 1 -or $existing.Actions[0].Arguments -notlike ('*'+$root+'\service.cmd*') -or $existing.Principal.UserId -notin @('S-1-5-18','SYSTEM','NT AUTHORITY\SYSTEM')){throw '同名任务不属于本应用'}
    Stop-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 1
}
if($Source.TrimEnd('\') -ine $application.TrimEnd('\')){
    $null=New-Item -ItemType Directory -Path $application -Force
    & robocopy.exe $Source $application /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS
    if($LASTEXITCODE -ge 8){throw '复制系统后台失败'}
}
$admins=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$owner=New-Object Security.Principal.SecurityIdentifier($OwnerSid)
$users=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
$appAcl=New-Object Security.AccessControl.DirectorySecurity
$appAcl.SetOwner($admins);$appAcl.SetAccessRuleProtection($true,$false)
foreach($sid in @($admins,$system)){$appAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
$appAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($users,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')))
Set-Acl -LiteralPath $application -AclObject $appAcl
Get-ChildItem -LiteralPath $application -Recurse -Force|ForEach-Object {
    if($_.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Service app contains a reparse point'}
    $childAcl=if($_.PSIsContainer){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}
    $childAcl.SetOwner($admins);$childAcl.SetAccessRuleProtection($false,$false)
    Set-Acl -LiteralPath $_.FullName -AclObject $childAcl
}
$null=New-Item -ItemType Directory -Path $root -Force
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($admins);$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @($admins,$system)){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))}
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'ReadAndExecute','None','None','Allow')))
Set-Acl -LiteralPath $root -AclObject $acl
$token=Join-Path $root 'controller.token'
if(!(Test-Path -LiteralPath $token)){
    $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose()
    [IO.File]::WriteAllText($token,([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant())
}
$tokenAcl=New-Object Security.AccessControl.FileSecurity
$tokenAcl.SetOwner($admins);$tokenAcl.SetAccessRuleProtection($true,$false)
foreach($sid in @($admins,$system)){$tokenAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))}
$tokenAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($owner,'Read','Allow')))
Set-Acl -LiteralPath $token -AclObject $tokenAcl
$exe=Join-Path $application 'USTB Connect.exe'
$entry=Join-Path $application 'resources\app\src\headless.cjs'
if(!(Test-Path $entry)){throw '后台入口缺失'}
$cmd='@echo off'+"`r`n"+'set ELECTRON_RUN_AS_NODE=1'+"`r`n"+'"'+$exe+'" "'+$entry+'"'+"`r`n"
[IO.File]::WriteAllText((Join-Path $root 'service.cmd'),$cmd,[Text.Encoding]::ASCII)
$action=New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\cmd.exe') -Argument ('/d /c ""'+(Join-Path $root 'service.cmd')+'""') -WorkingDirectory $root
$trigger=New-ScheduledTaskTrigger -AtStartup;$trigger.Delay='PT30S'
$identity=New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest
$options=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $identity -Settings $options -Description 'BKQL 界面版系统后台；仅本机控制；不开公网端口；自动监测须另行启用。' -Force|Out-Null
Start-ScheduledTask -TaskName $taskName
$stopSource=Join-Path $application 'resources\app\service\STOP-AUTO-RECONNECT.cmd'
$publicDesktop=[Environment]::GetFolderPath('CommonDesktopDirectory')
if($publicDesktop -and (Test-Path $stopSource)){Copy-Item -LiteralPath $stopSource -Destination (Join-Path $publicDesktop '停止北科自动联网.cmd') -Force}
Write-Host 'BKQL 系统后台安装完成。现在返回界面，连接后台并导入账号，再选择是否开始监测。'
Write-Host '未主动登录校园网，未修改 Wi-Fi、DNS、路由或防火墙。'
