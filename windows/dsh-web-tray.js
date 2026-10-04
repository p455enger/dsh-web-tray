// Started by DSH Web.lnk as: wscript.exe //E:JScript //B "<this file>"
//
// wscript.exe is a GUI-subsystem host, so no console window is ever allocated, and
// //E:JScript names the script engine explicitly rather than letting Windows derive it from
// the file extension — Windows 11 24H2 ships VBScript as a Feature-on-Demand, so a machine
// can end up with no engine mapped to an extension at all.
//
// The helper is started hidden and this launcher returns immediately, so a second
// double-click only reaches the tray's single-instance mutex.
var fso = new ActiveXObject('Scripting.FileSystemObject');
var dir = fso.GetParentFolderName(WScript.ScriptFullName);
// Absolute PowerShell, falling back to the bare name when that location is absent.
var powershell = fso.BuildPath(fso.GetSpecialFolder(1).Path, 'WindowsPowerShell\\v1.0\\powershell.exe');
if (!fso.FileExists(powershell)) { powershell = 'powershell.exe'; }
var tray = fso.BuildPath(dir, 'dsh-web-tray.ps1');
var shell = new ActiveXObject('WScript.Shell');
shell.Run('"' + powershell + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + tray + '"', 0, false);
