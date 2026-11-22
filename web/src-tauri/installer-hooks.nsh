!macro NSIS_HOOK_PREINSTALL
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("INTX_NODE_PATH", "$INSTDIR\canvas-agent-runtime\node\node.exe")'
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $"$$ErrorActionPreference = [System.Management.Automation.ActionPreference]::Stop; try { $$target = [IO.Path]::GetFullPath($$env:INTX_NODE_PATH); $$processes = Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and [IO.Path]::GetFullPath($$_.ExecutablePath) -ieq $$target }; foreach ($$process in $$processes) { Stop-Process -Id $$process.ProcessId -Force -ErrorAction Stop }; exit 0 } catch { exit 1 }$"'
  Pop $0
  Pop $1
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("INTX_NODE_PATH", "")'
  ${If} $0 != 0
    Abort "Unable to stop the INTX Canvas Agent. Close INTX and try again."
  ${EndIf}
!macroend
