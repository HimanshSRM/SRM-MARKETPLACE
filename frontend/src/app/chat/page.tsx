'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
// 🚨 NEW IMPORTS ADDED (We will build getPastPools and getMyTickets in api.ts at the end!)
import { hideChatRoom, getPastPools, getMyTickets } from '@/lib/api';
import Link from 'next/link';

// 🚨 IMPORT THE NEW REAL-TIME ENGINE
import { useRealtimeInbox } from '@/lib/useRealtimeInbox'; 

type InboxTab = 'buying' | 'selling' | 'support' | 'pools'; 

export default function InboxPage() {
  const { profile, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  // 🚨 The Magic One-Liner (No extra variables needed!)
  const { buying, selling, support, pools, isLoading } = useRealtimeInbox();
  
  const inboxData = { buying, selling, support, pools };
  
  const [activeTab, setActiveTab] = useState<InboxTab>(() => {
    if (typeof window !== 'undefined') {
      const savedTab = localStorage.getItem('inboxActiveTab');
      if (savedTab === 'buying' || savedTab === 'selling' || savedTab === 'support' || savedTab === 'pools') {
        return savedTab as InboxTab;
      }
    }
    return 'buying';
  });

  // --- 🚨 NEW: PAST HISTORY PAGINATION STATES ---
  const [pastPools, setPastPools] = useState<any[]>([]);
  const [poolsCursor, setPoolsCursor] = useState<string | null>(null);
  const [isLoadingPastPools, setIsLoadingPastPools] = useState(false);
  const [hasMorePastPools, setHasMorePastPools] = useState(true);

  const [pastTickets, setPastTickets] = useState<any[]>([]);
  const [ticketsCursor, setTicketsCursor] = useState<string | null>(null);
  const [isLoadingPastTickets, setIsLoadingPastTickets] = useState(false);
  const [hasMorePastTickets, setHasMorePastTickets] = useState(true);

  useEffect(() => {
    localStorage.setItem('inboxActiveTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (profile?.role === 'banned') {
      setActiveTab('support');
    } else if (!isLoading && buying.length === 0 && selling.length === 0 && support.length > 0) {
      setActiveTab('support');
    }
  }, [profile?.role, isLoading, buying.length, selling.length, support.length]);

  useEffect(() => {
    if (!isAuthLoading && profile?.role === 'guest') {
      router.replace('/');
    }
  }, [profile, router, isAuthLoading]);

  const formatTime = (dateString?: string) => {
    if (!dateString) return ''; 
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return ''; 
    
    const today = new Date();
    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    
    return isToday ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
  };

  const handleHideChat = async (e: React.MouseEvent, roomId: string) => {
    e.preventDefault(); 
    e.stopPropagation();

    if (!window.confirm("Remove this conversation from your active inbox?")) return;

    try {
      await hideChatRoom(roomId);
    } catch (error) {
      alert("Failed to remove chat.");
    }
  };

  // --- 🚨 NEW: HISTORY FETCHER ---
  const fetchHistory = async () => {
    if (activeTab === 'pools') {
      setIsLoadingPastPools(true);
      try {
        const res = await getPastPools(poolsCursor || undefined);
        setPastPools(prev => [...prev, ...(res.data || [])]);
        setPoolsCursor(res.next_cursor || null);
        setHasMorePastPools(!!res.next_cursor);
      } catch (e) {
        console.error("Failed to load past pools", e);
      } finally {
        setIsLoadingPastPools(false);
      }
    } else if (activeTab === 'support') {
      setIsLoadingPastTickets(true);
      try {
        const res = await getMyTickets(ticketsCursor || undefined);
        setPastTickets(prev => [...prev, ...(res.data || [])]);
        setTicketsCursor(res.next_cursor || null);
        setHasMorePastTickets(!!res.next_cursor);
      } catch (e) {
        console.error("Failed to load past tickets", e);
      } finally {
        setIsLoadingPastTickets(false);
      }
    }
  };

  // --- 🚨 THE FIX: SMART ARRAY MERGER ---
  // Merges active real-time chats with fetched historical data gracefully
  const currentRooms = inboxData[activeTab] || [];
  let combinedRooms = Array.from(new Map(currentRooms.map(room => [room.id || room.room_id, room])).values());

  if (activeTab === 'pools') {
    const activeIds = new Set(combinedRooms.map(r => r.chat_room_id || r.id || r.room_id));
    const pastUnique = pastPools.filter(p => !activeIds.has(p.chat_room_id));
    combinedRooms = [...combinedRooms, ...pastUnique];
  } else if (activeTab === 'support') {
    const activeIds = new Set(combinedRooms.map(r => r.chat_room_id || r.id || r.room_id));
    const pastUnique = pastTickets.filter(t => !activeIds.has(t.chat_room_id));
    combinedRooms = [...combinedRooms, ...pastUnique];
  }

  const isValidString = (str: any) => typeof str === 'string' && str.trim() !== '' && str !== 'undefined' && str !== 'null';

  if (isAuthLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (profile === null || profile.role === 'guest') return null;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Inbox</h1>
            <p className="text-gray-500 mt-1">Manage your negotiations and campus deals.</p>
          </div>
          <button 
            onClick={() => router.push('/')}
            className="px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 transition shadow-sm w-full sm:w-auto"
          >
            ← Back to Feed
          </button>
        </div>

        <div className="flex p-1.5 bg-gray-200/50 backdrop-blur-sm rounded-2xl mb-8 w-full border border-gray-200 overflow-x-auto scrollbar-hide">
          {['buying', 'selling', 'pools', 'support'].map((tab) => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab as InboxTab)}
              className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
                activeTab === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'pools' ? '🛒 Cart Pools' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div>
          {/* 🚨 THE FIX: Swapped uniqueRooms for combinedRooms */}
          {combinedRooms.length === 0 ? (
            <div className="bg-white p-12 sm:p-16 text-center rounded-3xl shadow-sm border border-gray-200">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">No {activeTab} chats found</h3>
              <p className="text-gray-500 mt-2 max-w-xs mx-auto text-sm">
                {activeTab === 'buying' 
                  ? "When you message a seller about an item or service, it will show up here."
                  : activeTab === 'selling' 
                  ? "When students bid on your listings, you'll see those conversations here."
                  : activeTab === 'pools'
                  ? "When you join or host a Cart Pool, the group chat will appear here."
                  : "When you open a support ticket or receive a warning, it will show up here."}
              </p>
              
              {/* If it's empty, we should still let them try to load history just in case */}
              {(activeTab === 'pools' || activeTab === 'support') && (
                <button 
                  onClick={fetchHistory} 
                  disabled={activeTab === 'pools' ? isLoadingPastPools : isLoadingPastTickets}
                  className="mt-8 px-8 py-3 bg-gray-100 text-gray-700 rounded-2xl text-sm font-bold hover:bg-gray-200 transition"
                >
                  {(activeTab === 'pools' ? isLoadingPastPools : isLoadingPastTickets) ? 'Checking Archive...' : 'Check Past History ⬇️'}
                </button>
              )}

              {activeTab !== 'pools' && activeTab !== 'support' && (
                <button 
                  onClick={() => router.push('/')} 
                  className="mt-8 px-8 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold hover:bg-blue-700 transition shadow-md"
                >
                  Browse Marketplace
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* 🚨 THE FIX: Map over the new combined array safely */}
              {combinedRooms.map((room) => {
                const roomId = room.chat_room_id || room.room_id || room.id; 
                const isSold = room.status === 'sold' || room.status === 'settled';
                const isResolved = room.status === 'resolved';
                
                const isSupport = activeTab === 'support' || room.reference_type === 'general' || room.is_ticket;
                const isPool = activeTab === 'pools' || room.type === 'group_order' || room.app_name;
                const isBuying = activeTab === 'buying';
                const isSelling = activeTab === 'selling';

                let otherPersonName = 'User';
                if (isBuying) {
                  otherPersonName = isValidString(room.seller_name) ? room.seller_name : (isValidString(room.seller_email) ? room.seller_email : 'Seller');
                }
                if (isSelling) {
                  otherPersonName = isValidString(room.buyer_name) ? room.buyer_name : (isValidString(room.buyer_email) ? room.buyer_email : 'Buyer');
                }
                if (isSupport) otherPersonName = 'Admin Team';
                if (isPool) otherPersonName = isValidString(room.host_name) ? room.host_name : 'Pool Host';

                const cleanPersonName = otherPersonName.includes('@') ? otherPersonName.split('@')[0] : otherPersonName;
                const avatarLetter = cleanPersonName.charAt(0).toUpperCase();

                let poolIcon = '🛒';
                if (isPool && isValidString(room.app_name)) {
                  const app = room.app_name.toLowerCase();
                  if (app.includes('zomato') || app.includes('swiggy')) poolIcon = '🍔';
                  else if (app.includes('blinkit') || app.includes('zepto')) poolIcon = '🛒';
                }

                let displayTitle = 'Marketplace Item';
                if (isSupport) {
                    displayTitle = isValidString(room.subject) ? room.subject : 'Support Ticket';
                } else if (isPool) {
                    displayTitle = isValidString(room.title) ? room.title : `${cleanPersonName}'s Group Order`;
                } else {
                    const itemTitle = room.listing_title || room.item_title || room.item_name || room.product_name;
                    if (isValidString(itemTitle) && itemTitle !== 'Deleted Item') {
                        displayTitle = itemTitle;
                    }
                }
                
                return (
                  <Link 
                    href={`/chat/${roomId}`} 
                    key={roomId}
                    prefetch={false}
                    className={`bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between transition-all cursor-pointer group relative hover:shadow-md ${isPool ? 'hover:border-purple-200' : 'hover:border-blue-200'}`}
                  >
                    <div className="flex items-center gap-4 sm:gap-5 w-full pr-14 sm:pr-16"> 
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors text-xl font-black shadow-sm ${
                        isSupport ? (isResolved ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600') : isPool ? 'bg-purple-100 text-purple-600' : isBuying ? 'bg-blue-50 text-blue-600' : 'bg-indigo-50 text-indigo-600'
                      }`}>
                        {isSupport ? '🛡️' : isPool ? poolIcon : avatarLetter}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-2 mb-1.5">
                          {isBuying && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-wider rounded">Buying</span>}
                          {isSelling && <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider rounded">Selling</span>}
                          {isSold && !isSupport && !isPool && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black uppercase tracking-wider rounded">Sold</span>}
                          {isSupport && <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded ${isResolved ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{room.status || 'Open'}</span>}
                          {isPool && isValidString(room.app_name) && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-black uppercase tracking-wider rounded">{room.app_name}</span>}
                        </div>

                        <h3 className={`text-base sm:text-lg font-bold text-gray-900 truncate transition-colors ${isPool ? 'group-hover:text-purple-600' : 'group-hover:text-blue-600'}`}>
                          {displayTitle}
                        </h3>
                        
                        <p className="text-sm text-gray-500 mt-1 line-clamp-1 font-medium flex items-center gap-1.5">
                          <span className="font-bold text-gray-700 hidden sm:inline">{isSupport ? 'System' : isPool ? 'Group' : cleanPersonName}</span>
                          <span className="text-gray-300 hidden sm:inline">•</span>
                          <span className="truncate">{isSupport ? (room.last_message || room.admin_response || room.description || "Open Ticket") : (room.last_message ? `"${room.last_message}"` : 'No messages yet...')}</span>
                        </p>
                      </div>
                    </div>

                    <div className="absolute right-4 sm:right-6 flex flex-col sm:flex-row items-end sm:items-center gap-2 sm:gap-3">
                      {(room.updated_at || room.created_at) && <span className="text-[10px] sm:text-xs text-gray-400 font-bold sm:font-medium text-right">{formatTime(room.updated_at || room.created_at)}</span>}
                      
                      {/* Active chats can be hidden, historical fetched chats don't need this button */}
                      {room.id && (
                        <button onClick={(e) => handleHideChat(e, roomId)} className="p-1.5 sm:p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all z-10" title="Remove from Inbox">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                    </div>
                  </Link>
                )
              })}

              {/* 🚨 NEW: Safe Paginator Buttons appended to the bottom of the active list */}
              {activeTab === 'pools' && hasMorePastPools && combinedRooms.length > 0 && (
                <div className="flex justify-center pt-6 pb-4">
                  <button onClick={fetchHistory} disabled={isLoadingPastPools} className="px-6 py-2.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-xl hover:bg-gray-300 transition">
                    {isLoadingPastPools ? 'Loading...' : 'Load Past Orders ⬇️'}
                  </button>
                </div>
              )}
              {activeTab === 'support' && hasMorePastTickets && combinedRooms.length > 0 && (
                <div className="flex justify-center pt-6 pb-4">
                  <button onClick={fetchHistory} disabled={isLoadingPastTickets} className="px-6 py-2.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-xl hover:bg-gray-300 transition">
                    {isLoadingPastTickets ? 'Loading...' : 'Load Past Tickets ⬇️'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}