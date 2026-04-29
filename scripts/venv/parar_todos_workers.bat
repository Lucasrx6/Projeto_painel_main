@echo off
REM =====================================================================
REM  PARA TODOS OS WORKERS PYTHON
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
echo  Parando workers Python
echo =========================================================
echo.

call :stop_servico "Worker_Analise_IA"
call :stop_servico "Notif_Sentir_Agir"
call :stop_servico "Notif_Pareceres"

echo.
pause
exit /b 0


:stop_servico
set "SVC=%~1"
echo [%SVC%] Parando ...
"%NSSM%" stop "%SVC%"
echo.
goto :eof
