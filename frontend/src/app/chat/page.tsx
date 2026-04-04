'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { getInbox, hideChatRoom } from '@/lib/api';
import { auth } from '@/lib/firebase';
import Link from 'next/link';

interface InboxData {
  buying: any[];
  selling: any[];
  support: any[];
}

type InboxTab = 'buying' | 'selling' | 'support';

export default function InboxPage() {
  const { profile, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  const [inboxData, setInboxData] = useState<InboxData>({ buying: [], selling: [], support: [] });
  const [activeTab, setActiveTab] = useState<InboxTab>('buying');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthLoading) return;

    // Redirect guests
    if (profile?.role === 'guest') {
      router.replace('/');
      return;
    }

    const fetchInbox = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const data = await getInbox(token);
        setInboxData({
          buying: data.buying || [],
          selling: data.selling || [],
          support: data.support || [] 
        });

        // 🚨 BANNED UX TWEAK: Force them to the Support tab so they see the Admin Warning immediately
        if (profile?.role === 'banned') {
          setActiveTab('support');
        } else if (data.buying?.length === 0 && data.selling?.length === 0 && data.support?.length > 0) {
          // Smart routing: If they only have support tickets, open that tab automatically
          setActiveTab('support');
        }

      } catch (err: any) {
        console.error("Failed to load inbox:", err);
        setError("Could not load your messages. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    if (profile) fetchInbox();
  }, [profile, router, isAuthLoading]);

  // Safe Date Formatter
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
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      await hideChatRoom(token, roomId);

      setInboxData(prev => ({
        ...prev,
        [tab]: prev[tab as keyof InboxData].filter((room: any) => (room.id || room.room_id) !== roomId)
      }));
    } catch (error) {
      alert("Failed to remove chat.");
    }
  };

  const currentRooms = inboxData[activeTab] || [];

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
        <div className="flex p-1.5 bg-gray-200/50 backdrop-blur-sm rounded-2xl mb-8 w-full sm:w-[450px] border border-gray-200 overflow-x-auto">
          <button 
            onClick={() => setActiveTab('buying')}
            className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
              activeTab === 'buying' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Buying ({inboxData.buying.length})
          </button>
          <button 
            onClick={() => setActiveTab('selling')}
            className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
              activeTab === 'selling' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Selling ({inboxData.selling.length})
          </button>
          <button 
            onClick={() => setActiveTab('support')}
            className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl transition-all whitespace-nowrap ${
              activeTab === 'support' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Support ({inboxData.support.length})
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        {/* Inbox List Area */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          {currentRooms.length === 0 ? (
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
              {currentRooms.map((room) => {
                const roomId = room.id || room.room_id;
                const isSold = room.status === 'sold';
                const isResolved = room.status === 'resolved';
                const isSupport = activeTab === 'support';
                
                return (
                  <Link 
                    href={`/chat/${roomId}`} 
                    key={roomId}
                    className="flex items-center justify-between p-6 hover:bg-gray-50 transition-all cursor-pointer group relative"
                  >
                    <div className="flex items-center gap-5 w-full pr-12"> 
                      {/* Avatar Placeholder */}
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors ${
                        isSupport 
                          ? (isResolved ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600')
                          : (isSold ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600')
                      }`}>
                        {isSupport ? (
                           <span className="text-2xl">🛡️</span>
                        ) : (
                          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                          </svg>
                        )}
                      </div>
                      
                      {/* Chat Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 truncate transition-colors">
                            {isSupport ? (room.subject || 'Support Ticket') : (room.listing_title || `Negotiation #${room.listing_id || roomId.substring(0,6)}`)}
                          </h3>
                          {/* Status Badges */}
                          {isSold && !isSupport && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black uppercase tracking-wider rounded">Sold</span>
                          )}
                          {isSupport && (
                            <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded ${isResolved ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {room.status || 'Open'}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-1 font-medium">
                          {isSupport 
                            ? (room.last_message || room.admin_response || room.description || "Open Ticket")
                            : (room.last_message ? `"${room.last_message}"` : 'No messages yet...')}
                        </p>
                      </div>
                    </div>

                    {/* Delete Button & Timestamp Container */}
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