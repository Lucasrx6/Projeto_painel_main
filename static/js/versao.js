var SISTEMA_NOME = 'Central de Informações';
var SISTEMA_VERSAO = '1.1.4';

document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('sistema-versao-footer');
    if (el) el.textContent = SISTEMA_NOME + ' V ' + SISTEMA_VERSAO;
});
