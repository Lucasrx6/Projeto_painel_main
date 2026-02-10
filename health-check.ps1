# ========================================
# Health Check - Painel Hospitalar
# Hospital Anchieta - Ceilandia
# ========================================
# Verifica se o servico esta respondendo
# e reinicia automaticamente se necessario
# ========================================

param(
    [string]$Url = "http://localhost:5000/",
    [string]$ServiceName = "PainelHospitalar",
    [string]$LogFile = "C:\Projeto_Painel_Main\logs\health-check.log",
    [int]$TimeoutSec = 10
)

function Write-Log {
    param($Message, $Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    
    # Escreve no console
    switch ($Level) {
        "OK"    { Write-Host $logMessage -ForegroundColor Green }
        "WARN"  { Write-Host $logMessage -ForegroundColor Yellow }
        "ERROR" { Write-Host $logMessage -ForegroundColor Red }
        default { Write-Host $logMessage }
    }
    
    # Escreve no arquivo de log
    Add-Content -Path $LogFile -Value $logMessage -ErrorAction SilentlyContinue
}

try {
    # Tenta acessar a URL
    $response = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
    
    if ($response.StatusCode -eq 200) {
        Write-Log "Servico OK - Status 200" "OK"
        exit 0
    } else {
        throw "Status code inesperado: $($response.StatusCode)"
    }
}
catch {
    Write-Log "Servico NAO respondeu: $($_.Exception.Message)" "ERROR"
    
    # Verifica status do servico Windows
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    
    if (-not $service) {
        Write-Log "Servico '$ServiceName' nao encontrado no Windows" "ERROR"
        exit 1
    }
    
    Write-Log "Status do servico Windows: $($service.Status)" "WARN"
    
    # Reinicia o servico
    Write-Log "Reiniciando servico..." "WARN"
    
    try {
        Restart-Service -Name $ServiceName -Force -ErrorAction Stop
        Start-Sleep -Seconds 5
        
        $service = Get-Service -Name $ServiceName
        if ($service.Status -eq "Running") {
            Write-Log "Servico reiniciado com sucesso!" "OK"
        } else {
            Write-Log "Servico nao iniciou corretamente. Status: $($service.Status)" "ERROR"
        }
    }
    catch {
        Write-Log "Erro ao reiniciar servico: $($_.Exception.Message)" "ERROR"
    }
    
    exit 1
}