@echo off
REM ============================================================
REM  Notificador de Ocupacao Hospitalar - Painel HAC
REM  Envia relatorio de ocupacao por email em intervalos
REM  configurados no .env (NOTIF_OCUPACAO_EMAILS, etc.)
REM
REM  Para instalar como servico Windows via NSSM:
REM    nssm install NotifOcupacao "caminho\python.exe" "caminho\notificador_ocupacao_hospitalar.py"
REM    nssm set NotifOcupacao AppDirectory "C:\Projeto_Painel_Main"
REM    nssm start NotifOcupacao
REM ============================================================

cd /d "%~dp0"

SET PYTHON=.venv\Scripts\python.exe
IF NOT EXIST "%PYTHON%" SET PYTHON=python

echo.
echo ============================================================
echo  Notificador de Ocupacao Hospitalar
echo  Configuracao: .env (NOTIF_OCUPACAO_EMAILS / HORARIOS)
echo  Log: logs\notificador_ocupacao.log
echo ============================================================
echo.

"%PYTHON%" backend\notificador_ocupacao_hospitalar.py

pause
