; 捣蛋猫兼容版安装日志。仅安装失败时复制到桌面。
; PRODUCT_FILENAME 保持 ASCII，PRODUCT_NAME 用于向导标题与提示。
!define /redef PRODUCT_NAME "捣蛋猫 兼容版"

!ifndef BUILD_UNINSTALLER

!define SC_LOG_DIR "SillyCatElectronDemo"
!define SC_LOG_NAME "install.log"
!define SC_LV_GETITEMCOUNT 0x1004
!define SC_LV_GETITEMTEXTW 0x1073
!define SC_LV_BUFCHARS 1024
!define SC_LV_BUFBYTES 2048

Var scLogPath
Function scInitPath
  StrCmp $scLogPath "" 0 sc_path_done
  SetShellVarContext current
  CreateDirectory "$APPDATA\${SC_LOG_DIR}"
  StrCpy $scLogPath "$APPDATA\${SC_LOG_DIR}\${SC_LOG_NAME}"
  sc_path_done:
FunctionEnd

; 数字补零成两位：栈顶进，栈顶出
Function scPad2
  Exch $0
  IntCmp $0 10 sc_pad_done 0 sc_pad_done
  StrCpy $0 "0$0"
  sc_pad_done:
  Exch $0
FunctionEnd

; 当前本地时间 "YYYY-MM-DD HH:MM:SS"，结果压栈
Function scNow
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  System::Alloc 16
  Pop $0
  System::Call 'kernel32::GetLocalTime(i r0)'
  System::Call '*$0(&i2 .r1, &i2 .r2, &i2, &i2 .r3, &i2 .r4, &i2 .r5, &i2 .r6)'
  System::Free $0
  Push $2
  Call scPad2
  Pop $2
  Push $3
  Call scPad2
  Pop $3
  Push $4
  Call scPad2
  Pop $4
  Push $5
  Call scPad2
  Pop $5
  Push $6
  Call scPad2
  Pop $6
  StrCpy $0 "$1-$2-$3 $4:$5:$6"
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; 给日志追加一行：栈顶进（一行文字）。UTF-8，文件为空时先写 BOM，行尾 CRLF。
; 不改动其他寄存器，也保持调用前的错误标志。
Function scAppendLine
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  StrCpy $6 0
  IfErrors 0 +2
  StrCpy $6 1
  ClearErrors
  Call scInitPath
  FileOpen $1 "$scLogPath" a
  IfErrors sc_append_end
  FileSeek $1 0 END $2
  IntCmp $2 0 0 sc_append_bom_done sc_append_bom_done
  System::Alloc 4
  Pop $3
  System::Call '*$3(&i1 239, &i1 187, &i1 191)'
  System::Call 'kernel32::WriteFile(i r1, i r3, i 3, *i .r4, i 0)'
  System::Free $3
  sc_append_bom_done:
  StrCpy $0 "$0$\r$\n"
  System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w r0, i -1, i 0, i 0, i 0, i 0) i .r2'
  IntCmp $2 1 sc_append_close sc_append_close sc_append_convert
  sc_append_convert:
  System::Alloc $2
  Pop $3
  System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w r0, i -1, i r3, i r2, i 0, i 0) i .r5'
  IntOp $5 $2 - 1
  System::Call 'kernel32::WriteFile(i r1, i r3, i r5, *i .r4, i 0)'
  System::Free $3
  sc_append_close:
  FileClose $1
  sc_append_end:
  StrCmp $6 1 sc_append_seterr sc_append_clrerr
  sc_append_seterr:
  SetErrors
  Goto sc_append_exit
  sc_append_clrerr:
  ClearErrors
  sc_append_exit:
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; 带时间的一行：栈顶进（文字）
Function scStage
  Exch $0
  Push $1
  Call scNow
  Pop $1
  Push "[$1] $0"
  Call scAppendLine
  Pop $1
  Pop $0
FunctionEnd

!macro scStageMacro TEXT
  Push "${TEXT}"
  Call scStage
!macroend

; 系统版本：读 HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion
Function scLogSysInfo
  Push $0
  Push $1
  Push $2
  Push $3
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "ProductName"
  ReadRegStr $1 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentVersion"
  ReadRegStr $2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuild"
  StrCmp $2 "" 0 +2
  ReadRegStr $2 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  ReadRegStr $3 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CSDVersion"
  Push "os: ProductName=[$0] CurrentVersion=[$1] CurrentBuild=[$2] CSDVersion=[$3]"
  Call scAppendLine
  ReadEnvStr $0 PROCESSOR_ARCHITECTURE
  ReadEnvStr $1 PROCESSOR_ARCHITEW6432
  Push "arch: PROCESSOR_ARCHITECTURE=[$0] PROCESSOR_ARCHITEW6432=[$1]"
  Call scAppendLine
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; 路径只描述特征，不带路径本身：栈顶进（路径），栈顶出（描述）。
; drive=盘符  nonAscii=含不含非 ASCII 字符（中文目录常见问题）  spaces=含不含空格  len=长度  where=在不在 %LOCALAPPDATA% / Program Files 下
Function scDescribePath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  StrCpy $6 $0 2
  StrCpy $2 $6 "" 1
  StrCmp $2 ":" sc_dp_drive_ok
  StrCpy $6 "-"
  sc_dp_drive_ok:
  System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w r0, i -1, i 0, i 0, i 0, i 0) i .r2'
  StrLen $3 $0
  IntOp $4 $3 + 1
  StrCmp $2 $4 sc_dp_ascii
  StrCpy $4 "true"
  Goto sc_dp_nonascii_done
  sc_dp_ascii:
  StrCpy $4 "false"
  sc_dp_nonascii_done:
  System::Call 'shlwapi::StrChrW(w r0, i 32) i .r2'
  StrCmp $2 0 sc_dp_nospace
  StrCpy $2 "true"
  Goto sc_dp_space_done
  sc_dp_nospace:
  StrCpy $2 "false"
  sc_dp_space_done:
  StrCpy $5 "other"
  StrLen $1 "$LOCALAPPDATA"
  StrCpy $1 $0 $1
  StrCmp $1 "$LOCALAPPDATA" 0 +2
  StrCpy $5 "%LOCALAPPDATA%"
  StrLen $1 "$PROGRAMFILES"
  StrCpy $1 $0 $1
  StrCmp $1 "$PROGRAMFILES" 0 +2
  StrCpy $5 "%ProgramFiles%"
  StrCpy $0 "drive=$6 nonAscii=$4 spaces=$2 len=$3 where=$5"
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

; 安装目录的特征
Function scLogInstDir
  Push $0
  Push "$INSTDIR"
  Call scDescribePath
  Pop $0
  Push "instdir: $0"
  Call scAppendLine
  Pop $0
FunctionEnd

; 安装器的文件名（不含目录）、所在目录的特征、是否静默、安装目录的特征。不写命令行：它的第一段是安装器自己的完整路径。
Function scLogContext
  Push $0
  Push "$EXEDIR"
  Call scDescribePath
  Pop $0
  Push "installer dir: $0"
  Call scAppendLine
  IfSilent sc_ctx_silent sc_ctx_loud
  sc_ctx_silent:
  Push "silent: yes"
  Call scAppendLine
  Goto sc_ctx_done
  sc_ctx_loud:
  Push "silent: no"
  Call scAppendLine
  sc_ctx_done:
  Call scLogInstDir
  Pop $0
FunctionEnd

; 转储安装器「详情」列表（SysListView32，控件 ID 1016）的全部文字，Unicode 版 LVM_GETITEMTEXTW
Function scDumpDetails
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  IfSilent sc_dump_none
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $0 $0 1016
  StrCmp $0 0 sc_dump_none
  SendMessage $0 ${SC_LV_GETITEMCOUNT} 0 0 $4
  IntCmp $4 0 sc_dump_empty sc_dump_empty
  System::Alloc ${SC_LV_BUFBYTES}
  Pop $3
  System::Alloc 36
  Pop $1
  System::Call '*$1(i 0, i 0, i 0, i 0, i 0, i r3, i ${SC_LV_BUFCHARS}, i 0, i 0)'
  Push "details list ($4 lines):"
  Call scAppendLine
  StrCpy $2 0
  sc_dump_loop:
  IntCmp $2 $4 sc_dump_done 0 sc_dump_done
  System::Call 'user32::SendMessageW(i r0, i ${SC_LV_GETITEMTEXTW}, i r2, i r1)'
  System::Call '*$3(&t${SC_LV_BUFCHARS} .r5)'
  StrCpy $7 "\"
  System::Call 'shlwapi::StrStrIW(w r5, w r7) i .r6'
  StrCmp $6 0 0 sc_dump_pathline
  StrCpy $7 "/"
  System::Call 'shlwapi::StrStrIW(w r5, w r7) i .r6'
  StrCmp $6 0 sc_dump_plain
  sc_dump_pathline:
  Push "  | (line omitted: contains a file path)"
  Call scAppendLine
  Goto sc_dump_next
  sc_dump_plain:
  Push "  | $5"
  Call scAppendLine
  sc_dump_next:
  IntOp $2 $2 + 1
  Goto sc_dump_loop
  sc_dump_done:
  System::Free $1
  System::Free $3
  Goto sc_dump_end
  sc_dump_empty:
  Push "details list: (empty - the electron-builder template sets SetDetailsPrint none while installing)"
  Call scAppendLine
  Goto sc_dump_end
  sc_dump_none:
  Push "details list: (control not found)"
  Call scAppendLine
  sc_dump_end:
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; ---- 纯追加的模板钩子 ----

!macro preInit
  Call scInitPath
  Push "============================================================"
  Call scAppendLine
  !insertmacro scStageMacro "installer started (SillyCatElectronDemo ${VERSION})"
  Call scLogSysInfo
  Call scLogContext
!macroend

!macro customInit
  !insertmacro scStageMacro "init done (.onInit finished)"
  Call scLogInstDir
!macroend

!macro customFiles_x64
  !insertmacro scStageMacro "app files extracted"
!macroend

!macro customInstall
  !insertmacro scStageMacro "install section finished (files, shortcuts and registry done)"
!macroend

; ---- NSIS 回调 ----

Function .onInstSuccess
  !insertmacro scStageMacro "RESULT: SUCCESS"
  Call scLogContext
  IfFileExists "$INSTDIR\SillyCatElectronDemo.exe" sc_ok_exe sc_ok_noexe
  sc_ok_exe:
  Push "check: SillyCatElectronDemo.exe exists in the install dir"
  Call scAppendLine
  Goto sc_ok_dump
  sc_ok_noexe:
  Push "check: WARNING SillyCatElectronDemo.exe NOT found in the install dir"
  Call scAppendLine
  sc_ok_dump:
  Call scDumpDetails
FunctionEnd

Function .onInstFailed
  !insertmacro scStageMacro "RESULT: FAILED (install section aborted)"
  Call scLogContext
  Call scDumpDetails
  SetShellVarContext current
  ClearErrors
  CopyFiles /SILENT "$scLogPath" "$DESKTOP\捣蛋猫兼容版-安装日志.txt"
  IfErrors sc_fail_fallback
  MessageBox MB_OK|MB_ICONEXCLAMATION "捣蛋猫 兼容版安装失败。请查看桌面上的 捣蛋猫兼容版-安装日志.txt。" /SD IDOK
  Goto sc_fail_done
  sc_fail_fallback:
  MessageBox MB_OK|MB_ICONEXCLAMATION "捣蛋猫 兼容版安装失败。请到 %APPDATA%\${SC_LOG_DIR}\ 找 install.log。" /SD IDOK
  sc_fail_done:
FunctionEnd

; .onUserAbort 已被 MUI2 的 MUI_FUNCTION_ABORTWARNING 定义（重复定义会报错）；
; 用 MUI 提供的 MUI_CUSTOMFUNCTION_ABORT 挂钩，它在用户确认放弃之后才被调用。
Function scOnUserAbort
  !insertmacro scStageMacro "RESULT: user cancelled / closed the installer window"
  Call scLogContext
  Call scDumpDetails
FunctionEnd
!define MUI_CUSTOMFUNCTION_ABORT scOnUserAbort

Function .onGUIEnd
  !insertmacro scStageMacro "installer window closed"
FunctionEnd

!endif
