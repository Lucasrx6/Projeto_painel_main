@echo off
REM =====================================================================
REM  _config_nssm.bat
REM  Localiza o nssm.exe no sistema e expoe na variavel %NSSM%.
REM
REM  Este arquivo e chamado pelos demais .bat via:
REM      call "%~dp0_config_nssm.bat"
REM      if errorlevel 1 (pause & exit /b 1)
REM
REM  Se a auto-detecao falhar, edite a secao "Override manual" abaixo.
REM =====================================================================

REM ----- Override manual ------------------------------------------------
REM Descomente e ajuste se voce ja sabe o caminho do nssm.exe.
REM Ex.: set "NSSM=C:\Painel\nssm\win64\nssm.exe"
REM
REM set "NSSM=COLOQUE_AQUI_O_CAMINHO_COMPLETO_PRO_nssm.exe"
REM if not "%NSSM%"=="" goto :verificar

REM ----- Auto-detecao ---------------------------------------------------
set "NSSM="

REM 1. Mesma pasta deste script
if exist "%~dp0nssm.exe"            set "NSSM=%~dp0nssm.exe"            & goto :verificar
if exist "%~dp0nssm\win64\nssm.exe" set "NSSM=%~dp0nssm\win64\nssm.exe" & goto :verificar
if exist "%~dp0nssm\nssm.exe"       set "NSSM=%~dp0nssm\nssm.exe"       & goto :verificar

REM 2. Locais comuns de instalacao
if exist "C:\nssm\win64\nssm.exe"                set "NSSM=C:\nssm\win64\nssm.exe"                & goto :verificar
if exist "C:\nssm\nssm.exe"                      set "NSSM=C:\nssm\nssm.exe"                      & goto :verificar
if exist "C:\Program Files\nssm\nssm.exe"        set "NSSM=C:\Program Files\nssm\nssm.exe"        & goto :verificar
if exist "C:\Program Files\nssm\win64\nssm.exe"  set "NSSM=C:\Program Files\nssm\win64\nssm.exe"  & goto :verificar
if exist "C:\Tools\nssm\nssm.exe"                set "NSSM=C:\Tools\nssm\nssm.exe"                & goto :verificar
if exist "C:\Tools\nssm\win64\nssm.exe"          set "NSSM=C:\Tools\nssm\win64\nssm.exe"          & goto :verificar

REM 3. Ambiente do Painel (locais especificos do HAC)
if exist "C:\Painel\nssm\win64\nssm.exe"   set "NSSM=C:\Painel\nssm\win64\nssm.exe"   & goto :verificar
if exist "C:\Painel\nssm\nssm.exe"         set "NSSM=C:\Painel\nssm\nssm.exe"         & goto :verificar
if exist "C:\Painel\tools\nssm\nssm.exe"   set "NSSM=C:\Painel\tools\nssm\nssm.exe"   & goto :verificar

REM 4. PATH do sistema
for /f "delims=" %%I in ('where nssm 2^>nul') do (
    set "NSSM=%%I"
    goto :verificar
)


:verificar
if "%NSSM%"=="" (
    echo.
    echo =====================================================================
    echo  [ERRO] nssm.exe nao foi encontrado automaticamente.
    echo =====================================================================
    echo.
    echo  Voce ja roda outros servicos NSSM neste servidor ^(Flask, etc.^).
    echo  Para descobrir onde o nssm.exe esta, faca uma das opcoes:
    echo.
    echo  Opcao 1 ^(rapida^): no cmd, rode:
    echo.
    echo      where nssm
    echo.
    echo  Opcao 2: pegue o nome de qualquer servico NSSM existente e rode:
    echo.
    echo      sc qc ^<nome_do_servico^>
    echo.
    echo  A linha "BINARY_PATH_NAME" mostra o caminho completo do nssm.exe.
    echo.
    echo  Quando souber o caminho, abra _config_nssm.bat em um editor de texto
    echo  e descomente/ajuste a linha:
    echo.
    echo      set "NSSM=C:\caminho\completo\para\nssm.exe"
    echo.
    echo  Ou: copie o nssm.exe para a mesma pasta destes scripts.
    echo.
    exit /b 1
)

echo [NSSM] %NSSM%
exit /b 0
