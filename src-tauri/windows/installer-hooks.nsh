!macro LogMantiquariusInstaller message
  FileOpen $R9 "$TEMP\MANTIQUARIUS-installer.log" a
  ${If} $R9 != ""
    FileWrite $R9 "${message}$\r$\n"
    FileClose $R9
  ${EndIf}
!macroend

!macro StopMantiquariusProcesses
  !insertmacro LogMantiquariusInstaller "Checking for processes using cefbrowser.dll"
  !insertmacro CheckIfAppIsRunning "$INSTDIR\cef-runtime\cefbrowser.dll" "${PRODUCTNAME}"
  !insertmacro LogMantiquariusInstaller "CEF process check complete"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LogMantiquariusInstaller "Install started"
  !insertmacro StopMantiquariusProcesses
  Sleep 500
  !insertmacro LogMantiquariusInstaller "Pre-install process shutdown complete"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro LogMantiquariusInstaller "Install files copied successfully"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LogMantiquariusInstaller "Uninstall started"
  !insertmacro StopMantiquariusProcesses
  Sleep 500
  !insertmacro LogMantiquariusInstaller "Pre-uninstall process shutdown complete"
!macroend
