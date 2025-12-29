# Iniciar Flask + Worker IA - Windows
# Ajuste a linha 4 com o caminho do seu projeto

$PROJECT_DIR = "C:\Projeto_Painel_Main"
$VENV_PYTHON = "$PROJECT_DIR\.venv\Scripts\python.exe"
$FLASK_APP = "$PROJECT_DIR\app.py"
$WORKER_APP = "$PROJECT_DIR\backend\ia_risk_analyzer_groq.py"

Write-Host "Iniciando sistema..." -ForegroundColor Cyan

# Criar diretorios
New-Item -ItemType Directory -Path "$PROJECT_DIR\logs" -Force | Out-Null
New-Item -ItemType Directory -Path "$PROJECT_DIR\pids" -Force | Out-Null

# Verificar arquivos
if (-not (Test-Path $VENV_PYTHON)) {
    Write-Host "ERRO: Python nao encontrado" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $FLASK_APP)) {
    Write-Host "ERRO: app.py nao encontrado" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $WORKER_APP)) {
    Write-Host "ERRO: worker nao encontrado" -ForegroundColor Red
    exit 1
}

# Iniciar Flask
Write-Host "Iniciando Flask..." -ForegroundColor Green

$flaskJob = Start-Job -ScriptBlock {
    param($python, $app, $dir)
    Set-Location $dir
    & $python $app 2>&1 | Tee-Object -FilePath "logs\flask.log"
} -ArgumentList $VENV_PYTHON, $FLASK_APP, $PROJECT_DIR

Write-Host "Flask iniciado (Job ID: $($flaskJob.Id))" -ForegroundColor Green
$flaskJob.Id | Out-File -FilePath "$PROJECT_DIR\pids\flask.pid"

Start-Sleep -Seconds 3

# Iniciar Worker
Write-Host "Iniciando Worker IA..." -ForegroundColor Green

$workerJob = Start-Job -ScriptBlock {
    param($python, $app, $dir)
    Set-Location $dir
    & $python $app 2>&1 | Tee-Object -FilePath "logs\worker_ia.log"
} -ArgumentList $VENV_PYTHON, $WORKER_APP, $PROJECT_DIR

Write-Host "Worker iniciado (Job ID: $($workerJob.Id))" -ForegroundColor Green
$workerJob.Id | Out-File -FilePath "$PROJECT_DIR\pids\worker.pid"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "SISTEMA INICIADO!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Flask Job ID: $($flaskJob.Id)" -ForegroundColor White
Write-Host "Worker Job ID: $($workerJob.Id)" -ForegroundColor White
Write-Host ""
Write-Host "Logs em tempo real:" -ForegroundColor Cyan
Write-Host "  Get-Content logs\flask.log -Wait" -ForegroundColor Gray
Write-Host "  Get-Content logs\worker_ia.log -Wait" -ForegroundColor Gray
Write-Host ""
Write-Host "Para parar: .\stop_all_limpo.ps1" -ForegroundColor Yellow
Write-Host "Ou pressione Ctrl+C" -ForegroundColor Yellow
Write-Host ""

# Trap para parar jobs ao pressionar Ctrl+C
$null = Register-EngineEvent PowerShell.Exiting -Action {
    Stop-Job -Id $flaskJob.Id, $workerJob.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $flaskJob.Id, $workerJob.Id -Force -ErrorAction SilentlyContinue
}

# Aguardar indefinidamente
try {
    while ($true) {
        # Verifica se jobs ainda estao rodando
        $flaskState = (Get-Job -Id $flaskJob.Id).State
        $workerState = (Get-Job -Id $workerJob.Id).State

        if ($flaskState -ne "Running") {
            Write-Host ""
            Write-Host "ALERTA: Flask parou!" -ForegroundColor Red
            Receive-Job -Id $flaskJob.Id
        }

        if ($workerState -ne "Running") {
            Write-Host ""
            Write-Host "ALERTA: Worker parou!" -ForegroundColor Red
            Receive-Job -Id $workerJob.Id
        }

        Start-Sleep -Seconds 5
    }
} catch {
    Write-Host ""
    Write-Host "Parando servicos..." -ForegroundColor Yellow
    Stop-Job -Id $flaskJob.Id, $workerJob.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $flaskJob.Id, $workerJob.Id -Force -ErrorAction SilentlyContinue
}


