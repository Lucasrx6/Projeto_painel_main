# ============================================================
# Instalador do Certificado HTTPS - Painel HAC
# ============================================================

# Auto-elevacao: pede permissao de Administrador se necessario
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process PowerShell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

$CertPath = "\\172.16.1.110\Projeto Tasy\rootCA.pem"

Clear-Host
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Instalador de Certificado - Painel HAC  " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Verificar se o arquivo existe no compartilhamento
if (-not (Test-Path $CertPath)) {
    Write-Host " [ERRO] Nao foi possivel encontrar o certificado em:" -ForegroundColor Red
    Write-Host "        $CertPath" -ForegroundColor Red
    Write-Host ""
    Write-Host " Verifique se voce esta conectado a rede do hospital." -ForegroundColor Yellow
    Write-Host ""
    Read-Host " Pressione Enter para fechar"
    exit 1
}

Write-Host " Instalando certificado..." -ForegroundColor Yellow
Write-Host ""

$resultado = certutil -addstore -f "ROOT" $CertPath 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host " [OK] Certificado instalado com sucesso!" -ForegroundColor Green
    Write-Host ""
    Write-Host " Feche e reabra o seu navegador." -ForegroundColor White
    Write-Host " A partir de agora voce pode acessar:" -ForegroundColor White
    Write-Host " https://172.16.1.75  (sem aviso de certificado)" -ForegroundColor Cyan
} else {
    Write-Host " [ERRO] Falha ao instalar o certificado." -ForegroundColor Red
    Write-Host ""
    Write-Host $resultado
}

Write-Host ""
Read-Host " Pressione Enter para fechar"
