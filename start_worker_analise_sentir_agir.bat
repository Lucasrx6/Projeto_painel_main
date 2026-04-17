@echo off
REM ============================================================
REM  Worker - Analise Diaria Sentir e Agir (IA)
REM  Hospital Anchieta Ceilandia
REM
REM  Executa o worker que gera automaticamente a analise
REM  diaria com IA as 18:00 (dias uteis, seg-sex).
REM
REM  Para instalar como servico Windows via NSSM:
REM    nssm install WorkerAnaliseSentirAgir "caminho\python.exe" "caminho\worker_sentir_agir_analise.py"
REM    nssm set WorkerAnaliseSentirAgir AppDirectory "caminho\projeto"
REM    nssm start WorkerAnaliseSentirAgir
REM ============================================================

cd /d "%~dp0"

REM Tenta usar venv, fallback para python do sistema
SET PYTHON=.venv\Scripts\python.exe
IF NOT EXIST "%PYTHON%" SET PYTHON=python

echo.
echo ============================================================
echo  Worker Analise Diaria Sentir e Agir
echo  Horario: 18:00 (dias uteis)
echo  Log: logs\worker_sentir_agir_analise.log
echo ============================================================
echo.

"%PYTHON%" worker_sentir_agir_analise.py

pause
