@echo off
REM =====================================================================
REM  INSTALADOR DE SERVICOS NSSM - WORKERS PYTHON DO PAINEL
REM  Hospital Anchieta Ceilandia - Sistema de Paineis Hospitalares
REM
REM  Registra cada worker .py como servico do Windows via NSSM, usando o
REM  python.exe do venv do projeto. Cada servico inicia no boot e reinicia
REM  automaticamente se cair.
REM =====================================================================

setlocal EnableDelayedExpansion

REM ----- Verificacao de privilegios de administrador -----
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] Este script precisa ser executado como Administrador.
    pause
    exit /b 1
)

REM ----- Localiza nssm.exe -----
call "%~dp0_config_nssm.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

REM ----- Localiza python.exe do venv -----
call "%~dp0_config_python.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

REM ----- Configuracoes -----
set "PROJECT_DIR=C:\Projeto_Painel_Main"
set "LOG_DIR=C:\logs\workers"

REM ----- Verificacao do projeto -----
if not exist "%PROJECT_DIR%" (
    echo [ERRO] Pasta do projeto nao encontrada: %PROJECT_DIR%
    pause
    exit /b 1
)

REM ----- Cria diretorio de logs -----
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo =========================================================
echo  Instalando workers Python como servicos NSSM
echo =========================================================
echo  PYTHON:      %PYTHON%
echo  PROJECT_DIR: %PROJECT_DIR%
echo  LOG_DIR:     %LOG_DIR%
echo =========================================================
echo.

call :install_worker "Worker_Analise_IA"   "worker_sentir_agir_analise.py"  "Sentir e Agir - Worker de Analise IA (Groq Llama 3.3 70B)"
call :install_worker "Notif_Sentir_Agir"   "notificador_sentir_agir.py"     "Sentir e Agir - Notificador (ntfy / email)"
call :install_worker "Notif_Pareceres"     "notificador_pareceres.py"       "Pareceres - Notificador (ntfy / email)"

echo.
echo =========================================================
echo  Instalacao concluida.
echo =========================================================
echo.
echo  Iniciar todos agora:    iniciar_todos_workers.bat
echo  Verificar status:       status_workers.bat
echo.
echo  Logs em: %LOG_DIR%
echo.
pause
exit /b 0


REM =====================================================================
REM  :install_worker  nome_servico  arquivo_py  descricao
REM =====================================================================
:install_worker
set "SVC=%~1"
set "PY_SCRIPT=%~2"
set "DESC=%~3"

echo [%SVC%] Instalando para %PY_SCRIPT% ...

REM Verifica que o script existe antes de instalar
if not exist "%PROJECT_DIR%\%PY_SCRIPT%" (
    echo   [ERRO] Script nao encontrado: %PROJECT_DIR%\%PY_SCRIPT%
    echo          Servico %SVC% NAO foi instalado.
    echo.
    goto :eof
)

REM Remove instalacao anterior, se existir (silencioso)
"%NSSM%" stop "%SVC%" >nul 2>&1
"%NSSM%" remove "%SVC%" confirm >nul 2>&1

REM Instala
"%NSSM%" install "%SVC%" "%PYTHON%"
if %errorLevel% neq 0 (
    echo   [ERRO] Falha ao instalar %SVC%
    goto :eof
)

REM Parametros: -u (output unbuffered, logs em tempo real) + script
"%NSSM%" set "%SVC%" AppParameters "-u %PY_SCRIPT%"

REM Diretorio de trabalho = raiz do projeto (pra .env, imports, paths relativos)
"%NSSM%" set "%SVC%" AppDirectory "%PROJECT_DIR%"

REM Forca python a nao bufferizar stdout/stderr (alem do -u, por garantia)
"%NSSM%" set "%SVC%" AppEnvironmentExtra "PYTHONUNBUFFERED=1" "PYTHONIOENCODING=utf-8"

REM Descricao e auto-start
"%NSSM%" set "%SVC%" Description "%DESC%"
"%NSSM%" set "%SVC%" Start SERVICE_AUTO_START

REM Logs com rotacao a 10 MB
"%NSSM%" set "%SVC%" AppStdout "%LOG_DIR%\%SVC%.log"
"%NSSM%" set "%SVC%" AppStderr "%LOG_DIR%\%SVC%.err.log"
"%NSSM%" set "%SVC%" AppRotateFiles 1
"%NSSM%" set "%SVC%" AppRotateOnline 1
"%NSSM%" set "%SVC%" AppRotateBytes 10485760

REM Politica de parada (gracioso primeiro, depois forca)
"%NSSM%" set "%SVC%" AppStopMethodSkip 0
"%NSSM%" set "%SVC%" AppStopMethodConsole 5000
"%NSSM%" set "%SVC%" AppStopMethodWindow 5000
"%NSSM%" set "%SVC%" AppStopMethodThreads 5000

REM Restart se cair (delay 10s, throttle 30s pra evitar loop de crash)
"%NSSM%" set "%SVC%" AppExit Default Restart
"%NSSM%" set "%SVC%" AppRestartDelay 10000
"%NSSM%" set "%SVC%" AppThrottle 30000

echo   [OK] %SVC% instalado.
echo.
goto :eof
