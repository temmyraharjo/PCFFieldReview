@echo off
rem Builds the PCF controls, bumps version numbers and packages the solution.
rem Passes any arguments through, e.g.:  build.cmd -Configuration Release
rem See scripts\build.ps1 for all options.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build.ps1" %*
exit /b %ERRORLEVEL%
