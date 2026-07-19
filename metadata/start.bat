@echo off
REM ==================================================
REM  A-share Theme Stock & Fund Monitor Terminal
REM  One-click launcher: starts local proxy on :8000
REM  Works on any PC with Python 3.8+ in PATH.
REM  (English-only content to avoid BAT encoding issues)
REM ==================================================
cd /d "%~dp0"
echo ==================================================
echo   A-share Theme Stock ^& Fund Monitor Terminal
echo   Starting local proxy server (port 8000)...
echo ==================================================
echo.

REM Auto-locate Python (no hardcoded path)
set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py
if not defined PY where python3 >nul 2>nul && set PY=python3

if not defined PY (
  echo [ERROR] Python not found.
  echo   Please install Python 3.8+ and add it to PATH:
  echo   https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

echo Using Python: %PY%
echo Opening browser to http://localhost:8000/ ...
start "" http://localhost:8000/
echo.
echo Press Ctrl+C to stop the server.
echo.
%PY% proxy.py
pause
