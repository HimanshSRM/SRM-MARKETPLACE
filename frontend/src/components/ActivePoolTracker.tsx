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
  
  // 🚨 THE FIX: Strictly type the state instead of using 'any'
  const [activePool, setActivePool] = useState<ActivePool | null>(null);
  const [timeLeft, setTimeLeft] = useState('');

  // 1. The Highly Optimized Listener (Only costs 1 read when order state changes)
  useEffect(() => {
    if (!profile?.uid || profile?.role === 'guest') return;

    const q = query(
      collection(db, 'group_orders'),
      where('participant_ids', 'array-contains', profile.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // 🚨 THE FIX: Tell TypeScript this data matches our ActivePool interface
      const pools = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivePool));
      
      // Filter locally for 'locked' to avoid needing complex Firebase composite indexes
      const lockedPool = pools.find(p => p.status === 'locked');
      setActivePool(lockedPool || null);
    });

    return () => unsubscribe();
  }, [profile]);

  // 2. The Zero-Cost Local Countdown Timer
  useEffect(() => {
    if (!activePool || !activePool.estimated_arrival_time) return;

    const interval = setInterval(() => {
      const distance = new Date(activePool.estimated_arrival_time!).getTime() - new Date().getTime();
      
      if (distance < 0) {
        clearInterval(interval);
        setTimeLeft('Should be here!');
      } else {
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);
        setTimeLeft(`${m}m ${s}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activePool]);

  // 3. Render Checks
  if (!activePool) return null; // Hide if no active order
  if (pathname === `/chat/${activePool.chat_room_id}`) return null; // Hide if already inside the chat room

  const isOverdue = timeLeft === 'Should be here!';

  return (
    <div className="fixed bottom-20 right-4 sm:bottom-8 sm:right-8 z-50 animate-fade-in-up">
      <button 
        onClick={() => router.push(`/chat/${activePool.chat_room_id}`)}
        className="group relative flex flex-col items-end text-left"
      >
        {/* Floating Instructions Marquee (Only shows if host typed something) */}
        {activePool.host_instructions && (
          <div className="mb-2 max-w-[250px] bg-white border border-gray-100 shadow-xl rounded-xl p-3 transform transition-transform group-hover:-translate-y-1">
            <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 mb-0.5">📢 Host Update</p>
            <p className="text-xs text-gray-800 font-medium leading-snug line-clamp-2">"{activePool.host_instructions}"</p>
          </div>
        )}

        {/* The Main Tracker Pill */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-full shadow-2xl transition-all border-2 ${
          isOverdue 
            ? 'bg-orange-50 border-orange-200 shadow-orange-500/20 animate-pulse' 
            : 'bg-gray-900 border-black shadow-black/30 hover:bg-black group-hover:scale-105'
        }`}>
          
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 shrink-0">
            <span className="text-lg">{isOverdue ? '📍' : '🛒'}</span>
          </div>

          <div className="pr-2">
            <p className={`text-[10px] font-bold uppercase tracking-widest ${isOverdue ? 'text-orange-600' : 'text-gray-400'}`}>
              {activePool.app_name} ETA
            </p>
            <p className={`text-sm font-black tabular-nums tracking-wide ${isOverdue ? 'text-orange-700' : 'text-white'}`}>
              {timeLeft || 'Calculating...'}
            </p>
          </div>

          <div className={`pl-2 border-l ${isOverdue ? 'border-orange-200/50' : 'border-gray-700'}`}>
            <svg className={`w-5 h-5 ${isOverdue ? 'text-orange-500' : 'text-gray-400 group-hover:text-white'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>

        </div>
      </button>
    </div>
  );
}