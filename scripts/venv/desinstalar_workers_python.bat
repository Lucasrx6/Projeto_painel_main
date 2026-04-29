@echo off
REM =====================================================================
REM  DESINSTALADOR DE SERVICOS NSSM - WORKERS PYTHON DO PAINEL
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
echo  Removendo servicos NSSM dos workers Python
echo =========================================================
echo.

call :remove_servico "Worker_Analise_IA"
call :remove_servico "Notif_Sentir_Agir"
call :remove_servico "Notif_Pareceres"

echo.
echo =========================================================
echo  Desinstalacao concluida.
echo =========================================================
echo.
pause
exit /b 0


:remove_servico
set "SVC=%~1"
echo [%SVC%] Parando e removendo ...

"%NSSM%" stop "%SVC%" >nul 2>&1
timeout /t 2 /nobreak >nul

"%NSSM%" remove "%SVC%" confirm
if %errorLevel% equ 0 (
    echo   [OK] %SVC% removido.
) else (
    echo   [AVISO] %SVC% nao existia ou ja foi removido.
)
echo.
goto :eof
