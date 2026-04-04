'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { useAuth } from './AuthContext';
import { getInbox } from '@/lib/api';
import { auth } from '@/lib/firebase';
import toast, { Toaster } from 'react-hot-toast';
import { useRouter } from 'next/navigation';

interface NotificationContextType {
  unreadCount: number;
}

const NotificationContext = createContext<NotificationContextType>({ unreadCount: 0 });

export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  // 🚨 1. Grab isAuthLoading from our AuthContext
  const { profile, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  
  // Keep track of the newest message timestamp so we don't spam toasts
  const lastNotifiedTime = useRef<number>(Date.now());

  useEffect(() => {
    // 🚨 2. WAIT FOR FIREBASE. Do not start the loop until we know who the user is.
    if (isAuthLoading) return;

    // 🚨 3. If they logged out, reset the count and stop the loop
    if (!profile || profile.role === 'guest') {
      setUnreadCount(0);
      return;
    }

    const checkInbox = async () => {
      try {
        let token;
        
        // Safe Token Fetching to prevent network crashes
        try {
           token = await auth.currentUser?.getIdToken();
        } catch (authError: any) {
           if (authError.code === 'auth/network-request-failed') {
             return; 
           }
           throw authError; 
        }

        if (!token) return;

        const inbox = await getInbox(token);
        
        // Ensure arrays exist before spreading
        const safeBuying = inbox.buying || [];
        const safeSelling = inbox.selling || [];
        const safeSupport = inbox.support || [];
        
        const allRooms = [...safeBuying, ...safeSelling, ...safeSupport];
        
        let currentUnread = 0;
        let newestMessageTime = lastNotifiedTime.current;

        allRooms.forEach(room => {
          // If the last person to send a message wasn't you, it's unread!
          if (room.last_sender_id && room.last_sender_id !== profile.uid) {
            currentUnread += 1;
            
            const roomTime = new Date(room.updated_at || room.created_at).getTime();
            
            // If this message is newer than our last check, trigger a Popup!
            if (roomTime > lastNotifiedTime.current) {
              newestMessageTime = Math.max(newestMessageTime, roomTime);
              
              toast(
                (t) => (
                  <div onClick={() => { toast.dismiss(t.id); router.push(`/chat/${room.id}`); }} className="cursor-pointer">
                    <p className="font-bold text-sm mb-1">
                      {room.is_ticket ? '🛡️ Support Update' : '💬 New Message / Bid'}
                    </p>
                    <p className="text-xs text-gray-600 line-clamp-1">{room.last_message || "Open chat to view."}</p>
                  </div>
                ),
                { duration: 5000, position: 'top-right', style: { borderRadius: '12px', border: '1px solid #e5e7eb' } }
              );
            }
          }
        });

        setUnreadCount(currentUnread);
        lastNotifiedTime.current = newestMessageTime;

      } catch (error) {
        console.warn("Silent background inbox check failed:", error);
      }
    };

    // Check immediately, then poll every 15 seconds
    checkInbox();
    const interval = setInterval(checkInbox, 15000); 
    return () => clearInterval(interval);

  }, [profile, router, isAuthLoading]); // 🚨 4. Added isAuthLoading to dependencies

  return (
    <NotificationContext.Provider value={{ unreadCount }}>
      {children}
      <Toaster /> {/* This renders the actual popups */}
    </NotificationContext.Provider>
  );
};