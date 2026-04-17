/* ==============================================================================
   DASHBOARD V2 - JAVASCRIPT
   Sistema de Paineis - Hospital Anchieta Ceilandia
   ============================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Controle da Sidebar
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggle-sidebar');

    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // 2. Tema Escuro
    const btnTema = document.getElementById('btn-tema');

    // Verifica tema salvo
    if (localStorage.getItem('tema_sistema') === 'azul') {
        document.documentElement.classList.add('tema-azul');
        btnTema.innerHTML = '<i class="fa-solid fa-sun"></i>';
    }

    btnTema.addEventListener('click', () => {
        const isAzul = document.documentElement.classList.contains('tema-azul');
        if (isAzul) {
            document.documentElement.classList.remove('tema-azul');
            localStorage.setItem('tema_sistema', 'padrao');
            btnTema.innerHTML = '<i class="fa-solid fa-moon"></i>';
        } else {
            document.documentElement.classList.add('tema-azul');
            localStorage.setItem('tema_sistema', 'azul');
            btnTema.innerHTML = '<i class="fa-solid fa-sun"></i>';
        }
    });

    // Estado de Permissões
    let isAdmin = false;
    let userPermissions = [];

    // 3. Filtragem e Busca
    const navItems = document.querySelectorAll('.nav-item');
    const painelCards = document.querySelectorAll('.painel-card');
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search');
    const noResults = document.getElementById('no-results');
    const currentCategoryTitle = document.getElementById('current-category-title');
    const panelsCount = document.getElementById('panels-count');

    let currentFilter = 'all';

    function filterPanels() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        let visibleCount = 0;

        // Track visible panels per category to hide empty categories
        const categoryCounts = {};
        navItems.forEach(item => {
            if (item.dataset.filter !== 'all') {
                categoryCounts[item.dataset.filter] = 0;
            }
        });

        painelCards.forEach(card => {
            const painelId = card.dataset.painel;
            const category = card.dataset.category;
            const title = card.querySelector('h3').textContent.toLowerCase();
            const desc = card.querySelector('p').textContent.toLowerCase();

            // Permissão check
            const hasPermission = isAdmin || userPermissions.includes(painelId);

            if (hasPermission) {
                // If it has permission, count it for the category
                if (categoryCounts[category] !== undefined) {
                    categoryCounts[category]++;
                }

                const matchesCategory = currentFilter === 'all' || category === currentFilter;
                const matchesSearch = title.includes(searchTerm) || desc.includes(searchTerm);

                if (matchesCategory && matchesSearch) {
                    card.style.display = 'flex';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            } else {
                card.style.display = 'none';
            }
        });

        // Hide empty categories in the sidebar
        navItems.forEach(item => {
            const filter = item.dataset.filter;
            if (filter !== 'all') {
                if (categoryCounts[filter] === 0) {
                    item.parentElement.style.display = 'none';
                } else {
                    item.parentElement.style.display = 'block';
                }
            }
        });

        // Atualiza UI
        panelsCount.textContent = `${visibleCount} painéis`;

        if (visibleCount === 0) {
            noResults.style.display = 'block';
        } else {
            noResults.style.display = 'none';
        }

        // Show/hide clear button
        if (searchTerm.length > 0) {
            clearSearchBtn.style.display = 'flex';
        } else {
            clearSearchBtn.style.display = 'none';
        }
    }

    // Clique nas categorias
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            currentFilter = item.dataset.filter;
            currentCategoryTitle.textContent = item.querySelector('span').textContent;
            filterPanels();
        });
    });

    // Digitação na busca
    searchInput.addEventListener('input', filterPanels);

    // Botão limpar busca
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        filterPanels();
        searchInput.focus();
    });

    // 4. Carregar Info do Usuário e Permissões
    fetch('/api/verificar-sessao')
        .then(res => res.json())
        .then(data => {
            if (!data.autenticado) {
                window.location.href = '/login.html';
                return;
            }

            document.getElementById('usuario-nome').textContent = data.usuario;
            isAdmin = data.is_admin || false;

            if (isAdmin) {
                document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
            }

            // Buscar permissões
            return fetch('/api/minhas-permissoes');
        })
        .then(res => {
            if (res) return res.json();
        })
        .then(data => {
            if (data && data.success) {
                userPermissions = data.permissoes || [];
                if (data.is_admin) isAdmin = true;
            }
            filterPanels();
        })
        .catch(err => {
            console.error("Erro ao verificar sessão/permissões:", err);
            filterPanels();
        });

    // Navegação para o painel
    painelCards.forEach(card => {
        card.addEventListener('click', () => {
            const painelId = card.dataset.painel;
            if (isAdmin || userPermissions.includes(painelId)) {
                window.location.href = `/painel/${painelId}`;
            }
        });
    });

    // Navegação Admin
    const btnGestao = document.getElementById('btn-gestao-usuarios');
    if (btnGestao) {
        btnGestao.addEventListener('click', () => {
            window.location.href = '/admin/usuarios';
        });
    }

    const btnAdmin = document.getElementById('btn-admin');
    if (btnAdmin) {
        btnAdmin.addEventListener('click', () => {
            window.location.href = '/admin/usuarios';
        });
    }

    // Hamburger mobile
    const btnHamburger = document.getElementById('btn-hamburger');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    function openSidebarMobile() {
        sidebar.classList.add('mobile-open');
        sidebarOverlay.classList.add('active');
    }
    function closeSidebarMobile() {
        sidebar.classList.remove('mobile-open');
        sidebarOverlay.classList.remove('active');
    }

    if (btnHamburger) {
        btnHamburger.addEventListener('click', openSidebarMobile);
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebarMobile);
    }
    // Close on nav item click (mobile UX)
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) closeSidebarMobile();
        });
    });

    // 5. Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        fetch('/api/logout', { method: 'POST' })
            .then(() => window.location.href = '/login.html')
            .catch(() => window.location.href = '/login.html');
    });
});
