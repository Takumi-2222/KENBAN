!macro NSIS_HOOK_POSTINSTALL
  ; Overwrite shortcuts to use KENBAN.ico instead of exe icon (avoids Windows icon cache issues)
  CreateShortCut "$SMPROGRAMS\${MAINBINARYNAME}\${MAINBINARYNAME}.lnk" \
                 "$INSTDIR\${MAINBINARYNAME}.exe" \
                 "" \
                 "$INSTDIR\KENBAN.ico" \
                 0

  CreateShortCut "$DESKTOP\${MAINBINARYNAME}.lnk" \
                 "$INSTDIR\${MAINBINARYNAME}.exe" \
                 "" \
                 "$INSTDIR\KENBAN.ico" \
                 0
!macroend
