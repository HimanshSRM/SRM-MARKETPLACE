'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { auth, db, messaging } from '@/lib/firebase'; 
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';

export default function NotificationPrompt() {
  const { profile } = useAuth();
  
  const [permissionState, setPermissionState] = useState<string>('verifying');
  const [showPrompt, setShowPrompt] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Ref prevents double-fetching the token during React StrictMode renders
  const hasVerified = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !profile || profile.role === 'guest') return;

    if ('Notification' in window) {
      setPermissionState(Notification.permission);
      
      if (Notification.permission === 'default') {
        const timer = setTimeout(() => setShowPrompt(true), 3000);
        return () => clearTimeout(timer);
      }
      
      // 🚨 SELF-HEALING: Silently verify token if browser says it is granted
      if (Notification.permission === 'granted' && !hasVerified.current) {
        hasVerified.current = true;
        verifyAndHealToken();
      }
    }
  }, [profile]);

  const verifyAndHealToken = async () => {
    if (!profile?.uid) return;

    try {
      const msg = await messaging();
      if (!msg) return;

      // 🚨 THE FIX: Wait for the SW to be active, then bind it to the token request
      await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const readyRegistration = await navigator.serviceWorker.ready;

      // SECURITY: Ensure NEXT_PUBLIC_VAPID_KEY is set in your .env.local file
      const currentToken = await getToken(msg, {
        vapidKey: process.env.NEXT_PUBLIC_VAPID_KEY,
        serviceWorkerRegistration: readyRegistration
      });

      if (currentToken) {
        const userRef = doc(db, 'users', profile.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const savedTokens = userData.fcmTokens || [];
          
          if (!savedTokens.includes(currentToken)) {
            console.log("[Auto-Heal] Missing token injected into database.");
            await updateDoc(userRef, {
              fcmTokens: arrayUnion(currentToken)
            });

            // 🚨 THE FIX: Subscribe the newly healed token to the Global Broadcast Topic
            const idToken = await auth.currentUser?.getIdToken();
            if (idToken) {
              await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/users/notifications/subscribe`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ fcm_token: currentToken })
              }).catch(err => console.warn("Topic auto-heal subscription bypassed.", err));
            }
          }
        }
      }
    } catch (err) {
      console.warn("Silent token verification bypassed.", err);
    }
  };

  const handleEnable = async () => {
    if (!profile?.uid) return;

    setIsProcessing(true);
    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      
      if (permission === 'granted') {
        const msg = await messaging();
        if (!msg) throw new Error("Messaging not supported");

        // 🚨 THE FIX: Wait for the SW to be active, then bind it to the token request
        await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const readyRegistration = await navigator.serviceWorker.ready;

        const token = await getToken(msg, {
          vapidKey: process.env.NEXT_PUBLIC_VAPID_KEY,
          serviceWorkerRegistration: readyRegistration
        });

        if (token) {
          const userRef = doc(db, 'users', profile.uid);
          await updateDoc(userRef, {
            fcmTokens: arrayUnion(token)
          });

          // 🚨 THE FIX: Subscribe the new token to the Global Broadcast Topic
          const idToken = await auth.currentUser?.getIdToken();
          if (idToken) {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/users/notifications/subscribe`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
              },
              body: JSON.stringify({ fcm_token: token })
            }).catch(err => console.warn("Topic subscription bypassed.", err));
          }

          setShowPrompt(false);
        }
      }
    } catch (error) {
      console.error("Failed to enable notifications:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  if (permissionState === 'denied') {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-8 sm:bottom-8 sm:w-96 bg-red-50 p-4 rounded-xl shadow-lg border border-red-100 z-50 animate-fade-in-up flex items-center justify-between">
        <div>
          <h3 className="font-bold text-red-900 text-sm">Notifications Blocked</h3>
          <p className="text-[10px] text-red-700 mt-0.5">Allow them in browser settings to get updates.</p>
        </div>
        <button onClick={() => setPermissionState('hidden')} className="p-1.5 hover:bg-red-100 rounded-lg text-red-400">✕</button>
      </div>
    );
  }

  if (showPrompt && permissionState === 'default') {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-8 sm:bottom-8 sm:w-96 bg-white p-5 rounded-2xl shadow-2xl border border-gray-100 z-50 animate-fade-in-up">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center flex-shrink-0 text-xl">🔔</div>
          <div>
            <h3 className="font-bold text-gray-900">Never miss a deal!</h3>
            <p className="text-xs text-gray-500 mt-1 mb-4 leading-relaxed">
              Enable alerts to know when someone accepts your offer or your Cart Pool arrives.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowPrompt(false)} disabled={isProcessing} className="px-4 py-2 bg-gray-100 text-gray-600 text-xs font-bold rounded-xl hover:bg-gray-200 transition">Maybe Later</button>
              <button onClick={handleEnable} disabled={isProcessing} className="flex-1 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition disabled:opacity-50">
                {isProcessing ? 'Enabling...' : 'Enable Alerts'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}