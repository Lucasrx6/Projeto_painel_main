@echo off
REM =====================================================================
REM  STATUS DOS WORKERS PYTHON (usa sc query nativo)
REM =====================================================================

setlocal EnableDelayedExpansion

echo.
echo =========================================================
echo  Status dos workers Python
echo =========================================================
echo.

call :status_servico "Worker_Analise_IA"
call :status_servico "Notif_Sentir_Agir"
call :status_servico "Notif_Pareceres"

echo.
echo =========================================================
echo  Legenda:
echo    RUNNING        = ok, processando
echo    STOPPED        = parado
echo    START_PENDING  = subindo (aguarde)
echo    STOP_PENDING   = parando
echo =========================================================
echo.
pause
exit /b 0


:status_servico
set "SVC=%~1"
set "ST=DESCONHECIDO"
set "PID="

sc query "%SVC%" >nul 2>&1
if %errorLevel% neq 0 (
    echo   [%SVC%]  NAO INSTALADO
    goto :eof
)

for /f "tokens=3,4" %%A in ('sc query "%SVC%" ^| findstr /C:"STATE"') do (
    set "ST=%%B"
)

for /f "tokens=3" %%A in ('sc queryex "%SVC%" ^| findstr /C:"PID"') do (
    set "PID=%%A"
)
if "%PID%"=="0" set "PID="

if defined PID (
    echo   [%SVC%]  !ST!   ^(PID !PID!^)
) else (
    echo   [%SVC%]  !ST!
)
goto :eof
