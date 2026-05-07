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

// This runs in the background when the app is closed
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico', // Make sure you have a favicon or logo here!
    badge: '/favicon.ico',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});