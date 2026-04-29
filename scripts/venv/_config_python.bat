@echo off
REM =====================================================================
REM  _config_python.bat
REM  Localiza o python.exe do venv do projeto e expoe na variavel %PYTHON%.
REM
REM  Chamado pelos demais .bat via:
REM      call "%~dp0_config_python.bat"
REM      if errorlevel 1 (pause & exit /b 1)
REM
REM  Se a auto-detecao falhar, edite a secao "Override manual" abaixo.
REM =====================================================================

REM ----- Override manual ------------------------------------------------
REM Descomente e ajuste se voce ja sabe o caminho do python.exe do venv:
REM
REM set "PYTHON=C:\Projeto_Painel_Main\venv\Scripts\python.exe"
REM if not "%PYTHON%"=="" goto :verificar_py

REM ----- Auto-detecao ---------------------------------------------------
set "PYTHON="

REM Caminhos do projeto Painel
if exist "C:\Projeto_Painel_Main\venv\Scripts\python.exe"        set "PYTHON=C:\Projeto_Painel_Main\venv\Scripts\python.exe"        & goto :verificar_py
if exist "C:\Projeto_Painel_Main\.venv\Scripts\python.exe"       set "PYTHON=C:\Projeto_Painel_Main\.venv\Scripts\python.exe"       & goto :verificar_py
if exist "C:\Projeto_Painel_Main\venv_painel\Scripts\python.exe" set "PYTHON=C:\Projeto_Painel_Main\venv_painel\Scripts\python.exe" & goto :verificar_py
if exist "C:\Projeto_Painel_Main\env\Scripts\python.exe"         set "PYTHON=C:\Projeto_Painel_Main\env\Scripts\python.exe"         & goto :verificar_py
if exist "C:\Projeto_Painel_Main\venv_main\Scripts\python.exe"   set "PYTHON=C:\Projeto_Painel_Main\venv_main\Scripts\python.exe"   & goto :verificar_py

REM Fallback: venv do ml_workspace (caso seja compartilhado)
if exist "C:\ml_workspace\venv_ml\Scripts\python.exe"            set "PYTHON=C:\ml_workspace\venv_ml\Scripts\python.exe"            & goto :verificar_py


:verificar_py
if "%PYTHON%"=="" (
    echo.
    echo =====================================================================
    echo  [ERRO] python.exe do venv nao foi encontrado automaticamente.
    echo =====================================================================
    echo.
    echo  Os locais testados:
    echo    C:\Projeto_Painel_Main\venv\Scripts\python.exe
    echo    C:\Projeto_Painel_Main\.venv\Scripts\python.exe
    echo    C:\Projeto_Painel_Main\venv_painel\Scripts\python.exe
    echo    C:\Projeto_Painel_Main\env\Scripts\python.exe
    echo    C:\Projeto_Painel_Main\venv_main\Scripts\python.exe
    echo    C:\ml_workspace\venv_ml\Scripts\python.exe
    echo.
    echo  Como descobrir o caminho correto:
    echo    1. Abra o Explorer em C:\Projeto_Painel_Main
    echo    2. Procure uma pasta de venv ^(nome tipo "venv", ".venv", etc.^)
    echo    3. Confirme que tem "Scripts\python.exe" dentro
    echo.
    echo  Quando souber, edite _config_python.bat e descomente/ajuste:
    echo.
    echo      set "PYTHON=C:\caminho\completo\para\Scripts\python.exe"
    echo.
    exit /b 1
)

echo [PYTHON] %PYTHON%
exit /b 0
