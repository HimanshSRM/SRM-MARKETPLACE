import { useState, useEffect, useRef, useCallback } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { getInbox } from '@/lib/api';

export interface InboxData {
  buying: any[];
  selling: any[];
  support: any[];
  pools: any[];
}

export function useRealtimeInbox() {
  const { profile } = useAuth();
  const [inboxData, setInboxData] = useState<InboxData>({ buying: [], selling: [], support: [], pools: [] });
  const [isLoading, setIsLoading] = useState(true);

  const titleCache = useRef<Record<string, string>>({});
  const nameCache = useRef<Record<string, string>>({});
  const initialHydrationDone = useRef(false);

  const rawBuying = useRef(new Map());
  const rawSelling = useRef(new Map());
  const rawPools = useRef(new Map());
  const rawAdmin = useRef(new Map()); // 🚨 New map for global admin tickets

  const processAndSetInbox = useCallback(() => {
    if (!profile?.uid) return;
    const uid = profile.uid;

    // Combine all maps including the new admin map
    const allRoomsMap = new Map([...rawBuying.current, ...rawSelling.current, ...rawPools.current, ...rawAdmin.current]);
    const buying: any[] = [];
    const selling: any[] = [];
    const support: any[] = [];
    const pools: any[] = [];

    allRoomsMap.forEach((roomData) => {
      if (roomData.hidden_by && roomData.hidden_by.includes(uid)) return;

      const room = { ...roomData };

      // 1. FORMAT DATES
      if (room.updated_at?.toDate) room.updated_at = room.updated_at.toDate().toISOString();
      if (room.created_at?.toDate) room.created_at = room.created_at.toDate().toISOString();

      // 2. INJECT TITLES
      if (!room.is_ticket && room.type !== 'group_order' && !room.listing_title && room.listing_id) {
         let foundTitle = null;
         const autoMsgMatch = room.last_message?.match(/(?:listing for|interested in)\s*["'“‘]?([^"'””]+)["'””]?/i);

         if (autoMsgMatch && autoMsgMatch[1]) {
             foundTitle = autoMsgMatch[1].trim();
         } else if (room.last_message?.includes('general inquiry about your shop')) {
             foundTitle = 'Shop Inquiry';
         }

         room.listing_title = foundTitle || titleCache.current[room.listing_id] || 'Marketplace Item';
      }

      // 3. INJECT NAMES
      const needsSellerName = room.buyer_id === uid && !room.seller_name && room.seller_id && room.seller_id !== 'ADMIN_TEAM';
      const needsBuyerName = room.seller_id === uid && !room.buyer_name && room.buyer_id;
      const needsHostName = room.type === 'group_order' && !room.host_name && room.host_id;

      if (needsSellerName && nameCache.current[room.seller_id]) room.seller_name = nameCache.current[room.seller_id];
      if (needsBuyerName && nameCache.current[room.buyer_id]) room.buyer_name = nameCache.current[room.buyer_id];
      if (needsHostName && nameCache.current[room.host_id]) room.host_name = nameCache.current[room.host_id];

      // 4. BUCKET SORTING
      const isTicket = room.is_ticket === true || room.is_ticket === 'true' || room.seller_id === 'ADMIN_TEAM';
      const isPool = room.type === 'group_order';

      if (isTicket) support.push(room);
      else if (isPool) pools.push(room);
      else if (room.buyer_id === uid) buying.push(room);
      else if (room.seller_id === uid) selling.push(room);
    });

    const sortByDate = (a: any, b: any) => {
      const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
      const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
      return timeB - timeA;
    };

    setInboxData({
      buying: buying.sort(sortByDate),
      selling: selling.sort(sortByDate),
      support: support.sort(sortByDate),
      pools: pools.sort(sortByDate)
    });
    setIsLoading(false);
  }, [profile?.uid]);

  // --- FIREBASE REAL-TIME LISTENER ---
  useEffect(() => {
    if (!profile?.uid) {
      setIsLoading(false);
      return;
    }

    const uid = profile.uid;
    const roomsRef = collection(db, 'chat_rooms');

    const unsubBuying = onSnapshot(query(roomsRef, where('buyer_id', '==', uid)), (snapshot) => {
      snapshot.forEach(d => rawBuying.current.set(d.id, { id: d.id, room_id: d.id, ...d.data() }));
      processAndSetInbox();
    });

    const unsubSelling = onSnapshot(query(roomsRef, where('seller_id', '==', uid)), (snapshot) => {
      snapshot.forEach(d => rawSelling.current.set(d.id, { id: d.id, room_id: d.id, ...d.data() }));
      processAndSetInbox();
    });

    const unsubPools = onSnapshot(query(roomsRef, where('participants', 'array-contains', uid)), (snapshot) => {
      snapshot.forEach(d => rawPools.current.set(d.id, { id: d.id, room_id: d.id, ...d.data() }));
      processAndSetInbox();
    });

    // 🚨 THE FIX: Check if the user is an Admin, and attach them to the 'ADMIN_TEAM' pipeline
    let unsubAdmin = () => {};
    if (profile?.role === 'admin' ) {
      unsubAdmin = onSnapshot(query(roomsRef, where('seller_id', '==', 'ADMIN_TEAM')), (snapshot) => {
        snapshot.forEach(d => rawAdmin.current.set(d.id, { id: d.id, room_id: d.id, ...d.data() }));
        processAndSetInbox();
      });
    }

    return () => {
      unsubBuying();
      unsubSelling();
      unsubPools();
      unsubAdmin();
    };
  }, [profile?.uid, profile?.role, processAndSetInbox]);

  // One-time cache hydration
  useEffect(() => {
    if (!profile?.uid || initialHydrationDone.current) return;
    initialHydrationDone.current = true;

    getInbox().then(data => {
        const seedCache = (rooms: any[]) => {
            rooms.forEach(room => {
                if (room.listing_id && room.listing_title) titleCache.current[room.listing_id] = room.listing_title;
                if (room.seller_id && room.seller_name) nameCache.current[room.seller_id] = room.seller_name;
                if (room.buyer_id && room.buyer_name) nameCache.current[room.buyer_id] = room.buyer_name;
                if (room.host_id && room.host_name) nameCache.current[room.host_id] = room.host_name;
            });
        };
        seedCache(data.buying || []);
        seedCache(data.selling || []);
        seedCache(data.pools || []);
        seedCache(data.support || []);

        processAndSetInbox();
    }).catch(err => console.error("Cache seeding failed:", err));

  }, [profile?.uid, processAndSetInbox]);

  return { ...inboxData, isLoading };
}