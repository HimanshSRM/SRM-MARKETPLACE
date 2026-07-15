'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

interface ActivePool {
  id: string;
  status: string;
  estimated_arrival_time?: string;
  chat_room_id: string;
  app_name: string;
  host_instructions?: string;
}

export default function ActivePoolTracker() {
  const { profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  
  const [activePools, setActivePools] = useState<ActivePool[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  
  const [dismissedPools, setDismissedPools] = useState<string[]>([]);
  const [foldedPools, setFoldedPools] = useState<string[]>([]);

  useEffect(() => {
    const loadState = () => {
      try {
        const storedDismissed = localStorage.getItem('dismissedTrackers');
        if (storedDismissed) setDismissedPools(JSON.parse(storedDismissed));
      } catch(e) {}
    };
    loadState();
    window.addEventListener('trackerStateChanged', loadState);
    return () => window.removeEventListener('trackerStateChanged', loadState);
  }, []);

  const dismissPool = (poolId: string) => {
    const newList = [...dismissedPools, poolId];
    setDismissedPools(newList);
    localStorage.setItem('dismissedTrackers', JSON.stringify(newList));
    window.dispatchEvent(new Event('trackerStateChanged'));
  };

  const toggleFold = (e: React.MouseEvent, poolId: string, forceFold?: boolean) => {
    e.stopPropagation();
    setFoldedPools(prev => {
      if (forceFold) return [...prev, poolId];
      if (prev.includes(poolId)) return prev.filter(id => id !== poolId);
      return [...prev, poolId];
    });
  };

  useEffect(() => {
    if (!profile?.uid || profile?.role === 'guest') return;

    const q = query(
      collection(db, 'group_orders'),
      where('participant_ids', 'array-contains', profile.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pools = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivePool));
      const lockedPools = pools.filter(p => p.status === 'locked');
      setActivePools(lockedPools);
    });

    return () => unsubscribe();
  }, [profile]);

  useEffect(() => {
    if (activePools.length === 0) return;
    const heartbeat = setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => clearInterval(heartbeat);
  }, [activePools]);

  useEffect(() => {
    if (activePools.length > 0) {
      const timer = setTimeout(() => {
        setFoldedPools(activePools.map(p => p.id));
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [activePools]);

  if (activePools.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 sm:bottom-8 sm:right-8 z-50 flex flex-col gap-3 pointer-events-none">
      {activePools.map(pool => {
        if (dismissedPools.includes(pool.id)) return null;
        if (pathname === `/chat/${pool.chat_room_id}`) return null;

        if (pool.estimated_arrival_time) {
          const etaTime = new Date(pool.estimated_arrival_time).getTime();
          if (currentTime > etaTime + 30 * 60 * 1000) return null; 
        }

        let isOverdue = false;
        let timeText = 'Calculating...';
        let minutesLeft = null;

        if (pool.estimated_arrival_time) {
          const distance = new Date(pool.estimated_arrival_time).getTime() - currentTime;
          minutesLeft = Math.ceil(distance / (1000 * 60));
          if (minutesLeft <= 0) {
            isOverdue = true;
            timeText = 'Should be here!';
          } else {
            timeText = `${minutesLeft}m`;
          }
        }

        const isFolded = foldedPools.includes(pool.id);

        return (
          <div key={pool.id} className="relative flex flex-col items-end pointer-events-auto animate-fade-in-up">
            {isFolded ? (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-full shadow-lg transition-all border cursor-pointer hover:scale-105 ${
                isOverdue ? 'bg-orange-50 border-orange-200 shadow-orange-500/20 animate-pulse' : 'bg-gray-900 border-black shadow-black/30'
              }`}
              onClick={(e) => toggleFold(e, pool.id)}
              >
                <span className="text-sm">{isOverdue ? '📍' : '🛒'}</span>
                <span className={`text-xs font-black tracking-wide ${isOverdue ? 'text-orange-700' : 'text-white'}`}>
                  {timeText}
                </span>
                <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-1">
                   <div className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-white/20 transition text-gray-400 hover:text-white" title="Expand">
                     <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7" /></svg>
                   </div>
                   <div onClick={(e) => { e.stopPropagation(); dismissPool(pool.id); }} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-red-500 transition text-gray-400 hover:text-white" title="Dismiss">
                     <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                   </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-end">
                <div className="flex gap-2 mb-2 mr-2">
                  <button onClick={(e) => toggleFold(e, pool.id, true)} className="z-20 w-7 h-7 bg-white hover:bg-gray-100 text-gray-600 rounded-full flex items-center justify-center shadow-md transition-colors border border-gray-200">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); dismissPool(pool.id); }} className="z-20 w-7 h-7 bg-white hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-full flex items-center justify-center shadow-md transition-colors border border-gray-200">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                <button onClick={() => router.push(`/chat/${pool.chat_room_id}`)} className="group relative flex flex-col items-end text-left w-full">
                  {pool.host_instructions && (
                    <div className="mb-2 max-w-[250px] bg-white border border-gray-100 shadow-xl rounded-xl p-3 transform transition-transform group-hover:-translate-y-1">
                      <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 mb-0.5">📢 Host Update</p>
                      <p className="text-xs text-gray-800 font-medium leading-snug line-clamp-2">"{pool.host_instructions}"</p>
                    </div>
                  )}
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-full shadow-2xl transition-all border-2 w-full justify-between ${
                    isOverdue ? 'bg-orange-50 border-orange-200 shadow-orange-500/20 animate-pulse' : 'bg-gray-900 border-black shadow-black/30 hover:bg-black group-hover:scale-105'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 shrink-0">
                        <span className="text-lg">{isOverdue ? '📍' : '🛒'}</span>
                      </div>
                      <div className="pr-2">
                        <p className={`text-[10px] font-bold uppercase tracking-widest ${isOverdue ? 'text-orange-600' : 'text-gray-400'}`}>
                          {pool.app_name} ETA
                        </p>
                        <p className={`text-sm font-black tabular-nums tracking-wide ${isOverdue ? 'text-orange-700' : 'text-white'}`}>
                          {timeText} {minutesLeft !== null && !isOverdue ? 'away' : ''}
                        </p>
                      </div>
                    </div>
                    <div className={`pl-2 border-l ${isOverdue ? 'border-orange-200/50' : 'border-gray-700'} flex items-center justify-center h-full`}>
                      <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded bg-white/10 ${isOverdue ? 'text-orange-700' : 'text-white'}`}>
                        Open Chat
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}