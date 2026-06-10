var SISTEMA_NOME = 'Central de Informações';
var SISTEMA_VERSAO = '1.1.5';

document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('sistema-versao-footer');
    if (!el) return;
    var texto = SISTEMA_NOME + ' V ' + SISTEMA_VERSAO;
    if (typeof PAINEL_VERSAO !== 'undefined' && PAINEL_VERSAO) {
        texto += ' · Painel v' + PAINEL_VERSAO;
    }
    el.textContent = texto;
});
