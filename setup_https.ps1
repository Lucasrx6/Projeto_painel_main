# ============================================================
# setup_https.ps1 - Configuracao HTTPS para Painel HAC
# Execute UMA VEZ como Administrador no servidor
# Proximas atualizacoes: git pull + nginx -s reload
# ============================================================

param(
    [string]$NginxDir = "C:\nginx",
    [int]$CertDays    = 3650
)

$SslDir    = "$NginxDir\ssl"
$ConfDir   = "$NginxDir\conf"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=== Configurando HTTPS para Painel HAC ===" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------
# 1. Diretorio SSL
# ------------------------------------------------------------
if (-not (Test-Path $SslDir)) {
    New-Item -ItemType Directory -Path $SslDir | Out-Null
}
Write-Host "[1/5] Diretorio SSL: $SslDir" -ForegroundColor Green

# ------------------------------------------------------------
# 2. Localizar OpenSSL
# ------------------------------------------------------------
$OpenSSL = $null
$candidates = @(
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files (x86)\Git\usr\bin\openssl.exe",
    "C:\Windows\System32\openssl.exe",
    "openssl"
)
foreach ($c in $candidates) {
    try {
        $v = & $c version 2>&1
        if ($v -match "OpenSSL") { $OpenSSL = $c; break }
    } catch {}
}
if (-not $OpenSSL) {
    Write-Host "[ERRO] OpenSSL nao encontrado. Ele vem junto com o Git for Windows - verifique a instalacao." -ForegroundColor Red
    exit 1
}
Write-Host "[2/5] OpenSSL: $OpenSSL" -ForegroundColor Green

# ------------------------------------------------------------
# 3. Detectar IP do servidor
# ------------------------------------------------------------
$ServerIP = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -ne "127.0.0.1" } |
    Sort-Object PrefixLength -Descending |
    Select-Object -First 1).IPAddress

if (-not $ServerIP) { $ServerIP = "127.0.0.1" }
Write-Host "[3/5] IP detectado: $ServerIP" -ForegroundColor Green

# ------------------------------------------------------------
# 4. Gerar certificado autoassinado (valido 10 anos)
#    Inclui o IP como Subject Alternative Name (SAN)
#    para browsers modernos aceitarem sem erro de certificado
# ------------------------------------------------------------
$TempConf = "$env:TEMP\openssl_painel.cnf"
@"
[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
x509_extensions    = v3_req

[dn]
CN = Painel HAC

[v3_req]
subjectAltName   = IP:$ServerIP,IP:127.0.0.1
keyUsage         = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
"@ | Set-Content -Encoding ascii $TempConf

# Roda via cmd /c para evitar que PS 5.1 trate stderr do OpenSSL como erro
$opensslCmd = "`"$OpenSSL`" req -x509 -nodes -days $CertDays -newkey rsa:2048 -keyout `"$SslDir\painel.key`" -out `"$SslDir\painel.crt`" -config `"$TempConf`" 2>nul"
cmd /c $opensslCmd

if (-not (Test-Path "$SslDir\painel.crt")) {
    Write-Host "[ERRO] Falha ao gerar certificado SSL." -ForegroundColor Red
    exit 1
}
Write-Host "[4/5] Certificado gerado (valido $CertDays dias): $SslDir\painel.crt" -ForegroundColor Green

# ------------------------------------------------------------
# 5. Copiar configuracoes do nginx
# ------------------------------------------------------------

# Backup do nginx.conf original (so na primeira vez)
if (-not (Test-Path "$ConfDir\nginx.conf.original")) {
    Copy-Item "$ConfDir\nginx.conf" "$ConfDir\nginx.conf.original" -Force
    Write-Host "    Backup do nginx.conf original salvo em: $ConfDir\nginx.conf.original"
}

Copy-Item "$ScriptDir\nginx\nginx.conf" "$ConfDir\nginx.conf"  -Force
Copy-Item "$ScriptDir\nginx\painel.conf" "$ConfDir\painel.conf" -Force
Write-Host "[5/5] Configuracoes nginx copiadas para: $ConfDir" -ForegroundColor Green

# ------------------------------------------------------------
# Testar config e recarregar nginx
# ------------------------------------------------------------
$NginxExe = "$NginxDir\nginx.exe"
$test = & $NginxExe -p $NginxDir -t 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERRO] Configuracao do nginx invalida:" -ForegroundColor Red
    Write-Host $test
    exit 1
}

# Nginx pode estar parado - tenta reload, se falhar tenta start
& $NginxExe -p $NginxDir -s reload 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    & $NginxExe -p $NginxDir 2>&1 | Out-Null
}

# ------------------------------------------------------------
# Resumo final
# ------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " HTTPS configurado com sucesso!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Acesse: https://$ServerIP" -ForegroundColor Yellow
Write-Host ""
Write-Host " O browser vai avisar que o certificado nao e" -ForegroundColor Gray
Write-Host " confiavel (autoassinado). Clique em 'Avancado'" -ForegroundColor Gray
Write-Host " e depois 'Continuar assim mesmo'." -ForegroundColor Gray
Write-Host ""
Write-Host " Para eliminar o aviso em todos os PCs da rede:" -ForegroundColor Gray
Write-Host " distribua $SslDir\painel.crt" -ForegroundColor Gray
Write-Host " via GPO como Autoridade Certificadora Raiz Confiavel." -ForegroundColor Gray
Write-Host ""
Write-Host " Proximas atualizacoes do sistema:" -ForegroundColor Gray
Write-Host "   git pull" -ForegroundColor White
Write-Host "   C:\nginx\nginx.exe -s reload   (se mudou nginx/painel.conf)" -ForegroundColor White
Write-Host "   reiniciar o Gunicorn            (se mudou codigo Python)" -ForegroundColor White
Write-Host ""
