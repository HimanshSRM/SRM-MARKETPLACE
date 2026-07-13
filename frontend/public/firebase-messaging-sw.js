importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// 🚨 THE FIX: Force the service worker to activate immediately
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

// Public configuration (Safe to be visible to clients)
const firebaseConfig = {
  apiKey: "AIzaSyDRUWONmzZ2fMUmlRF0oSfY5i46Y8rpuoM",
  authDomain: "srm-marketplace-c5035.firebaseapp.com",
  projectId: "srm-marketplace-c5035",
  storageBucket: "srm-marketplace-c5035.firebasestorage.app",
  messagingSenderId: "639527417493",
  appId: "1:639527417493:web:19ec3795b6e4439e438d9c"
};

firebase.initializeApp(firebaseConfig);

// 🚨 OPTIMIZATION: Native Push Event avoids FCM wrapper overhead
self.addEventListener('push', function(event) {
  if (!event.data) return;

  const payload = event.data.json();
  const customData = payload.data || {};
  
  const notificationTitle = customData.title || 'SRM Marketplace';
  const notificationOptions = {
    body: customData.body || 'You have a new update!',
    icon: '/icon.png', 
    badge: '/icon.png',
    data: { url: customData.url || '/inbox' }
  };

  // ROBUSTNESS: Ensure OS waits for paint before sleeping
  event.waitUntil(
    self.registration.showNotification(notificationTitle, notificationOptions)
  );
});

// ROBUSTNESS: Smart routing upon click
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const relativeUrl = event.notification.data?.url || '/inbox';
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Bring existing tab to front if already open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise, open a fresh window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});