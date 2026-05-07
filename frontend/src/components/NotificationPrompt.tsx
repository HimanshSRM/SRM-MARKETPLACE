'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db, messaging } from '@/lib/firebase';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { getToken } from 'firebase/messaging';

export default function NotificationPrompt() {
  const { profile } = useAuth();
  const [showPrompt, setShowPrompt] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Only run in browser, and only if user is logged in (not a guest)
    if (typeof window === 'undefined' || !profile || profile?.role === 'guest') return;

    // If they haven't made a decision yet, show the prompt after a 3-second delay so it's not aggressive
    if ('Notification' in window && Notification.permission === 'default') {
      const timer = setTimeout(() => setShowPrompt(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [profile]);

  const handleEnable = async () => {
    // 🚨 SAFETY CHECK: Ensure we actually have a user ID before proceeding!
    if (!profile?.uid) return;

    setIsProcessing(true);
    try {
      // 1. Trigger the actual browser popup
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted') {
        const msg = await messaging();
        if (!msg) throw new Error("Messaging not supported");

        // 2. Generate the unique device token using your VAPID key
        const token = await getToken(msg, {
          vapidKey: process.env.NEXT_PUBLIC_VAPID_KEY
        });

        if (token) {
          // 3. Save it to Firestore (Safe to use profile.uid here now!)
          const userRef = doc(db, 'users', profile.uid);
          await updateDoc(userRef, {
            fcmTokens: arrayUnion(token)
          });
          console.log("Push notifications enabled!");
        }
      }
    } catch (error) {
      console.error("Failed to enable notifications:", error);
    } finally {
      setShowPrompt(false);
      setIsProcessing(false);
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-8 sm:bottom-8 sm:w-96 bg-white p-5 rounded-2xl shadow-2xl border border-gray-100 z-50 animate-fade-in-up">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center flex-shrink-0 text-xl">
          🔔
        </div>
        <div>
          <h3 className="font-bold text-gray-900">Never miss a deal!</h3>
          <p className="text-xs text-gray-500 mt-1 mb-4 leading-relaxed">
            Enable notifications to instantly know when someone accepts your bid, replies to your chat, or when your Cart Pool arrives.
          </p>
          <div className="flex gap-2">
            <button 
              onClick={() => setShowPrompt(false)}
              disabled={isProcessing}
              className="px-4 py-2 bg-gray-100 text-gray-600 text-xs font-bold rounded-xl hover:bg-gray-200 transition"
            >
              Maybe Later
            </button>
            <button 
              onClick={handleEnable}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
            >
              {isProcessing ? 'Enabling...' : 'Enable Alerts'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}