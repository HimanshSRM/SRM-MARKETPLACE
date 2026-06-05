importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyDRUWONmzZ2fMUmlRF0oSfY5i46Y8rpuoM",
  authDomain: "srm-marketplace-c5035.firebaseapp.com",
  projectId: "srm-marketplace-c5035",
  storageBucket: "srm-marketplace-c5035.firebasestorage.app",
  messagingSenderId: "639527417493",
  appId: "1:639527417493:web:19ec3795b6e4439e438d9c"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// 1. Wakes up to paint the notification when the app is closed
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon.png', // Make sure you have a favicon or logo here!
    badge: '/icon.png',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 2. 🚨 THE FIX: Handles the actual tap action on the OS lock screen
self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Notification clicked.', event);
  
  // Close the native notification popup
  event.notification.close();

  // Extract the target URL from the payload (default to /inbox if missing)
  const relativeUrl = event.notification.data?.url || '/inbox';

  // 🚨 SMART ROUTING: Convert relative path to an absolute PWA URL so it doesn't break
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Scenario A: The user has the PWA open in the background. Focus it and route them.
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Scenario B: The PWA is completely closed. Launch it directly to the URL.
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});