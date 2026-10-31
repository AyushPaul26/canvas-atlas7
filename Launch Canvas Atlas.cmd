@echo off
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Programs\Canvas Atlas\Canvas Atlas.exe" (
  start "" "%LOCALAPPDATA%\Programs\Canvas Atlas\Canvas Atlas.exe"
) else if exist "release\visual-refinement\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\visual-refinement\win-unpacked\Canvas Atlas.exe"
) else if exist "release\chatgpt-notes-fix\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\chatgpt-notes-fix\win-unpacked\Canvas Atlas.exe"
) else if exist "release\learner-safety\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\learner-safety\win-unpacked\Canvas Atlas.exe"
) else if exist "release\lesson-notes\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\lesson-notes\win-unpacked\Canvas Atlas.exe"
) else if exist "release\gemini-stream-fix\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\gemini-stream-fix\win-unpacked\Canvas Atlas.exe"
) else if exist "release\groq-compat\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\groq-compat\win-unpacked\Canvas Atlas.exe"
) else if exist "release\ai-providers\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\ai-providers\win-unpacked\Canvas Atlas.exe"
) else if exist "release\elevenlabs\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\elevenlabs\win-unpacked\Canvas Atlas.exe"
) else if exist "release\startup-fix\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\startup-fix\win-unpacked\Canvas Atlas.exe"
) else if exist "release\visual-companion\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\visual-companion\win-unpacked\Canvas Atlas.exe"
) else if exist "release\win-unpacked\Canvas Atlas.exe" (
  start "" "%~dp0release\win-unpacked\Canvas Atlas.exe"
) else (
  echo Build the Windows app first with npm run package.
  pause
)
