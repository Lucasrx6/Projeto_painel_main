# ========================================
# Instalacao do Servico - Painel Hospitalar
# Hospital Anchieta - Ceilandia
# ========================================
# EXECUTE COMO ADMINISTRADOR!
# ========================================

param(
    [string]$NssmPath = "C:\nssm\nssm.exe",
    [string]$ProjectPath = "C:\Projeto_Painel_Main",
    [string]$ServiceName = "PainelHospitalar"
)

# Cores para output
function Write-Success { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Warn { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host $msg -ForegroundColor Red }

# Verifica se esta rodando como Admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "ERRO: Execute este script como Administrador!"
    Write-Warn "Clique com botao direito no PowerShell e selecione 'Executar como Administrador'"
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " INSTALACAO DO SERVICO PAINEL HOSPITALAR" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verifica se NSSM existe
if (-not (Test-Path $NssmPath)) {
    Write-Err "ERRO: NSSM nao encontrado em $NssmPath"
    Write-Info "Baixe em: https://nssm.cc/download"
    Write-Info "Extraia nssm.exe para C:\nssm\"
    exit 1
}
Write-Success "[OK] NSSM encontrado"

# Verifica se projeto existe
if (-not (Test-Path $ProjectPath)) {
    Write-Err "ERRO: Projeto nao encontrado em $ProjectPath"
    exit 1
}
Write-Success "[OK] Projeto encontrado"

# Verifica se script de inicio existe
$startScript = Join-Path $ProjectPath "start-server.bat"
if (-not (Test-Path $startScript)) {
    Write-Warn "Script start-server.bat nao encontrado. Criando..."
    
    $batContent = @"
@echo off
cd /d $ProjectPath
call venv\Scripts\activate.bat
python app.py
"@
    $batContent | Out-File -FilePath $startScript -Encoding ASCII
    Write-Success "[OK] Script start-server.bat criado"
}

# Cria pasta de logs
$logsPath = Join-Path $ProjectPath "logs"
if (-not (Test-Path $logsPath)) {
    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
    Write-Success "[OK] Pasta de logs criada"
}

# Verifica se servico ja existe
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Warn "Servico '$ServiceName' ja existe."
    $choice = Read-Host "Deseja remover e reinstalar? (S/N)"
    if ($choice -eq "S" -or $choice -eq "s") {
        Write-Info "Parando servico..."
        & $NssmPath stop $ServiceName 2>$null
        Start-Sleep -Seconds 2
        
        Write-Info "Removendo servico..."
        & $NssmPath remove $ServiceName confirm
        Start-Sleep -Seconds 2
        Write-Success "[OK] Servico removido"
    } else {
        Write-Info "Instalacao cancelada."
        exit 0
    }
}

Write-Host ""
Write-Info "Instalando servico..."

# Instala o servico
& $NssmPath install $ServiceName $startScript
if ($LASTEXITCODE -ne 0) {
    Write-Err "ERRO ao instalar servico"
    exit 1
}
Write-Success "[OK] Servico instalado"

# Configuracoes do servico
Write-Info "Configurando servico..."

# Descricao
& $NssmPath set $ServiceName Description "Sistema de Paineis Hospitalares - Hospital Anchieta Ceilandia"

# Diretorio de trabalho
& $NssmPath set $ServiceName AppDirectory $ProjectPath

# Reiniciar em caso de falha
& $NssmPath set $ServiceName AppExit Default Restart

# Delay de restart (5 segundos)
& $NssmPath set $ServiceName AppRestartDelay 5000

# Logs
$stdoutLog = Join-Path $logsPath "service-stdout.log"
$stderrLog = Join-Path $logsPath "service-stderr.log"
& $NssmPath set $ServiceName AppStdout $stdoutLog
& $NssmPath set $ServiceName AppStderr $stderrLog

# Rotacao de logs (10MB)
& $NssmPath set $ServiceName AppStdoutCreationDisposition 4
& $NssmPath set $ServiceName AppStderrCreationDisposition 4
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760

# Inicio automatico
& $NssmPath set $ServiceName Start SERVICE_AUTO_START

Write-Success "[OK] Servico configurado"

# Inicia o servico
Write-Host ""
Write-Info "Iniciando servico..."
& $NssmPath start $ServiceName
Start-Sleep -Seconds 3

# Verifica status
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq "Running") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Success " SERVICO INSTALADO COM SUCESSO!"
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Nome do servico: $ServiceName"
    Write-Host "Status: Rodando"
    Write-Host "Logs: $logsPath"
    Write-Host ""
    Write-Info "Comandos uteis:"
    Write-Host "  Parar:     $NssmPath stop $ServiceName"
    Write-Host "  Iniciar:   $NssmPath start $ServiceName"
    Write-Host "  Reiniciar: $NssmPath restart $ServiceName"
    Write-Host "  Status:    $NssmPath status $ServiceName"
    Write-Host "  Editar:    $NssmPath edit $ServiceName"
    Write-Host "  Remover:   $NssmPath remove $ServiceName confirm"
    Write-Host ""
} else {
    Write-Err "AVISO: Servico instalado mas pode nao ter iniciado corretamente."
    Write-Info "Verifique os logs em: $logsPath"
    Write-Info "Ou execute: $NssmPath status $ServiceName"
}