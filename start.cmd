@echo off
cd /d "%~dp0"
rem Avvia l'app desktop senza lasciare aperta una finestra del prompt.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
