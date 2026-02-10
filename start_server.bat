@echo off
REM ========================================
REM Script de Inicializacao - Painel Hospitalar
REM Hospital Anchieta - Ceilandia
REM ========================================

REM Define o diretorio do projeto
cd d CProjeto_Painel_Main

REM Ativa o ambiente virtual
call venvScriptsactivate.bat

REM Inicia o servidor Flask
python app.py