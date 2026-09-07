#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef InstallerOutput
  #error InstallerOutput is required
#endif

[Setup]
AppId={{6E17E88E-073F-4827-9377-49523373F319}
AppName=Clash Node Pilot
AppVersion={#AppVersion}
AppPublisher=Clash Node Pilot contributors
AppPublisherURL=https://github.com/xuytwinter/clash-node-pilot
DefaultDirName={localappdata}\Programs\Clash Node Pilot
DefaultGroupName=Clash Node Pilot
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UninstallDisplayName=Clash Node Pilot
UninstallDisplayIcon={app}\runtime\node.exe
OutputDir={#InstallerOutput}
OutputBaseFilename=clash-node-pilot-v{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CreateUninstallRegKey=IntegrationEnabled
UsePreviousAppDir=IntegrationEnabled
UsePreviousTasks=IntegrationEnabled
CloseApplications=no
RestartApplications=no
RestartIfNeededByRun=no
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked; Check: IntegrationEnabled

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stop-pilot.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\Clash Node Pilot"; Filename: "{app}\start-clash-node-pilot.cmd"; WorkingDir: "{app}"; Check: IntegrationEnabled
Name: "{userprograms}\Stop Clash Node Pilot"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\stop-pilot.ps1"""; WorkingDir: "{app}"; Check: IntegrationEnabled
Name: "{userdesktop}\Clash Node Pilot"; Filename: "{app}\start-clash-node-pilot.cmd"; WorkingDir: "{app}"; Tasks: desktopicon; Check: IntegrationEnabled

[Code]
const
  OwnershipMarker = '.clash-node-pilot-install';
  OwnershipValue = '6E17E88E-073F-4827-9377-49523373F319';
  FileAttributeReparsePoint = $400;

function GetFileAttributesW(FileName: String): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';

function IntegrationEnabled: Boolean;
begin
  Result := ExpandConstant('{param:NOINTEGRATION|0}') <> '1';
end;

function ValidateDestination(Directory: String): String;
var
  Current: String;
  Attributes: LongWord;
  Found: TFindRec;
  Marker: AnsiString;
begin
  Result := '';
  Current := RemoveBackslashUnlessRoot(ExpandFileName(Directory));
  if (Length(Current) <= 3) or (Copy(Current, 1, 2) = '\\') then begin
    Result := 'Choose a dedicated local application directory.';
    Exit;
  end;
  while Length(Current) > 3 do begin
    Attributes := GetFileAttributesW(Current);
    if (Attributes <> $FFFFFFFF) and ((Attributes and FileAttributeReparsePoint) <> 0) then begin
      Result := 'Installation through a symbolic link or junction is not supported.';
      Exit;
    end;
    Current := ExtractFileDir(Current);
  end;
  if DirExists(Directory) and FindFirst(AddBackslash(Directory) + '*', Found) then begin
    try
      repeat
        if (Found.Name <> '.') and (Found.Name <> '..') then begin
          if not LoadStringFromFile(AddBackslash(Directory) + OwnershipMarker, Marker) or
             (Trim(String(Marker)) <> OwnershipValue) then
            Result := 'The destination is not an existing Node Pilot installation. Choose an empty directory.';
          Break;
        end;
      until not FindNext(Found);
    finally
      FindClose(Found);
    end;
  end;
end;

function RuntimeInUse(Directory: String): Boolean;
var
  Locator, Services, Processes, Process: Variant;
  Index: Integer;
  Target, Executable: String;
begin
  Result := False;
  Target := AddBackslash(Directory) + 'runtime\node.exe';
  if not FileExists(Target) then Exit;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('', 'root\CIMV2');
    Processes := Services.ExecQuery('SELECT ExecutablePath FROM Win32_Process WHERE Name = ''node.exe''');
    for Index := 0 to Processes.Count - 1 do begin
      Process := Processes.ItemIndex(Index);
      if not VarIsNull(Process.ExecutablePath) then begin
        Executable := Process.ExecutablePath;
        if CompareText(Executable, Target) = 0 then begin
          Result := True;
          Exit;
        end;
      end;
    end;
  except
    // Refuse an upgrade if we cannot establish that its bundled runtime is idle.
    Result := True;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := ValidateDestination(ExpandConstant('{app}'));
  if (Result = '') and RuntimeInUse(ExpandConstant('{app}')) then
    Result := 'Node Pilot is running from this installation. Close it yourself and retry. Setup will not stop processes.';
end;

function InitializeUninstall: Boolean;
begin
  Result := not RuntimeInUse(ExpandConstant('{app}'));
  if not Result then
    SuppressibleMsgBox('Node Pilot is running from this installation. Use Stop Clash Node Pilot before uninstalling. No processes were stopped.', mbError, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    if not SaveStringToFile(ExpandConstant('{app}\') + OwnershipMarker, OwnershipValue, False) then
      RaiseException('Could not write the installation ownership marker.');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    DeleteFile(ExpandConstant('{app}\') + OwnershipMarker);
end;
