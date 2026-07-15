'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getInbox } from '@/lib/api';
import { auth, messaging, db } from '@/lib/firebase';
import { onMessage, getToken } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
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

  // 2. FCM PUSH ALERTS, TOKEN GENERATION, & BROADCASTS
  useEffect(() => {
    let unsubscribeFCM: () => void;

    const setupListeners = async () => {
      try {
        if ('serviceWorker' in navigator) {
          try {
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
            await navigator.serviceWorker.ready;
            const msg = await messaging();
            
            if (msg) {
              if (profile?.uid && profile?.role !== 'guest') {
                try {
                  const permission = await Notification.requestPermission();
                  if (permission === 'granted') {
                    const currentToken = await getToken(msg, {
                      vapidKey: process.env.NEXT_PUBLIC_VAPID_KEY ,
                      serviceWorkerRegistration: registration 
                    });

                    if (currentToken) {
                      const userRef = doc(db, 'users', profile.uid);
                      await updateDoc(userRef, {
                        fcmTokens: arrayUnion(currentToken)
                      }).catch(e => console.warn("Could not save token to DB", e));

                      try {
                        const idToken = await auth.currentUser?.getIdToken();
                        if (!idToken) throw new Error("User not authenticated.");

                        const API_URL = process.env.NEXT_PUBLIC_API_URL;
                        
                        const response = await fetch(`${API_URL}/api/users/subscribe-topic`, { 
                          method: 'POST',
                          headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}` 
                          },
                          body: JSON.stringify({ 
                            token: currentToken, 
                            topic: 'campus_active_pools' 
                          })
                        });
                        
                        if (!response.ok) {
                            throw new Error(`Backend rejected subscription with status: ${response.status}`);
                        }
                      } catch (subErr) {
                        console.error("Failed to subscribe token to topic:", subErr);
                      }
                    }
                  }
                } catch (tokenErr) {
                  console.error("Token generation error:", tokenErr);
                }
              }

              unsubscribeFCM = onMessage(msg, (payload) => {
                const data = payload.data || {};
                const type = data.type;
                const targetUrl = data.url || '/inbox';
                const title = data.title || 'New Alert';
                const body = data.body || '';

                if (type === 'new_pool') {
                  window.dispatchEvent(new CustomEvent('refreshGlobalFeed'));

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
                  return; 
                }

                else if (type === 'flash_deal') {
                  toast.custom((t) => (
                    <div className={`${t.visible ? 'animate-fade-in-up' : 'animate-fade-out'} max-w-sm w-full bg-gradient-to-r from-orange-500 to-yellow-500 shadow-2xl rounded-2xl pointer-events-auto flex ring-1 ring-black ring-opacity-5`}>
                      <div className="flex-1 w-0 p-4">
                        <div className="flex items-start">
                          <div className="flex-shrink-0 pt-0.5 text-2xl">⚡</div>
                          <div className="ml-3 flex-1">
                            <p className="text-sm font-black text-white">{title}</p>
                            <p className="mt-1 text-xs font-bold text-orange-100">{body}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex border-l border-orange-400">
                        <button 
                          onClick={() => { toast.dismiss(t.id); router.push(targetUrl); }}
                          className="w-full border border-transparent rounded-none rounded-r-2xl p-4 flex items-center justify-center text-xs font-black text-white hover:bg-orange-600 transition"
                        >
                          View
                        </button>
                      </div>
                    </div>
                  ), { duration: 6000, position: 'top-center' });
                  return; 
                }
                
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