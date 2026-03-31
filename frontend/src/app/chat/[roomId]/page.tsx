'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { getChatMessages, sendMessage, acceptBid, resolveSupportTicket, moderateListing, moderateUser, ChatMessage, deleteChatMessages } from '@/lib/api';

export default function ChatRoomPage() {
  const router = useRouter();
  const params = useParams();
  const roomId = params.roomId as string;
  const { profile } = useAuth();

  const [roomDetails, setRoomDetails] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roomStatus, setRoomStatus] = useState<'active' | 'sold' | 'resolved'>('active');
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  
  // Listing Moderation State
  const [modAction, setModAction] = useState<'warn' | 'hide' | 'delete' | 'restore' |null>(null);
  const [modReason, setModReason] = useState('');
  const [isModerating, setIsModerating] = useState(false);

  // USER Moderation State
  const [userModReason, setUserModReason] = useState('');
  const [isUserModerating, setIsUserModerating] = useState(false);
  
  // Bidding State
  const [isBidding, setIsBidding] = useState(false);
  const [bidAmount, setBidAmount] = useState('');

  // Bulk Delete State
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!isSelectionMode) {
       scrollToBottom();
    }
  }, [messages, isSelectionMode]);

  const formatTime = (dateString?: string) => {
    if (!dateString) return 'Just now'; 
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'Just now'; 
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const loadChat = async () => {
    try {
      setIsLoading(true);
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        const { room, messages } = await getChatMessages(token, roomId);
        setRoomDetails(room);
        setMessages(messages || []);
        
        if (room?.status === 'resolved') setRoomStatus('resolved');
        const hasAcceptedBid = messages && messages.some((m: any) => m.status === 'accepted');
        if (hasAcceptedBid || room?.status === 'sold') setRoomStatus('sold');
      }
    } catch (error) {
      console.error("Error loading chat:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (profile === undefined) return;
    if (profile === null) {
      setIsLoading(false); 
      return; 
    }
    loadChat();
  }, [roomId, profile]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roomStatus === 'sold' || roomStatus === 'resolved') return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token || !profile?.uid) return;

      const sentMsg = await sendMessage(
        token, roomId, profile.uid,
        newMessage || `Bid: ₹${bidAmount}`, 
        isBidding, isBidding ? parseFloat(bidAmount) : undefined
      );

      setMessages((prev) => [...prev, sentMsg]);
      setNewMessage('');
      setIsBidding(false);
      setBidAmount('');
    } catch (error) {
      alert("Failed to send.");
    }
  };

  const toggleMessageSelection = (messageId: string | number) => {
    const idStr = messageId.toString();
    setSelectedMessages(prev => 
      prev.includes(idStr) 
        ? prev.filter(id => id !== idStr) 
        : [...prev, idStr]
    );
  };

  const handleDeleteSelected = async () => {
    if (selectedMessages.length === 0) return;
    if (!window.confirm(`Are you sure you want to permanently delete ${selectedMessages.length} message(s)?`)) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      await deleteChatMessages(token, roomId, selectedMessages);

      setMessages(prev => prev.filter(msg => !selectedMessages.includes(msg.id.toString())));
      
      setSelectedMessages([]);
      setIsSelectionMode(false);

    } catch (error: any) {
      alert(error.message || "Failed to delete messages.");
    }
  };

  const handleAccept = async (messageId: string | number) => {
    const confirmAccept = confirm("Are you sure? This will mark the item as SOLD and close the negotiation.");
    if (!confirmAccept) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      await acceptBid(token, roomId, messageId);
      setRoomStatus('sold');
      loadChat();
      alert("Deal closed! Item marked as sold.");
    } catch (error) {
      alert("Error accepting bid. You might not be the owner.");
    }
  };

  const handleResolveTicket = async () => {
    const confirmResolve = confirm("Mark this support ticket as resolved?");
    if (!confirmResolve) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      await resolveSupportTicket(token, roomId);
      setRoomStatus('resolved');
      alert("Ticket resolved successfully.");
    } catch (error) {
      alert("Failed to resolve ticket.");
    }
  };

  // 🚨 CORRECTED LISTING MODERATION HANDLER
  const handleModerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modAction || !modReason.trim() || !roomDetails?.listing_id) return;
    
    const confirmAction = confirm(`Are you sure you want to ${modAction.toUpperCase()} this listing?`);
    if (!confirmAction) return;

    try {
      setIsModerating(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      await moderateListing(token, roomDetails.listing_id, modAction, modReason , roomDetails.shop_id);
      
      // 🚨 REMOVED auto-resolve here so the chat stays open and the buttons stay visible!
      
      setModAction(null);
      setModReason('');
      loadChat();
      alert(`Action '${modAction}' executed successfully!`);
    } catch (error: any) {
      alert(error.message || "Failed to moderate listing.");
    } finally {
      setIsModerating(false);
    }
  };

  const handleUserModerate = async (action: 'warn' | 'ban' | 'restore' | 'nuke') => {
    if (userModReason.length < 10) {
      alert("Please provide a reason (at least 10 characters) for the audit log.");
      return;
    }
    
    const targetUid = roomDetails?.buyer_id === 'ADMIN_TEAM' ? roomDetails?.seller_id : roomDetails?.buyer_id;

    if (!targetUid) {
      alert("Error: Cannot determine the target user's ID.");
      return;
    }

    if (action === 'nuke' && !confirm("WARNING: This will permanently delete the user. Proceed?")) return;
    if (action === 'ban' && !confirm("This will lock the user out of their account. Proceed?")) return;

    try {
      setIsUserModerating(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      await moderateUser(token, targetUid, action, userModReason, roomId);

      if ( action === 'nuke') {
        await resolveSupportTicket(token, roomId);
        setRoomStatus('resolved');
      }

      setUserModReason(""); 
      loadChat(); 
    } catch (error: any) {
      alert(error.message || "Failed to execute moderation action.");
    } finally {
      setIsUserModerating(false);
    }
  };

  if (isLoading || profile === undefined) return <div className="h-screen flex items-center justify-center font-bold text-gray-500">Loading Chat...</div>;
  if (profile === null) return <div className="h-screen flex items-center justify-center font-bold text-red-500">Access Denied. Please Log In.</div>;

  const isSupport = roomDetails?.is_ticket === true || roomDetails?.is_ticket === 'true' || roomDetails?.is_ticket === 'True' || roomDetails?.seller_id === 'ADMIN_TEAM';
  const isAdmin = profile?.role === 'admin';
  const isDirectUserTicket = roomDetails?.listing_id === 'USER_MODERATION';

  return (
    <div className="flex flex-col h-screen bg-white max-w-2xl mx-auto shadow-2xl relative">
      
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/chat')} className="p-2 hover:bg-gray-100 rounded-full">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h2 className="font-bold text-gray-900 line-clamp-1">
              {isSupport ? roomDetails?.subject || 'Support Ticket' : roomDetails?.listing_title || 'Negotiation'}
            </h2>
            <p className="text-xs text-gray-500">{isSupport ? 'Campus Support' : 'Marketplace Chat'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          
          {/* Bulk Delete Controls */}
          {isSelectionMode ? (
            <>
              <button onClick={() => { setIsSelectionMode(false); setSelectedMessages([]); }} className="px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 transition">
                Cancel
              </button>
              <button onClick={handleDeleteSelected} disabled={selectedMessages.length === 0} className="px-4 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-red-700 disabled:opacity-50 transition flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                Delete ({selectedMessages.length})
              </button>
            </>
          ) : (
            <button onClick={() => setIsSelectionMode(true)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition" title="Select messages to delete">
               <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" /></svg>
            </button>
          )}

          {/* Status Badges */}
          {!isSelectionMode && roomStatus === 'sold' && <div className="px-4 py-1 bg-green-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full animate-bounce">Sold</div>}
          {!isSelectionMode && isSupport && roomStatus === 'resolved' && <div className="px-4 py-1 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">Resolved</div>}
          {!isSelectionMode && isSupport && isAdmin && roomStatus !== 'resolved' && (
            <button onClick={handleResolveTicket} className="px-4 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-gray-800 transition">
              Resolve
            </button>
          )}
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        
        {isSupport && (
          <div className="text-center my-4">
            <span className="px-3 py-1 bg-gray-200 text-gray-600 text-[10px] font-black uppercase rounded-full tracking-wider">
              Secure Support Channel
            </span>
          </div>
        )}

        {/* Admin Moderation Panels */}
        {isAdmin && isSupport && isDirectUserTicket && (
          <div className="mb-6 bg-gray-900 rounded-2xl p-4 shadow-lg border border-gray-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest">Target User Controls</span>
              <span className="text-gray-400 text-xs font-medium">Global Account Actions</span>
            </div>
            <textarea 
              value={userModReason} onChange={(e) => setUserModReason(e.target.value)} placeholder="Type official warning or ban reason here..."
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-red-500 placeholder-gray-500 mb-3 outline-none" rows={2}
            />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => handleUserModerate('warn')} disabled={isUserModerating} className="px-4 py-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500 hover:text-white border border-yellow-500/50 rounded-lg text-xs font-bold transition-all">⚠️ Warn Only</button>
              <button onClick={() => handleUserModerate('ban')} disabled={isUserModerating} className="px-4 py-2 bg-orange-500/10 text-orange-500 hover:bg-orange-500 hover:text-white border border-orange-500/50 rounded-lg text-xs font-bold transition-all">🛑 Warn + Ban</button>
              <button onClick={() => handleUserModerate('restore')} disabled={isUserModerating} className="px-4 py-2 bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white border border-green-500/50 rounded-lg text-xs font-bold transition-all">✅ Restore</button>
              <button onClick={() => handleUserModerate('nuke')} disabled={isUserModerating} className="px-4 py-2 bg-red-600/10 text-red-600 hover:bg-red-600 hover:text-white border border-red-600/50 rounded-lg text-xs font-bold transition-all sm:ml-auto">☢️ Nuke</button>
            </div>
          </div>
        )}

        {/* 🚨 CORRECTED: Removed the '&& roomStatus !== resolved' condition here! */}
        {isAdmin && isSupport && roomDetails?.listing_id && !isDirectUserTicket && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl shadow-sm">
             <h3 className="text-red-800 font-black flex items-center gap-2 mb-3 text-sm">🛡️ Item Moderation</h3>
             {!modAction ? (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setModAction('warn')} className="px-4 py-2 bg-yellow-100 text-yellow-800 font-bold text-xs rounded-xl border border-yellow-200 hover:bg-yellow-200 transition">🟡 Warn Only</button>
                <button onClick={() => setModAction('hide')} className="px-4 py-2 bg-orange-100 text-orange-800 font-bold text-xs rounded-xl border border-orange-200 hover:bg-orange-200 transition">🟠 Warn + Hide</button>
                <button onClick={() => setModAction('delete')} className="px-4 py-2 bg-red-600 text-white font-bold text-xs rounded-xl hover:bg-red-700 transition">🔴 Nuke Item</button>
                <button onClick={() => setModAction('restore')} className="px-4 py-2 bg-green-100 text-green-800 font-bold text-xs rounded-xl border border-green-200 hover:bg-green-200 transition">🟢 Restore Item</button>
              </div>
            ) : (
              <form onSubmit={handleModerate} className="flex flex-col gap-2">
                <span className="text-xs font-bold text-gray-700 uppercase">Action: {modAction}</span>
                <div className="flex gap-2">
                  <input type="text" required autoFocus placeholder={`Type reason for ${modAction}...`} value={modReason} onChange={(e) => setModReason(e.target.value)} className="flex-1 p-2 text-sm bg-white border border-red-200 rounded-lg outline-none focus:ring-2 focus:ring-red-500" />
                  <button type="button" onClick={() => setModAction(null)} className="px-4 py-2 bg-gray-200 text-gray-700 text-xs font-bold rounded-lg hover:bg-gray-300">Cancel</button>
                  <button type="submit" disabled={isModerating} className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 disabled:opacity-50">{isModerating ? 'Executing...' : 'Execute'}</button>
                </div>
              </form>
            )}
          </div>
        )}

        {messages.map((msg: any, index) => {
          const isMe = msg.sender_id === profile?.uid;
          const isSystem = msg.sender_id === 'ADMIN_SYSTEM' || msg.is_system_message;
          const canDelete = isMe || isAdmin; 
          const isSelected = selectedMessages.includes(msg.id?.toString());

          if (isSystem) {
            return (
              <div key={msg.id || index} className="flex justify-center my-6 w-full">
                <div className="bg-red-900/10 border border-red-500/30 px-6 py-4 rounded-xl max-w-[90%] sm:max-w-[70%] text-center shadow-sm">
                  <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-2 flex justify-center items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    Official Admin Action
                  </p>
                  <p className="text-sm font-bold text-gray-800 whitespace-pre-wrap">{msg.text}</p>
                  <span className="text-[10px] text-gray-400 mt-2 block font-medium">
                    {formatTime(msg.created_at || msg.timestamp)}
                  </span>
                </div>
              </div>
            );
          }
          
          return (
            <div key={msg.id || index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} my-1`}>
              <div className={`flex items-center gap-2 max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                
                {isSelectionMode && canDelete && (
                  <input 
                    type="checkbox" 
                    checked={isSelected}
                    onChange={() => toggleMessageSelection(msg.id)}
                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer flex-shrink-0"
                  />
                )}

                <div 
                  onClick={() => {
                    if (isSelectionMode && canDelete) toggleMessageSelection(msg.id);
                  }}
                  className={`p-4 rounded-2xl shadow-sm transition-all ${
                    isMe ? 'bg-blue-600 text-white rounded-br-none' : (isSupport ? 'bg-gray-800 text-white rounded-bl-none' : 'bg-white text-gray-800 border rounded-bl-none')
                  } ${isSelectionMode && canDelete ? 'cursor-pointer hover:opacity-90 ' + (isSelected ? 'ring-4 ring-red-400' : '') : ''}`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.text || "..."}</p>
                  
                  {!isSupport && msg.is_bid && msg.bid_amount && (
                    <div className={`mt-3 p-3 rounded-xl border ${isMe ? 'bg-blue-700/50 border-blue-400' : 'bg-green-50 border-green-200'}`}>
                      <div className="flex items-center justify-between gap-6">
                        <div><span className="text-[10px] font-bold uppercase opacity-70">Official Bid</span><p className="text-lg font-black">₹{msg.bid_amount}</p></div>
                        {!isMe && msg.status !== 'accepted' && roomStatus === 'active' && !isSelectionMode && (
                          <button onClick={(e) => { e.stopPropagation(); handleAccept(msg.id); }} className="px-4 py-2 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition">Accept</button>
                        )}
                        {msg.status === 'accepted' && <span className="text-xs font-black text-green-500 uppercase">Accepted ✓</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-gray-400 mt-1 mx-1 font-medium">{formatTime(msg.created_at || msg.timestamp)}</span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div className="p-4 bg-white border-t">
        {roomStatus === 'sold' || roomStatus === 'resolved' ? (
          <div className="py-4 px-6 bg-gray-100 border border-gray-200 rounded-2xl text-center">
            <p className="text-gray-500 font-bold text-sm">
              {roomStatus === 'sold' ? '🎉 Deal finalized. Chat closed.' : '🛡️ Ticket resolved. Chat closed.'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSendMessage} className="space-y-3">
             {!isSupport && (
               <div className="flex items-center gap-2 px-1">
                  <input type="checkbox" id="bid" checked={isBidding} onChange={(e) => setIsBidding(e.target.checked)} disabled={isSelectionMode} className="rounded cursor-pointer" />
                  <label htmlFor="bid" className="text-xs font-bold text-gray-600 cursor-pointer select-none">Make an Official Bid</label>
               </div>
             )}
             <div className="flex gap-2">
                {isBidding && !isSupport && (
                  <input type="number" placeholder="₹" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} disabled={isSelectionMode} className="w-24 p-3 bg-gray-100 rounded-xl font-bold border-transparent outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
                )}
                <input type="text" placeholder={isSelectionMode ? "Exit selection mode to type..." : (isBidding ? "Add a note..." : "Type message...")} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} disabled={isSelectionMode} className="flex-1 p-3 bg-gray-100 rounded-xl border-transparent outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
                <button type="submit" disabled={isSelectionMode || (!newMessage.trim() && (!bidAmount && isBidding))} className="p-3 bg-blue-600 text-white font-bold rounded-xl px-6 disabled:opacity-50">Send</button>
             </div>
          </form>
        )}
      </div>
    </div>
  );
}