# Parar Flask + Worker IA - Windows

$PROJECT_DIR = "C:\Projeto_Painel_Main"

Write-Host "Parando servicos..." -ForegroundColor Red

# Parar Flask
if (Test-Path "$PROJECT_DIR\pids\flask.pid") {
    $flaskJobId = Get-Content "$PROJECT_DIR\pids\flask.pid"

    $job = Get-Job -Id $flaskJobId -ErrorAction SilentlyContinue
    if ($job) {
        Write-Host "Parando Flask (Job ID: $flaskJobId)..." -ForegroundColor Yellow
        Stop-Job -Id $flaskJobId
        Remove-Job -Id $flaskJobId -Force
    }

    Remove-Item "$PROJECT_DIR\pids\flask.pid" -ErrorAction SilentlyContinue
}

# Parar Worker
if (Test-Path "$PROJECT_DIR\pids\worker.pid") {
    $workerJobId = Get-Content "$PROJECT_DIR\pids\worker.pid"

    $job = Get-Job -Id $workerJobId -ErrorAction SilentlyContinue
    if ($job) {
        Write-Host "Parando Worker (Job ID: $workerJobId)..." -ForegroundColor Yellow
        Stop-Job -Id $workerJobId
        Remove-Job -Id $workerJobId -Force
    }

    Remove-Item "$PROJECT_DIR\pids\worker.pid" -ErrorAction SilentlyContinue
}

Write-Host "Servicos parados!" -ForegroundColor Green