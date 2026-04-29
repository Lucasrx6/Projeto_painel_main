@echo off
REM =====================================================================
REM  INICIA TODOS OS WORKERS PYTHON
REM =====================================================================

setlocal

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] Execute como Administrador.
    pause
    exit /b 1
)

call "%~dp0_config_nssm.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

echo.
echo =========================================================
echo  Iniciando workers Python
echo =========================================================
echo.

call :start_servico "Worker_Analise_IA"
call :start_servico "Notif_Sentir_Agir"
call :start_servico "Notif_Pareceres"

echo.
pause
exit /b 0


:start_servico
set "SVC=%~1"
echo [%SVC%] Iniciando ...
"%NSSM%" start "%SVC%"
echo.
goto :eof
