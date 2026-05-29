'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { getInbox, hideChatRoom } from '@/lib/api';
import Link from 'next/link';

interface InboxData {
  buying: any[];
  selling: any[];
  support: any[];
  pools: any[]; 
}

type InboxTab = 'buying' | 'selling' | 'support' | 'pools'; 

export default function InboxPage() {
  const { profile, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  const [inboxData, setInboxData] = useState<InboxData>({ buying: [], selling: [], support: [], pools: [] });
  
  // --- INSTANT PERSISTENT STATE: INBOX TABS ---
  const [activeTab, setActiveTab] = useState<InboxTab>(() => {
    if (typeof window !== 'undefined') {
      const savedTab = localStorage.getItem('inboxActiveTab');
      if (savedTab === 'buying' || savedTab === 'selling' || savedTab === 'support' || savedTab === 'pools') {
        return savedTab as InboxTab;
      }
    }
    return 'buying'; // Default fallback
  });

  // Save tab to memory whenever it changes
  useEffect(() => {
    localStorage.setItem('inboxActiveTab', activeTab);
  }, [activeTab]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthLoading) return;

    if (profile?.role === 'guest') {
      router.replace('/');
      return;
    }

    const fetchInbox = async () => {
      try {
        // API Wrapper handles auth automatically!
        const data = await getInbox();
        
        setInboxData({
          buying: data.buying || [],
          selling: data.selling || [],
          support: data.support || [],
          pools: data.pools || [] 
        });

        // BANNED UX TWEAK
        if (profile?.role === 'banned') {
          setActiveTab('support');
        } else if (data.buying?.length === 0 && data.selling?.length === 0 && data.support?.length > 0) {
          setActiveTab('support');
        }

      } catch (err: any) {
        console.error("Failed to load inbox:", err);
        setError("Could not load your messages. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    if (profile) {
      // 1. Fetch instantly on load
      fetchInbox();

      // 2. 🚨 MAGIC FIX: Refetch silently when user switches back to the tab
      const handleFocus = () => fetchInbox();
      window.addEventListener('focus', handleFocus);

      // Cleanup
      return () => window.removeEventListener('focus', handleFocus);
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

  const handleHideChat = async (e: React.MouseEvent, roomId: string, tab: string) => {
    e.preventDefault(); 
    e.stopPropagation();

    if (!window.confirm("Remove this conversation from your inbox?")) return;

    try {
      await hideChatRoom(roomId);

      setInboxData(prev => ({
        ...prev,
        [tab]: prev[tab as keyof InboxData].filter((room: any) => (room.id || room.room_id) !== roomId)
      }));
    } catch (error) {
      alert("Failed to remove chat.");
    }
  };

  const currentRooms = inboxData[activeTab] || [];
  
  // Silently remove duplicates returned by the backend using a Map based on Room ID
  const uniqueRooms = Array.from(new Map(currentRooms.map(room => [room.id || room.room_id, room])).values());

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
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Inbox</h1>
            <p className="text-gray-500 mt-1">Manage your negotiations and campus deals.</p>
          </div>
          <button 
            onClick={() => router.push('/')}
            className="px-5 py-2.5 bg-white border border-gray-300 rounded-xl text-sm font-semibold hover:bg-gray-50 transition shadow-sm w-fit"
          >
            ← Back to Feed
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1.5 bg-gray-200/50 backdrop-blur-sm rounded-2xl mb-8 w-full border border-gray-200 overflow-x-auto scrollbar-hide">
          <button 
            onClick={() => setActiveTab('buying')}
            className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
              activeTab === 'buying' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Buying
          </button>
          <button 
            onClick={() => setActiveTab('selling')}
            className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
              activeTab === 'selling' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Selling
          </button>
          <button 
            onClick={() => setActiveTab('pools')}
            className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
              activeTab === 'pools' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            🛒 Cart Pools
          </button>
          <button 
            onClick={() => setActiveTab('support')}
            className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
              activeTab === 'support' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Support
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {/* Inbox List Area */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          {uniqueRooms.length === 0 ? (
            <div className="p-16 text-center">
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
              <button 
                onClick={() => router.push(activeTab === 'support' ? '/support' : '/')} 
                className="mt-8 px-8 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold hover:bg-blue-700 transition shadow-md"
              >
                {activeTab === 'support' ? 'Contact Admin' : 'Browse Marketplace'}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {uniqueRooms.map((room) => {
                const roomId = room.id || room.room_id;
                const isSold = room.status === 'sold';
                const isResolved = room.status === 'resolved';
                
                const isSupport = activeTab === 'support';
                const isPool = activeTab === 'pools' || room.type === 'group_order';
                const isBuying = activeTab === 'buying';
                const isSelling = activeTab === 'selling';

                const isValidString = (str: any) => typeof str === 'string' && str.trim() !== '' && str !== 'undefined' && str !== 'null';

                // 🚨 SMART UX: Clean Person Names (No random IDs)
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

                // 🚨 SMART UX: Clean Titles (Item is the Star)
                let displayTitle = 'Marketplace Item';
                if (isSupport) {
                    displayTitle = isValidString(room.subject) ? room.subject : 'Support Ticket';
                } else if (isPool) {
                    displayTitle = isValidString(room.title) ? room.title : `${cleanPersonName}'s Group Order`;
                } else {
                    const itemTitle = room.listing_title || room.item_title || room.item_name || room.product_name;
                    if (isValidString(itemTitle)) {
                        displayTitle = itemTitle;
                    } else {
                        // Extract from automated message if possible
                        const autoMsgMatch = room.last_message?.match(/(?:listing for|interested in)\s*["'“‘]?([^"'””]+)["'””]?/i);
                        if (autoMsgMatch && autoMsgMatch[1]) {
                            displayTitle = autoMsgMatch[1].trim(); 
                        }
                    }
                }
                
                return (
                  <Link 
                    href={`/chat/${roomId}`} 
                    key={roomId}
                    prefetch={false}
                    className={`flex items-center justify-between p-6 transition-all cursor-pointer group relative ${isPool ? 'hover:bg-purple-50/50' : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center gap-5 w-full pr-12"> 
                      {/* Avatar */}
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors text-xl font-black ${
                        isSupport 
                          ? (isResolved ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600')
                          : isPool 
                          ? 'bg-purple-100 text-purple-600'
                          : isBuying 
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-indigo-50 text-indigo-600'
                      }`}>
                        {isSupport ? '🛡️' : isPool ? poolIcon : avatarLetter}
                      </div>
                      
                      {/* Chat Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          {isBuying && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-wider rounded">Buying</span>}
                          {isSelling && <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-black uppercase tracking-wider rounded">Selling</span>}
                          {isSold && !isSupport && !isPool && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black uppercase tracking-wider rounded">Sold</span>}
                          
                          {isSupport && (
                            <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded ${isResolved ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {room.status || 'Open'}
                            </span>
                          )}
                          {isPool && isValidString(room.app_name) && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-black uppercase tracking-wider rounded">
                              {room.app_name}
                            </span>
                          )}
                        </div>

                        {/* 🚨 RESTRUCTURED: Title is the Item */}
                        <h3 className={`text-lg font-bold text-gray-900 truncate transition-colors ${isPool ? 'group-hover:text-purple-600' : 'group-hover:text-blue-600'}`}>
                          {displayTitle}
                        </h3>
                        
                        {/* 🚨 RESTRUCTURED: Subtitle is "Person Name • Message" */}
                        <p className="text-sm text-gray-500 mt-1 line-clamp-1 font-medium flex items-center gap-1.5">
                          <span className="font-bold text-gray-700">
                            {isSupport ? 'System' : isPool ? 'Group' : cleanPersonName}
                          </span>
                          <span className="text-gray-300">•</span>
                          <span className="truncate">
                            {isSupport 
                              ? (room.last_message || room.admin_response || room.description || "Open Ticket")
                              : (room.last_message ? `"${room.last_message}"` : 'No messages yet...')}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="absolute right-6 flex items-center gap-3">
                      {(room.updated_at || room.created_at) && (
                        <span className="hidden sm:block text-xs text-gray-400 font-medium">
                          {formatTime(room.updated_at || room.created_at)}
                        </span>
                      )}
                      
                      <button 
                        onClick={(e) => handleHideChat(e, roomId, activeTab)}
                        className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all z-10"
                        title="Remove from Inbox"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}