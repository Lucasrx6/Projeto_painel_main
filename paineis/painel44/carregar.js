(function () {
    'use strict';

    function carregarCatalogo() {
        var DOM    = window.P44.DOM;
        var CONFIG = window.P44.CONFIG;

        fetch(CONFIG.apiBase + '/catalogo', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DOM.loading.style.display = 'none';
                if (!data.success) { window.P44.mostrarVazio(); return; }

                var temSubsistemas = data.subsistemas && data.subsistemas.length > 0;
                var temServicos    = data.servicos    && data.servicos.length    > 0;

                if (!temSubsistemas && !temServicos) { window.P44.mostrarVazio(); return; }

                if (temSubsistemas) {
                    window.P44.renderSubsistemas(data.subsistemas);
                    DOM.secaoSubsistemas.style.display = 'block';
                }

                if (temServicos) {
                    window.P44.renderServicos(data.servicos);
                    DOM.secaoServicos.style.display = 'block';
                }
            })
            .catch(function (e) {
                DOM.loading.style.display = 'none';
                console.error('catalogo', e);
                window.P44.mostrarVazio();
            });
    }

    window.P44.carregarCatalogo = carregarCatalogo;

})();
