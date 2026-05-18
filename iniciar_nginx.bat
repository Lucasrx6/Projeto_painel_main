@echo off
setlocal

:: ============================================================
:: iniciar_nginx.bat
:: Inicia o Nginx (HTTP :80 + HTTPS :443 -> Flask :5000)
:: Para uso no Windows Server 2019 — execute como Administrador
:: ============================================================

set NGINX_DIR=C:\nginx
set NGINX_EXE=%NGINX_DIR%\nginx.exe
set LOG_DIR=C:\Projeto_Painel_Main\logs
set LOG_FILE=%LOG_DIR%\nginx_start.log

:: Garante que a pasta de logs existe
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Timestamp de inicio
for /f "tokens=1-2 delims= " %%a in ('wmic os get localdatetime /value ^| find "="') do set DT=%%b
set HORA=%DT:~8,2%:%DT:~10,2%:%DT:~12,2%
set DATA=%DT:~6,2%/%DT:~4,2%/%DT:~0,4%

echo [%DATA% %HORA%] ===== Iniciando Nginx ===== >> "%LOG_FILE%"
echo [%DATA% %HORA%] ===== Iniciando Nginx =====

:: Verifica se o executavel existe
if not exist "%NGINX_EXE%" (
    echo [%DATA% %HORA%] ERRO: nginx.exe nao encontrado em %NGINX_DIR% >> "%LOG_FILE%"
    echo [%DATA% %HORA%] ERRO: nginx.exe nao encontrado em %NGINX_DIR%
    exit /b 1
)

:: Verifica se ja esta rodando
tasklist /fi "imagename eq nginx.exe" /nh 2>nul | find /i "nginx.exe" >nul
if %errorlevel% == 0 (
    echo [%DATA% %HORA%] Nginx ja esta em execucao. Enviando reload de configuracao... >> "%LOG_FILE%"
    echo [%DATA% %HORA%] Nginx ja esta em execucao. Enviando reload...
    "%NGINX_EXE%" -p "%NGINX_DIR%" -s reload
    if %errorlevel% == 0 (
        echo [%DATA% %HORA%] Reload concluido com sucesso. >> "%LOG_FILE%"
        echo [%DATA% %HORA%] Reload concluido com sucesso.
    ) else (
        echo [%DATA% %HORA%] ERRO no reload. Verifique os logs do Nginx em %NGINX_DIR%\logs\ >> "%LOG_FILE%"
        echo [%DATA% %HORA%] ERRO no reload.
    )
    exit /b 0
)

:: Testa a configuracao antes de iniciar
echo [%DATA% %HORA%] Testando configuracao... >> "%LOG_FILE%"
"%NGINX_EXE%" -p "%NGINX_DIR%" -t 2>>"%LOG_FILE%"
if %errorlevel% neq 0 (
    echo [%DATA% %HORA%] ERRO: Configuracao invalida. Nginx NAO iniciado. Veja o log acima. >> "%LOG_FILE%"
    echo [%DATA% %HORA%] ERRO: Configuracao invalida. Nginx NAO iniciado. Verifique %LOG_FILE%
    exit /b 1
)

:: Inicia o Nginx com prefix path para garantir que encontra nginx.conf e logs
echo [%DATA% %HORA%] Configuracao OK. Iniciando processo... >> "%LOG_FILE%"
start "" "%NGINX_EXE%" -p "%NGINX_DIR%"

:: Aguarda 2 segundos e confirma que subiu
timeout /t 2 /nobreak >nul
tasklist /fi "imagename eq nginx.exe" /nh 2>nul | find /i "nginx.exe" >nul
if %errorlevel% == 0 (
    echo [%DATA% %HORA%] Nginx iniciado com sucesso. Portas: :80 (HTTP) e :443 (HTTPS) >> "%LOG_FILE%"
    echo [%DATA% %HORA%] Nginx iniciado com sucesso. Portas: :80 e :443
) else (
    echo [%DATA% %HORA%] ERRO: Nginx nao subiu apos 2 segundos. Verifique %NGINX_DIR%\logs\error.log >> "%LOG_FILE%"
    echo [%DATA% %HORA%] ERRO: Nginx nao subiu. Verifique %NGINX_DIR%\logs\error.log
    exit /b 1
)

endlocal
exit /b 0
