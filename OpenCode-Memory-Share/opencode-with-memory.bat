@echo off
set OPENCODE_DIR=C:\Users\12527\.config\opencode

REM Clean old session flag
del /q "%OPENCODE_DIR%\.memory-session-active" 2>nul

REM Kill old watcher if running (by window title and lock file PID)
taskkill /FI "WINDOWTITLE eq memory-watcher" /F >nul 2>&1
for /f %%p in ('type "%OPENCODE_DIR%\.memory-watcher.lock" 2^>nul') do taskkill /PID %%p /F >nul 2>&1

REM Load memory context from server
node "%OPENCODE_DIR%\load-memory-context.js" --load

REM Start memory watcher (auto-sync new messages to server)
start "memory-watcher" /MIN node "%OPENCODE_DIR%\memory-watcher.js"

REM Start OpenCode
start opencode --prompt "You MUST speak Chinese only! Read the file %OPENCODE_DIR%\.memory-history.txt and display the conversation history to the user in Chinese, then ask if they want to continue."

REM Wait for OpenCode to start
timeout /t 5 /nobreak >nul
