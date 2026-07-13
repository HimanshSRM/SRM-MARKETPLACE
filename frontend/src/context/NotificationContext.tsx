'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getInbox } from '@/lib/api';
import { auth, messaging } from '@/lib/firebase'; 
import { onMessage } from 'firebase/messaging';
import toast from 'react-hot-toast';
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

  // 1. INBOX UNREAD COUNT LOAD
  useEffect(() => {
    if (isAuthLoading || !profile || profile.role === 'guest') {
      setUnreadCount(0);
      return;
    }

    const fetchInitialUnread = async () => {
      try {
        if (!auth.currentUser) return;
        const inbox = await getInbox();
        const allRooms = [...(inbox.buying || []), ...(inbox.selling || []), ...(inbox.support || []), ...(inbox.pools || [])];
        
        const currentUnread = allRooms.reduce((acc, room) => {
          return (room.last_sender_id && room.last_sender_id !== profile.uid) ? acc + 1 : acc;
        }, 0);

        setUnreadCount(currentUnread);
      } catch (error) {
        console.warn("Failed to fetch initial unread count:", error);
      }
    };

    fetchInitialUnread();
  }, [profile, isAuthLoading]);

  // 2. FCM PUSH ALERTS & FCM TOPIC BROADCASTS
  useEffect(() => {
    let unsubscribeFCM: () => void;

    const setupListeners = async () => {
      try {
        if ('serviceWorker' in navigator) {
          try {
            await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
            
            const msg = await messaging();
            if (msg) {
              unsubscribeFCM = onMessage(msg, (payload) => {
                
                const data = payload.data || {};
                const type = data.type;
                const targetUrl = data.url || '/inbox';
                const title = data.title || 'New Alert';
                const body = data.body || '';

                // 🛒 THE FIX: Catch Global Cart Pool Broadcasts directly from FCM (0 Database Reads!)
                if (type === 'new_pool') {
                  toast.custom((t) => (
                    <div 
                      onClick={() => { 
                        toast.dismiss(t.id); 
                        localStorage.setItem('homeFeedTab', 'pools'); 
                        router.push('/'); 
                      }} 
                      className="cursor-pointer bg-white p-4 rounded-xl shadow-2xl border-l-4 border-purple-500 flex items-start gap-3 animate-fade-in-up hover:bg-purple-50 transition"
                    >
                      <div className="text-2xl">🛒</div>
                      <div>
                        <p className="font-bold text-sm text-gray-900 mb-1">{title}</p>
                        <p className="text-xs text-gray-600">{body}</p>
                      </div>
                    </div>
                  ), { duration: 6000, position: 'top-center' }); 
                  return; // Stop execution here so it doesn't trigger a chat notification
                }
                
                // 💬 STANDARD DIRECT CHAT NOTIFICATIONS
                // OPTIMIZATION: Prevent popup if already looking at the target chat room
                if (window.location.pathname === targetUrl) return; 

                setUnreadCount(prev => prev + 1);

                toast.custom((t) => (
                  <div 
                    onClick={() => { toast.dismiss(t.id); router.push(targetUrl); }} 
                    className="cursor-pointer bg-white p-4 rounded-xl shadow-lg border-l-4 border-blue-500 flex items-start gap-3 hover:bg-gray-50 transition animate-fade-in-up"
                  >
                    <div className="text-2xl">💬</div>
                    <div>
                      <p className="font-bold text-sm text-gray-900 mb-1">{title}</p>
                      <p className="text-xs text-gray-600 line-clamp-2">{body}</p>
                    </div>
                  </div>
                ), { duration: 5000, position: 'top-right' });
              });
            }
          } catch (err) {
            console.error('SW Registration Failed:', err);
          }
        }

      } catch (error) {
        console.warn("Listeners failed to setup.", error);
      }
    };

    setupListeners();

    return () => {
      if (unsubscribeFCM) unsubscribeFCM();
    };
  }, [router, profile]);

  return (
    <NotificationContext.Provider value={{ unreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
};