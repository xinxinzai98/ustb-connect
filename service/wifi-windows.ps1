#requires -Version 5.1
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$v=[Console]::In.ReadToEnd()|ConvertFrom-Json
if(!$v.ssid -or [Text.Encoding]::UTF8.GetByteCount([string]$v.ssid) -gt 32 -or $v.security -notin @('wpa2','wpa3','open')){throw 'Invalid wireless input'}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class USTBWifi {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct ConnectParams {
  public int mode; [MarshalAs(UnmanagedType.LPWStr)] public string profile;
  public IntPtr ssid; public IntPtr bssid; public int bssType; public uint flags;
 }
 [DllImport("wlanapi.dll")] public static extern uint WlanOpenHandle(uint version,IntPtr reserved,out uint negotiated,out IntPtr handle);
 [DllImport("wlanapi.dll",CharSet=CharSet.Unicode)] public static extern uint WlanSetProfile(IntPtr handle,ref Guid guid,uint flags,string xml,string security,bool overwrite,IntPtr reserved,out uint reason);
 [DllImport("wlanapi.dll")] public static extern uint WlanConnect(IntPtr handle,ref Guid guid,ref ConnectParams parameters,IntPtr reserved);
 [DllImport("wlanapi.dll")] public static extern uint WlanDisconnect(IntPtr handle,ref Guid guid,IntPtr reserved);
 [DllImport("wlanapi.dll")] public static extern uint WlanCloseHandle(IntPtr handle,IntPtr reserved);
}
'@
$adapter=Get-NetAdapter|Where-Object {$_.Name -eq [string]$v.interface}|Select-Object -First 1
if(!$adapter){[Console]::Out.Write('{"ok":false,"code":"notFound"}');exit 0}
$guid=[Guid]$adapter.InterfaceGuid
$hash=[Security.Cryptography.SHA256]::Create();$digest=$hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$v.ssid+[string]$v.security));$hash.Dispose()
$name='USTB-'+([BitConverter]::ToString($digest).Replace('-','').Substring(0,16))
$ssidHex=([BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes([string]$v.ssid))).Replace('-','')
$auth=if($v.security -eq 'wpa3'){'WPA3SAE'}elseif($v.security -eq 'open'){'open'}else{'WPA2PSK'}
$encryption=if($v.security -eq 'open'){'none'}else{'AES'}
$shared=''
if($v.security -ne 'open'){
 $key=[Security.SecurityElement]::Escape([string]$v.password)
 $keyType=if($v.security -eq 'wpa2' -and [string]$v.password -match '^[a-fA-F0-9]{64}$'){'networkKey'}else{'passPhrase'}
 $shared='<sharedKey><keyType>'+$keyType+'</keyType><protected>false</protected><keyMaterial>'+$key+'</keyMaterial></sharedKey>'
}
# Profile XML stays in memory and is passed directly to Native Wi-Fi, never a temp file.
$xml='<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>'+$name+'</name><SSIDConfig><SSID><hex>'+$ssidHex+'</hex></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode><MSM><security><authEncryption><authentication>'+$auth+'</authentication><encryption>'+$encryption+'</encryption><useOneX>false</useOneX></authEncryption>'+$shared+'</security></MSM></WLANProfile>'
$handle=[IntPtr]::Zero;$negotiated=[uint32]0;$reason=[uint32]0
try {
 $code=[USTBWifi]::WlanOpenHandle(2,[IntPtr]::Zero,[ref]$negotiated,[ref]$handle)
 if($code -ne 0){[Console]::Out.Write('{"ok":false,"code":"permissionDenied"}');exit 0}
 $code=[USTBWifi]::WlanSetProfile($handle,[ref]$guid,0,$xml,$null,$true,[IntPtr]::Zero,[ref]$reason)
 if($code -ne 0){[Console]::Out.Write('{"ok":false,"code":"unsupportedSecurity"}');exit 0}
 if($v.force){$null=[USTBWifi]::WlanDisconnect($handle,[ref]$guid,[IntPtr]::Zero)}
 $p=New-Object USTBWifi+ConnectParams;$p.mode=0;$p.profile=$name;$p.bssType=1
 $code=[USTBWifi]::WlanConnect($handle,[ref]$guid,[ref]$p,[IntPtr]::Zero)
 [Console]::Out.Write(([ordered]@{ok=($code -eq 0);code=$(if($code -eq 0){'requested'}else{'failed'});profile=$name}|ConvertTo-Json -Compress))
} finally {
 if($handle -ne [IntPtr]::Zero){$null=[USTBWifi]::WlanCloseHandle($handle,[IntPtr]::Zero)}
 $xml=$null;$shared=$null;$key=$null;$v=$null
}
