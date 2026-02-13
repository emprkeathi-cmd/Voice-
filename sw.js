/**
 * VoiceFlow Minimal Service Worker
 */

const CACHE_NAME = 'vf-v14';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass-through handler
  return;
});