'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getInbox } from '@/lib/api';
import { auth, messaging } from '@/lib/firebase'; // 🚨 Added 'messaging' export
import { onMessage } from 'firebase/messaging';
import toast, { Toaster } from 'react-hot-toast';
import { useRouter } from 'next/navigation';

interface NotificationContextType {
  unreadCount: number;
}

const NotificationContext = createContext<NotificationContextType>({ unreadCount: 0 });

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const { profile, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);

  // 1. INITIAL LOAD: Just fetch the unread count ONCE when the app opens
  useEffect(() => {
    if (isAuthLoading || !profile || profile.role === 'guest') {
      setUnreadCount(0);
      return;
    }

    const fetchInitialUnread = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const inbox = await getInbox(token);
        const allRooms = [...(inbox.buying || []), ...(inbox.selling || []), ...(inbox.support || []), ...(inbox.pools || [])];
        
        let currentUnread = 0;
        allRooms.forEach(room => {
          if (room.last_sender_id && room.last_sender_id !== profile?.uid) {
            currentUnread += 1;
          }
        });

        setUnreadCount(currentUnread);
      } catch (error) {
        console.warn("Failed to fetch initial unread count:", error);
      }
    };

    fetchInitialUnread();
  }, [profile, isAuthLoading]);

  // 2. TRUE REAL-TIME FOREGROUND ALERTS: Replaces the 15-second polling!
  useEffect(() => {
    let unsubscribe: any;

    const setupForegroundListener = async () => {
      try {
        // Wait for the messaging instance to safely initialize
        const msg = await messaging();
        if (!msg) return;

        // Firebase WebSockets: Listens for pushes ONLY when the app is actively open
        unsubscribe = onMessage(msg, (payload) => {
          console.log("Foreground push notification received!", payload);

          // 1. Instantly increase the red notification badge!
          setUnreadCount(prev => prev + 1);

          // 2. Show the beautiful in-app Toast UI
          toast(
            (t) => (
              <div 
                onClick={() => { 
                  toast.dismiss(t.id); 
                  // If your Python backend sends a 'url' in the data payload, route there. Otherwise, default to inbox.
                  router.push(payload.data?.url || '/inbox'); 
                }} 
                className="cursor-pointer"
              >
                <p className="font-bold text-sm mb-1">
                  {payload.notification?.title || '💬 New Alert'}
                </p>
                <p className="text-xs text-gray-600 line-clamp-2">
                  {payload.notification?.body || 'You have a new message.'}
                </p>
              </div>
            ),
            { duration: 5000, position: 'top-right', style: { borderRadius: '12px', border: '1px solid #e5e7eb' } }
          );
        });

      } catch (error) {
        console.warn("Foreground notification listener failed to setup.", error);
      }
    };

    setupForegroundListener();

    // Clean up the listener if the component unmounts
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [router]);

  return (
    <NotificationContext.Provider value={{ unreadCount }}>
      {children}
      <Toaster /> {/* This renders the actual popups */}
    </NotificationContext.Provider>
  );
};