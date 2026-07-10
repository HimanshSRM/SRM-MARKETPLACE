'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getInbox } from '@/lib/api';
import { auth, messaging, db } from '@/lib/firebase'; 
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
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

  // 2. FCM PUSH ALERTS & GLOBAL CART POOL BROADCAST
  useEffect(() => {
    let unsubscribeFCM: any;
    let unsubscribePools: any;

    const setupListeners = async () => {
      try {
        // --- A. THE FIX: Explicitly Register the Service Worker first ---
        if ('serviceWorker' in navigator) {
          try {
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
              scope: '/', // Ensures the SW controls the entire app
            });
            console.log('Service Worker successfully registered with scope:', registration.scope);
            
            // Pass the registration to the messaging object so Firebase knows about it
            const msg = await messaging();
            if (msg) {
              unsubscribeFCM = onMessage(msg, (payload) => {
                const targetUrl = payload.data?.url || '/inbox';
                const currentPath = window.location.pathname;

                // Suppress toast if they are already in the chat room they are being alerted about
                if (currentPath === targetUrl) return; 

                setUnreadCount(prev => prev + 1);

                // Clickable In-App Chat Toast
                toast.custom((t) => (
                  <div 
                    onClick={() => { toast.dismiss(t.id); router.push(targetUrl); }} 
                    className="cursor-pointer bg-white p-4 rounded-xl shadow-lg border-l-4 border-blue-500 flex items-start gap-3 hover:bg-gray-50 transition"
                  >
                    <div className="text-2xl">💬</div>
                    <div>
                      <p className="font-bold text-sm text-gray-900 mb-1">{payload.notification?.title || 'New Alert'}</p>
                      <p className="text-xs text-gray-600 line-clamp-2">{payload.notification?.body}</p>
                    </div>
                  </div>
                ), { duration: 5000, position: 'top-right' });
              });
            }
          } catch (err) {
            console.error('Service Worker registration failed:', err);
          }
        }

        // --- B. The "Uber Style" Global Cart Pool Broadcast ---
        if (profile && profile.role !== 'guest') {
          const poolsQuery = query(
            collection(db, 'group_orders'),
            where('status', '==', 'open'),
            orderBy('created_at', 'desc'),
            limit(1) 
          );

          let isInitialLoad = true;

          unsubscribePools = onSnapshot(poolsQuery, (snapshot) => {
            if (isInitialLoad) {
              isInitialLoad = false; 
              return;
            }

            snapshot.docChanges().forEach((change) => {
              if (change.type === 'added') {
                const newPool = change.doc.data();
                
                // Don't show the broadcast to the person who just created it!
                if (newPool.host_id !== profile.uid) {
                  // Clickable Pool Broadcast that forces the homepage to open the right tab!
                  toast.custom((t) => (
                    <div 
                      onClick={() => { 
                        toast.dismiss(t.id); 
                        if (typeof window !== 'undefined') {
                          localStorage.setItem('homeFeedTab', 'pools'); // Forces the home page state
                        }
                        router.push('/'); 
                      }} 
                      className="cursor-pointer bg-white p-4 rounded-xl shadow-2xl border-l-4 border-purple-500 flex items-start gap-3 animate-fade-in-up hover:bg-purple-50 transition"
                    >
                      <div className="text-2xl">🛒</div>
                      <div>
                        <p className="font-bold text-sm text-gray-900 mb-1">New {newPool.app_name} Pool!</p>
                        <p className="text-xs text-gray-600">
                          <span className="font-bold">{newPool.host_name}</span> just started an order to {newPool.pickup_location}.
                        </p>
                        <p className="text-[10px] text-purple-600 font-bold mt-1.5 uppercase tracking-wider">Click to view feed →</p>
                      </div>
                    </div>
                  ), { duration: 6000, position: 'top-center' }); 
                }
              }
            });
          });
        }

      } catch (error) {
        console.warn("Listeners failed to setup.", error);
      }
    };

    setupListeners();

    return () => {
      if (unsubscribeFCM) unsubscribeFCM();
      if (unsubscribePools) unsubscribePools();
    };
  }, [router, profile]);

  return (
    <NotificationContext.Provider value={{ unreadCount }}>
      {children}
      <Toaster />
    </NotificationContext.Provider>
  );
};