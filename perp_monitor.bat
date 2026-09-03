@echo off
setlocal ENABLEDELAYEDEXPANSION
title Perp Realtime Monitor
chcp 65001 >nul

:: -- base setting
set MAIN_FILE=main.mjs

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║            Hyperliquid Perp Realtime Monitor (CLI)           ║
echo ║══════════════════════════════════════════════════════════════║
echo ║                      Start %MAIN_FILE%                       ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

rem ---- defaults
set "DEF_THRESHOLD=50000"
set "DEF_DUMP_AFTER=10"
set "DEF_TABLE_SEC=5"
set "DEF_PRINT_TRADES=N"
set "DEF_LOGGING=N"
set "DEF_COINS="
set "DEF_FROM="

echo Specify parameters (Enter = default value):
set /p THRESHOLD=Minimum transaction volume in USD [ %DEF_THRESHOLD% ]: 
if "%THRESHOLD%"=="" set "THRESHOLD=%DEF_THRESHOLD%"

set /p COINS=Coins separated by commas (BTC,ETH) [ all ]: 

set /p FROM=History from (ISO or ms, e.g. 2025-10-10T00:00:00Z) [ do not use ]: 

set /p DUMP_AFTER=Dump after N closed positions [ %DEF_DUMP_AFTER% ]: 
if "%DUMP_AFTER%"=="" set "DUMP_AFTER=%DEF_DUMP_AFTER%"

set /p TABLE_SEC=Updating the table (sec) [ %DEF_TABLE_SEC% ]: 
if "%TABLE_SEC%"=="" set "TABLE_SEC=%DEF_TABLE_SEC%"

set /p PRINT_TRADES=Printing large transactions?? (Y/N) [ %DEF_PRINT_TRADES% ]: 
if "%PRINT_TRADES%"=="" set "PRINT_TRADES=%DEF_PRINT_TRADES%"

@REM set /p LOGGING=Write log to file (logs\perp.log)? (Y/N) [ %DEF_LOGGING% ]: 
@REM if "%LOGGING%"=="" set "LOGGING=%DEF_LOGGING%"
@REM echo.

rem ---- comand collecting
set "CMD=node "%MAIN_FILE%" --threshold %THRESHOLD% --dump-after %DUMP_AFTER% --table-sec %TABLE_SEC% --log-file"
if not "%COINS%"=="" set "CMD=!CMD! --coins %COINS%"
if not "%FROM%"==""  set "CMD=!CMD! --from "%FROM%""
if /I "%PRINT_TRADES%"=="Y" set "CMD=!CMD! --print-trades"
@REM if /I "%LOGGING%"=="Y" set "CMD=!CMD! --log-file"

rem ---- logging (simple file without timestamp)
set "RUN=!CMD!"
if /I "%LOGGING%"=="Y" (
  if not exist logs mkdir logs
  set "RUN=!CMD!  ^>^> logs\perp.log 2^>^&1"
)

echo ╔══════════════════════════════════════════════════════════════╗
echo ║ Command for start:
echo ║   !CMD!
if /I "%LOGGING%"=="Y" echo ║ Log: logs\perp.log  (append)
echo ╚══════════════════════════════════════════════════════════════╝
echo.

%RUN%

echo.
echo [INFO] The process is complete. Press any key to exit....
pause >nul
endlocal
