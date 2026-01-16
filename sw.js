// Service Worker para PWA - Sistema de Painéis Hospitalares
// Versão: 1.0.0

const CACHE_NAME = 'paineis-hospitalares-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Arquivos essenciais para cache
const CACHE_ASSETS = [
  '/',
  '/offline.html',
  '/static/img/logo.png',
  '/static/img/favicon.png'
];

// ========================================
// INSTALAÇÃO DO SERVICE WORKER
// ========================================
self.addEventListener('install', (event) => {
  console.log('[SW] 🔧 Instalando Service Worker...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] 📦 Cache aberto, adicionando arquivos essenciais...');
        return cache.addAll(CACHE_ASSETS);
      })
      .then(() => {
        console.log('[SW] ✅ Arquivos em cache com sucesso');
        return self.skipWaiting(); // Ativa imediatamente
      })
      .catch((error) => {
        console.error('[SW] ❌ Erro ao cachear arquivos:', error);
      })
  );
});

// ========================================
// ATIVAÇÃO DO SERVICE WORKER
// ========================================
self.addEventListener('activate', (event) => {
  console.log('[SW] 🚀 Ativando Service Worker...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Remove caches antigos
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] 🗑️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] ✅ Service Worker ativado');
      return self.clients.claim(); // Assume controle imediatamente
    })
  );
});

// ========================================
// INTERCEPTAÇÃO DE REQUISIÇÕES (FETCH)
// ========================================
self.addEventListener('fetch', (event) => {
  // Ignora requisições não-GET
  if (event.request.method !== 'GET') return;

  // ========================================
  // REQUISIÇÕES DE API: Sempre busca na rede
  // ========================================
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // Se API falhar, retorna erro JSON
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Sem conexão com o servidor'
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 503
            }
          );
        })
    );
    return;
  }

  // ========================================
  // OUTROS RECURSOS: Network First com Cache Fallback
  // ========================================
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Se a resposta for válida, clona e salva no cache
        if (response && response.status === 200) {
          const responseToCache = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }

        return response;
      })
      .catch(() => {
        // Se a rede falhar, tenta buscar do cache
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              console.log('[SW] 📦 Servindo do cache:', event.request.url);
              return cachedResponse;
            }

            // Se não estiver em cache e for navegação, mostra página offline
            if (event.request.mode === 'navigate') {
              return caches.match(OFFLINE_URL);
            }

            // Para outros recursos, retorna erro
            return new Response('Recurso não disponível offline', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// ========================================
// MENSAGENS DO CLIENTE
// ========================================
self.addEventListener('message', (event) => {
  // Permite pular espera e ativar imediatamente
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Permite limpar cache manualmente
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});

console.log('[SW] 📱 Service Worker carregado - Painéis Hospitalares v1.0.0');