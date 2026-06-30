@echo off
REM Launch the career-ops web dashboard. Run by double-clicking or: dashboard-web\start.cmd
REM NODE_OPTIONS=--use-system-ca is set globally (corporate CA); set here too as a safety net.
set NODE_OPTIONS=--use-system-ca
cd /d "%~dp0\.."
echo Starting career-ops dashboard on http://localhost:4317 ...
start "" "http://localhost:4317"
node dashboard-web\server.mjs
