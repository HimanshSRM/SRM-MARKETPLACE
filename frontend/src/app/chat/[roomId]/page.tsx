'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { collection, query, orderBy, onSnapshot, doc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase'; 
import { getChatMessages, sendMessage, acceptBid, resolveSupportTicket, moderateListing, moderateUser, ChatMessage, deleteChatMessages, revertDeal, saveChatContactInfo } from '@/lib/api';
import { QRCodeSVG } from 'qrcode.react';

export default function ChatRoomPage() {
  const router = useRouter();
  const params = useParams();
  const roomId = params.roomId as string;
  const { profile, isLoading: isAuthLoading } = useAuth();
  
  // --- CORE DATA STATES ---
  const [roomDetails, setRoomDetails] = useState<any>(null);
  const [poolDetails, setPoolDetails] = useState<any>(null); 
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roomStatus, setRoomStatus] = useState<'open' | 'locked' | 'delivered' | 'active' | 'sold' | 'resolved'>('active');
  const [isLoading, setIsLoading] = useState(true);

  // --- SHOP & METADATA STATES ---
  const [quickReplies, setQuickReplies] = useState<any[]>([]);
  const [shopPhone, setShopPhone] = useState<string | null>(null);

  // --- PAYMENT MODALS STATES ---
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [showP2PUpiModal, setShowP2PUpiModal] = useState(false); 
  const [p2pUpiId, setP2pUpiId] = useState(''); 

  // --- CHAT INPUT STATES ---
  const [pendingMessages, setPendingMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isBidding, setIsBidding] = useState(false);
  const [bidAmount, setBidAmount] = useState('');

  // --- MARKETPLACE POST-DEAL STATES ---
  const [contactPhoneInput, setContactPhoneInput] = useState('');
  const [contactUpiInput, setContactUpiInput] = useState('');
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  // --- MODERATION STATES ---
  const [modAction, setModAction] = useState<'warn' | 'hide' | 'delete' | 'restore' |null>(null);
  const [modReason, setModReason] = useState('');
  const [userModReason, setUserModReason] = useState('');
  const [isModerating, setIsModerating] = useState(false);
  const [isUserModerating, setIsUserModerating] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };

  useEffect(() => { if (!isSelectionMode) scrollToBottom(); }, [messages, pendingMessages, isSelectionMode]);

  // Sync profile defaults to inputs if room details are missing
  useEffect(() => {
    if (profile) {
      if (!contactUpiInput && profile.upi_id) setContactUpiInput(profile.upi_id);
      if (!contactPhoneInput && profile.phone) setContactPhoneInput(profile.phone);
    }
  }, [profile, contactUpiInput, contactPhoneInput]);

  // --- LOCAL STORAGE DRAFTS ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMsg = localStorage.getItem(`draft_msg_${roomId}`);
      if (savedMsg) setNewMessage(savedMsg);
      const savedBid = localStorage.getItem(`draft_bid_${roomId}`);
      if (savedBid) setBidAmount(savedBid);
      const savedIsBidding = localStorage.getItem(`draft_isBidding_${roomId}`);
      if (savedIsBidding === 'true') setIsBidding(true);
      
      const savedMod = localStorage.getItem(`draft_modReason_${roomId}`);
      if (savedMod) setModReason(savedMod);
      const savedUserMod = localStorage.getItem(`draft_userModReason_${roomId}`);
      if (savedUserMod) setUserModReason(savedUserMod);
    }
  }, [roomId]);

  useEffect(() => { localStorage.setItem(`draft_msg_${roomId}`, newMessage); }, [newMessage, roomId]);
  useEffect(() => { localStorage.setItem(`draft_bid_${roomId}`, bidAmount); }, [bidAmount, roomId]);
  useEffect(() => { localStorage.setItem(`draft_isBidding_${roomId}`, isBidding.toString()); }, [isBidding, roomId]);
  useEffect(() => { localStorage.setItem(`draft_modReason_${roomId}`, modReason); }, [modReason, roomId]);
  useEffect(() => { localStorage.setItem(`draft_userModReason_${roomId}`, userModReason); }, [userModReason, roomId]);

  // --- HELPERS ---
  const formatTime = (dateString?: string) => {
    if (!dateString) return 'Just now'; 
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'Just now'; 
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderTextWithLinks = (text: string) => {
    if (!text) return "...";
    const urlRegex = /(https?:\/\/[^\s]+|upi:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, i) => {
      if (part.match(urlRegex)) {
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 underline break-all font-bold" onClick={(e) => e.stopPropagation()}>
            {part}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  // --- DATA FETCHING ---
  const loadChatSecurely = async () => {
    try {
      setIsLoading(true);
      const { room } = await getChatMessages(roomId);
      setRoomDetails(room);
    } catch (error) { console.error("Error loading chat:", error); } 
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    if (isAuthLoading || !profile?.uid || !auth.currentUser) { setIsLoading(false); return; }
    loadChatSecurely(); 

    // Messages Listener
    const messagesRef = collection(db, 'chat_rooms', roomId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribeMessages = onSnapshot(q, (snapshot) => {
      const liveMessages: ChatMessage[] = []; 
      let hasAcceptedBid = false;

      snapshot.forEach((document) => {
        const data = document.data();
        if (data.status === 'accepted' || data.bid_status === 'accepted') hasAcceptedBid = true;

        liveMessages.push({
          id: document.id,
          ...data,
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp,
          created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at,
        } as ChatMessage); 
      });

      setMessages((prev: ChatMessage[]) => {
        if (prev.length !== liveMessages.length) setTimeout(scrollToBottom, 100);
        return liveMessages;
      });

      if (hasAcceptedBid) setRoomStatus('sold');
    });

    // Chat Room Listener
    const roomRef = doc(db, 'chat_rooms', roomId);
    const unsubscribeRoom = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setRoomDetails((prev: any) => (prev ? { ...prev, ...data } : data)); 

        if (data.type !== 'group_order') {
          if (data.status === 'resolved') setRoomStatus('resolved');
          if (data.status === 'sold') setRoomStatus('sold');
          else { setRoomStatus('active'); setIsEditingContact(false); } // Revert status
        }
      }
    });

    return () => { unsubscribeMessages(); unsubscribeRoom(); };
  }, [roomId, profile, isAuthLoading]); 

  // Cart Pool Document Listener
  useEffect(() => {
    if (roomDetails?.type === 'group_order' && roomDetails?.pool_id) {
      const poolRef = doc(db, 'group_orders', roomDetails.pool_id);
      const unsubscribePool = onSnapshot(poolRef, (docSnap) => {
        if (docSnap.exists()) {
          setPoolDetails(docSnap.data());
        }
      });
      return () => unsubscribePool();
    }
  }, [roomDetails?.pool_id, roomDetails?.type]);

  // Shop Info Listener
  useEffect(() => {
    if (roomDetails?.shop_id) {
      const shopRef = doc(db, 'shops', roomDetails.shop_id);
      const unsubscribe = onSnapshot(shopRef, (docSnap) => {
        if (docSnap.exists()) {
          const shopData = docSnap.data();
          setQuickReplies(shopData.quick_replies || []);
          setShopPhone(shopData.contact_number || null);
        }
      });
      return () => unsubscribe();
    }
  }, [roomDetails?.shop_id]);

  // --- PERMISSIONS ---
  const isBanned = profile?.role === 'banned';
  const isAdminThread = roomDetails?.seller_id === 'ADMIN_TEAM';
  const canChat = !isBanned || isAdminThread;

  const isSupport = roomDetails?.is_ticket === true || roomDetails?.is_ticket === 'true' || roomDetails?.is_ticket === 'True' || isAdminThread;
  const isAdmin = profile?.role === 'admin';
  const isDirectUserTicket = roomDetails?.listing_id === 'USER_MODERATION';
  
  const isGroupOrder = roomDetails?.type === 'group_order';
  const amIHost = isGroupOrder && (poolDetails?.host_id === profile?.uid || roomDetails?.host_id === profile?.uid);

  const acceptedBidMsg = messages.find(m => m.status === 'accepted' || m.bid_status === 'accepted');
  const finalDealPrice = acceptedBidMsg?.bid_amount || 0;
  const amIBuyer = roomDetails?.buyer_id === profile?.uid;
  
  // Dynamic Phone Number Selector
  const sellerPhone = shopPhone || roomDetails?.seller_phone || roomDetails?.contact_number;
  const buyerPhone = roomDetails?.buyer_phone;
  const otherPersonPhone = amIBuyer ? sellerPhone : buyerPhone; 

  // --- HANDLERS ---
  const handleSendMessage = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    if (roomStatus === 'resolved') return; 
    if (!canChat || !profile?.uid) return;

    const textToSend = overrideText || newMessage || `Bid: ₹${bidAmount}`;
    const isBidToSend = isBidding && !overrideText;
    const bidAmountToSend = isBidToSend ? parseFloat(bidAmount) : undefined;
    
    if (!textToSend.trim() && !isBidToSend) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: tempId, sender_id: profile.uid, text: textToSend, is_bid: isBidToSend, bid_amount: bidAmountToSend,
      timestamp: new Date().toISOString(), isPending: true, 
    };

    setPendingMessages(prev => [...prev, optimisticMsg]);
    setTimeout(scrollToBottom, 50);

    if (!overrideText) {
      setNewMessage(''); setIsBidding(false); setBidAmount('');
      localStorage.removeItem(`draft_msg_${roomId}`);
      localStorage.removeItem(`draft_bid_${roomId}`);
      localStorage.removeItem(`draft_isBidding_${roomId}`);
    }

    try {
      await sendMessage(roomId, profile.uid, textToSend, isBidToSend, bidAmountToSend);
      setPendingMessages(prev => prev.filter(m => m.id !== tempId));
    } catch (error) {
      setPendingMessages(prev => prev.filter(m => m.id !== tempId));
      if (!overrideText) setNewMessage(textToSend); 
      alert("Failed to send message.");
    }
  };

  const toggleMessageSelection = (messageId: string | number) => {
    const idStr = messageId.toString();
    setSelectedMessages(prev => prev.includes(idStr) ? prev.filter(id => id !== idStr) : [...prev, idStr]);
  };

  const handleDeleteSelected = async () => {
    if (selectedMessages.length === 0) return;
    if (!window.confirm(`Are you sure you want to permanently delete ${selectedMessages.length} message(s)?`)) return;
    try {
      await deleteChatMessages(roomId, selectedMessages);
      setSelectedMessages([]); setIsSelectionMode(false);
    } catch (error: any) { alert(error.message || "Failed to delete messages."); }
  };

  const handleAccept = async (messageId: string | number) => {
    if (isBanned) { alert("Suspended accounts cannot accept bids."); return; }
    if (!confirm("Are you sure? This will mark the item as SOLD and securely exchange contact information.")) return;
    try { await acceptBid(roomId, messageId); } catch (error) { alert("Error accepting bid."); }
  };

  const handleResolveTicket = async () => {
    if (!confirm("Mark this support ticket as resolved?")) return;
    try { await resolveSupportTicket(roomId); alert("Ticket resolved successfully."); } 
    catch (error) { alert("Failed to resolve ticket."); }
  };

  const handleModerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modAction || !modReason.trim() || !roomDetails?.listing_id) return;
    if (!confirm(`Are you sure you want to ${modAction.toUpperCase()} this listing?`)) return;
    try {
      setIsModerating(true);
      await moderateListing(roomDetails.listing_id, modAction, modReason, roomDetails.shop_id);
      setModAction(null); setModReason(''); localStorage.removeItem(`draft_modReason_${roomId}`);
      alert(`Action '${modAction}' executed successfully!`);
    } catch (error: any) { alert(error.message || "Failed to moderate listing."); } 
    finally { setIsModerating(false); }
  };

  const handleUserModerate = async (action: 'warn' | 'ban' | 'restore' | 'nuke') => {
    if (userModReason.length < 10) { alert("Please provide a reason for the audit log."); return; }
    const targetUid = roomDetails?.buyer_id === 'ADMIN_TEAM' ? roomDetails?.seller_id : roomDetails?.buyer_id;
    if (!targetUid) { alert("Error: Cannot determine target user."); return; }
    if (action === 'nuke' && !confirm("WARNING: This will permanently delete the user. Proceed?")) return;
    if (action === 'ban' && !confirm("This will lock the user out of their account. Proceed?")) return;
    try {
      setIsUserModerating(true);
      await moderateUser(targetUid, action, userModReason, roomId);
      if (action === 'nuke') await resolveSupportTicket(roomId);
      setUserModReason(""); localStorage.removeItem(`draft_userModReason_${roomId}`);
    } catch (error: any) { alert(error.message || "Failed to execute moderation action."); } 
    finally { setIsUserModerating(false); }
  };

  const handleBack = () => { if (window.history.length > 2) router.back(); else router.push('/'); };

  // --- RENDER LOGIC PRE-CHECKS ---
  if (isAuthLoading || isLoading) return <div className="h-[100dvh] flex items-center justify-center font-bold text-gray-500">Loading Chat...</div>;
  if (!profile || profile.role === 'guest') return <div className="h-[100dvh] flex items-center justify-center font-bold text-red-500">Access Denied. Please Log In.</div>;

  // Group Order Computed Values
  let currentGroupStatus = 'open';
  if (isGroupOrder) {
    if (poolDetails?.status) {
      currentGroupStatus = poolDetails.status;
    } else {
      const latestSys = messages.slice().reverse().find(m => m.sender_id === 'system');
      if (latestSys) {
        if (latestSys.text.includes("Locked")) currentGroupStatus = 'locked';
        if (latestSys.text.includes("ARRIVED")) currentGroupStatus = 'delivered';
      }
    }
  }

  const appName = poolDetails?.app_name || roomDetails?.app_name || 'Group';
  const pickupLoc = poolDetails?.pickup_location || roomDetails?.pickup_location;
  const hostName = poolDetails?.host_name || roomDetails?.host_name || 'Host';
  const upiId = poolDetails?.upi_id || roomDetails?.upi_id;
  const cartLink = poolDetails?.cart_link || roomDetails?.cart_link;
  
  const myParticipantData = isGroupOrder && poolDetails ? poolDetails.participants?.find((p: any) => p.user_id === profile?.uid) : null;
  let myFinalAmount = 0;
  if (myParticipantData) {
    const fee = poolDetails?.delivery_fee || 0;
    const totalPeople = (poolDetails?.participants?.length || 0) + 1; 
    const feePerPerson = fee / totalPeople;
    myFinalAmount = Math.ceil(myParticipantData.total_estimated_price + feePerPerson);
  }

  const upiRemark = encodeURIComponent(`Cart Pool - ${appName}`);
  const upiString = upiId ? `upi://pay?pa=${upiId}&pn=${encodeURIComponent(hostName)}&am=${myFinalAmount}&cu=INR&tn=${upiRemark}` : '';

  const allDisplayMessages = [...messages, ...pendingMessages];

  // 🚨 UI FIX: h-[100dvh] max-h-[100dvh] entirely locks the layout to the viewport to prevent the input from hiding.
  return (
    <div className="flex flex-col h-[100dvh] max-h-[100dvh] w-full overflow-hidden bg-gray-50 max-w-2xl mx-auto shadow-2xl relative">
      
      {/* ========================================= */}
      {/* 1A. CART POOL UPI MODAL                   */}
      {/* ========================================= */}
      {showUpiModal && isGroupOrder && upiId && myParticipantData && myFinalAmount > 0 && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl relative flex flex-col items-center text-center animate-fade-in-up">
            <button onClick={() => setShowUpiModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-800 transition">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-inner">💸</div>
            <h3 className="text-2xl font-black text-gray-900 mb-1">Pay the Host</h3>
            <p className="text-sm font-medium text-gray-500 mb-6">Scan or tap to open your UPI app</p>
            
            <div className="p-4 bg-white border-2 border-gray-100 rounded-3xl shadow-sm mb-6">
              <QRCodeSVG value={upiString} size={180} level="H" />
            </div>
            
            <div className="w-full bg-gray-50 rounded-2xl p-4 mb-6 border border-gray-200">
               <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Amount Due</span>
                  <span className="font-black text-purple-700 text-lg">₹{myFinalAmount}</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Host UPI</span>
                 <div className="flex items-center gap-2">
                   <span className="font-bold text-gray-900 tracking-wide text-xs truncate max-w-[140px]">{upiId}</span>
                   <button onClick={() => { navigator.clipboard.writeText(upiId); alert("Copied!"); }} className="text-purple-600 bg-purple-100 hover:bg-purple-200 p-1.5 rounded-lg transition" title="Copy">
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                   </button>
                 </div>
               </div>
            </div>
            
            <button onClick={() => { window.location.href = upiString; if (window.innerWidth > 768) alert("UPI Apps are only available on mobile devices. Please scan the QR code with your phone instead."); }} className="w-full py-4 bg-purple-600 text-white font-black uppercase tracking-widest rounded-xl hover:bg-purple-700 transition active:scale-95 shadow-sm">
              Open UPI App
            </button>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 1B. MARKETPLACE P2P PAYMENT MODAL         */}
      {/* ========================================= */}
      {showP2PUpiModal && roomStatus === 'sold' && !isGroupOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl relative flex flex-col items-center text-center animate-fade-in-up">
              <button onClick={() => setShowP2PUpiModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-800 transition">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center text-3xl mb-4 shadow-inner">🤝</div>
              <h3 className="text-2xl font-black text-gray-900 mb-1">Pay the Seller</h3>
              <p className="text-sm font-medium text-gray-500 mb-6">Confirm or enter their UPI ID below to generate the payment code.</p>
              
              <input 
                type="text" 
                placeholder="e.g. 9876543210@ybl" 
                value={p2pUpiId} 
                onChange={(e) => setP2pUpiId(e.target.value.toLowerCase())} 
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-center font-bold mb-4 outline-none focus:ring-2 focus:ring-blue-500" 
              />

              {p2pUpiId ? (
                <>
                  <div className="p-4 bg-white border-2 border-gray-100 rounded-3xl shadow-sm mb-6">
                    <QRCodeSVG value={`upi://pay?pa=${p2pUpiId}&pn=MarketplaceSeller&am=${finalDealPrice}&cu=INR`} size={180} level="H" />
                  </div>
                  <button onClick={() => { window.location.href = `upi://pay?pa=${p2pUpiId}&pn=MarketplaceSeller&am=${finalDealPrice}&cu=INR`; if (window.innerWidth > 768) alert("Please scan the QR code with your phone instead."); }} className="w-full py-4 bg-blue-600 text-white font-black uppercase tracking-widest rounded-xl hover:bg-blue-700 transition active:scale-95 shadow-sm">
                    Open UPI App
                  </button>
                </>
              ) : (
                <div className="w-full py-4 bg-gray-100 text-gray-400 font-black uppercase tracking-widest rounded-xl cursor-not-allowed">Enter UPI ID to Pay</div>
              )}
            </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 2. CHAT HEADER                          */}
      {/* ========================================= */}
      <div className="p-4 border-b flex items-center justify-between bg-white shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="p-2 hover:bg-gray-100 rounded-full transition">
            <svg className="w-6 h-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h2 className="font-black text-gray-900 line-clamp-1">
              {isGroupOrder ? `${appName} Group Order` : (isSupport ? roomDetails?.subject || 'Support Ticket' : roomDetails?.listing_title || 'Negotiation')}
            </h2>
            <p className="text-xs font-medium text-gray-500">
              {isGroupOrder ? `Pickup: ${pickupLoc}` : (isSupport ? 'Campus Support' : 'Marketplace Chat')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Marketplace: WhatsApp Shop Connect */}
          {!isSelectionMode && shopPhone && !isSupport && !isGroupOrder && (
            <a 
              href={`https://wa.me/${shopPhone.replace(/\D/g, '').startsWith('91') ? shopPhone.replace(/\D/g, '') : '91' + shopPhone.replace(/\D/g, '')}`} 
              target="_blank" rel="noopener noreferrer" 
              className="p-2 bg-green-50 text-green-600 hover:bg-green-100 rounded-full transition-colors flex items-center justify-center" 
              title="Open in WhatsApp"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            </a>
          )}

          {/* Delete Message Selection */}
          {isSelectionMode ? (
            <>
              <button onClick={() => { setIsSelectionMode(false); setSelectedMessages([]); }} className="px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 transition">Cancel</button>
              <button onClick={handleDeleteSelected} disabled={selectedMessages.length === 0} className="px-4 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-red-700 disabled:opacity-50 transition flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                Delete ({selectedMessages.length})
              </button>
            </>
          ) : (
            !isBanned && !isSupport && !isGroupOrder && (
              <button onClick={() => setIsSelectionMode(true)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition" title="Select messages to delete">
                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" /></svg>
              </button>
            )
          )}

          {/* Admin Support Resolution */}
          {!isSelectionMode && isSupport && roomStatus === 'resolved' && <div className="px-4 py-1 bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-sm">Resolved</div>}
          {!isSelectionMode && isSupport && isAdmin && roomStatus !== 'resolved' && (
            <button onClick={handleResolveTicket} className="px-4 py-1.5 bg-gray-900 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-gray-800 transition">Resolve</button>
          )}
        </div>
      </div>

      {/* ========================================= */}
      {/* 3. CART POOL TRACKER DASHBOARD            */}
      {/* ========================================= */}
      {isGroupOrder && (
        <div className="bg-white border-b shadow-sm z-10 flex flex-col shrink-0">
          <div className="px-8 py-3 flex justify-between items-center text-xs font-bold">
            <div className={`flex flex-col items-center transition-colors duration-300 ${currentGroupStatus === 'open' ? 'text-purple-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 shadow-sm ${currentGroupStatus === 'open' ? 'bg-purple-100 ring-2 ring-purple-500' : 'bg-gray-100'}`}>🛒</div>
              <span>Open</span>
            </div>
            <div className={`flex-1 h-1 mx-2 mt-[-15px] rounded-full ${currentGroupStatus !== 'open' ? 'bg-orange-400' : 'bg-gray-100'}`}></div>
            <div className={`flex flex-col items-center transition-colors duration-300 ${currentGroupStatus === 'locked' ? 'text-orange-500' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 shadow-sm ${currentGroupStatus === 'locked' ? 'bg-orange-100 ring-2 ring-orange-500' : 'bg-gray-100'}`}>🔒</div>
              <span>Ordered</span>
            </div>
            <div className={`flex-1 h-1 mx-2 mt-[-15px] rounded-full ${currentGroupStatus === 'delivered' ? 'bg-green-400' : 'bg-gray-100'}`}></div>
            <div className={`flex flex-col items-center transition-colors duration-300 ${currentGroupStatus === 'delivered' ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 shadow-sm ${currentGroupStatus === 'delivered' ? 'bg-green-100 ring-2 ring-green-500' : 'bg-gray-100'}`}>🛎️</div>
              <span>Arrived</span>
            </div>
          </div>
          
          <div className="px-4 py-3 bg-gray-50 flex flex-wrap gap-2 items-center justify-between border-t border-gray-100">
            {cartLink && (
              <a href={cartLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-xs font-bold rounded-xl hover:bg-gray-50 transition shadow-sm flex-1 justify-center sm:flex-none">
                <span>🛍️</span> Open {appName} Link
              </a>
            )}
            
            {upiId && !amIHost && myParticipantData && (currentGroupStatus === 'locked' || currentGroupStatus === 'delivered') && (
              <button onClick={() => setShowUpiModal(true)} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-xl hover:bg-purple-700 transition shadow-sm flex-1 justify-center sm:flex-none">
                <span>💸</span> Pay ₹{myFinalAmount} via UPI
              </button>
            )}

            {amIHost && currentGroupStatus === 'open' && cartLink && (
              <button 
                onClick={() => handleSendMessage(undefined, `Hey everyone! Please add your items to this link: ${cartLink}`)} 
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold rounded-xl hover:bg-blue-100 transition shadow-sm flex-1 justify-center sm:flex-none"
              >
                📢 Send Link to Chat
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 4. CHAT FEED & MODERATION PANELS          */}
      {/* ========================================= */}
      {/* 🚨 THE FIX: min-h-0 prevents flexbox overflowing out of the viewport */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4 bg-gray-50/50">
        
        {/* Support Ticket Badge */}
        {isSupport && (
          <div className="text-center my-4">
            <span className="px-3 py-1 bg-gray-200 text-gray-600 text-[10px] font-black uppercase rounded-full tracking-wider">Secure Support Channel</span>
          </div>
        )}

        {/* Admin Target User Moderation Block */}
        {isAdmin && isSupport && isDirectUserTicket && (
          <div className="mb-6 bg-gray-900 rounded-3xl p-5 shadow-lg border border-gray-800">
            <div className="flex items-center gap-2 mb-3">
              <span className="bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest">Target User Controls</span>
              <span className="text-gray-400 text-xs font-medium">Global Account Actions</span>
            </div>
            <textarea value={userModReason} onChange={(e) => setUserModReason(e.target.value)} placeholder="Type official warning or ban reason here..." className="w-full bg-gray-800 text-white border border-gray-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-red-500 placeholder-gray-500 mb-3 outline-none" rows={2} />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => handleUserModerate('warn')} disabled={isUserModerating} className="px-4 py-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500 hover:text-white border border-yellow-500/50 rounded-xl text-xs font-bold transition-all">⚠️ Warn Only</button>
              <button onClick={() => handleUserModerate('ban')} disabled={isUserModerating} className="px-4 py-2 bg-orange-500/10 text-orange-500 hover:bg-orange-500 hover:text-white border border-orange-500/50 rounded-xl text-xs font-bold transition-all">🛑 Warn + Ban</button>
              <button onClick={() => handleUserModerate('restore')} disabled={isUserModerating} className="px-4 py-2 bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white border border-green-500/50 rounded-xl text-xs font-bold transition-all">✅ Restore</button>
              <button onClick={() => handleUserModerate('nuke')} disabled={isUserModerating} className="px-4 py-2 bg-red-600/10 text-red-600 hover:bg-red-600 hover:text-white border border-red-600/50 rounded-xl text-xs font-bold transition-all sm:ml-auto">☢️ Nuke</button>
            </div>
          </div>
        )}

        {/* Admin Item Moderation Block */}
        {isAdmin && isSupport && roomDetails?.listing_id && !isDirectUserTicket && (
          <div className="mb-6 p-5 bg-red-50 border border-red-200 rounded-3xl shadow-sm">
             <h3 className="text-red-800 font-black flex items-center gap-2 mb-3 text-sm">🛡️ Item Moderation</h3>
             {!modAction ? (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setModAction('warn')} className="px-4 py-2 bg-yellow-100 text-yellow-800 font-bold text-xs rounded-xl border border-yellow-200 hover:bg-yellow-200 transition">🟡 Warn Only</button>
                <button onClick={() => setModAction('hide')} className="px-4 py-2 bg-orange-100 text-orange-800 font-bold text-xs rounded-xl border border-orange-200 hover:bg-orange-200 transition">🟠 Warn + Hide</button>
                <button onClick={() => setModAction('delete')} className="px-4 py-2 bg-red-600 text-white font-bold text-xs rounded-xl hover:bg-red-700 transition shadow-sm">🔴 Nuke Item</button>
                <button onClick={() => setModAction('restore')} className="px-4 py-2 bg-green-100 text-green-800 font-bold text-xs rounded-xl border border-green-200 hover:bg-green-200 transition">🟢 Restore Item</button>
              </div>
            ) : (
              <form onSubmit={handleModerate} className="flex flex-col gap-2">
                <span className="text-xs font-bold text-gray-700 uppercase">Action: {modAction}</span>
                <div className="flex gap-2">
                  <input type="text" required autoFocus placeholder={`Type reason for ${modAction}...`} value={modReason} onChange={(e) => setModReason(e.target.value)} className="flex-1 p-3 text-sm bg-white border border-red-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500 shadow-sm" />
                  <button type="button" onClick={() => setModAction(null)} className="px-5 py-3 bg-gray-200 text-gray-700 text-xs font-bold rounded-xl hover:bg-gray-300 transition">Cancel</button>
                  <button type="submit" disabled={isModerating} className="px-5 py-3 bg-red-600 text-white text-xs font-bold rounded-xl hover:bg-red-700 disabled:opacity-50 shadow-sm transition">{isModerating ? 'Executing...' : 'Execute'}</button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Message Rendering */}
        {allDisplayMessages.map((msg: any, index) => {
          const isMe = msg.sender_id === profile?.uid;
          const canDelete = isMe || isAdmin; 
          const isSelected = selectedMessages.includes(msg.id?.toString());
          
          const isBotMessage = msg.sender_id === 'system';
          const isAdminAction = msg.sender_id === 'ADMIN_SYSTEM' || (msg.is_system_message && !isBotMessage);

          if (isBotMessage) {
            return (
              <div key={msg.id || index} className="flex justify-center my-4 w-full">
                <div className="px-5 py-2 bg-gray-200/60 border border-gray-200 rounded-full shadow-sm text-center">
                  <p className="text-xs font-bold text-gray-600 whitespace-pre-wrap">{msg.text}</p>
                  <span className="text-[9px] font-medium text-gray-400 block mt-0.5">{formatTime(msg.created_at || msg.timestamp)}</span>
                </div>
              </div>
            );
          }

          if (isAdminAction) {
            return (
              <div key={msg.id || index} className="flex justify-center my-6 w-full">
                <div className="bg-red-900/10 border border-red-500/30 px-6 py-4 rounded-2xl max-w-[90%] sm:max-w-[70%] text-center shadow-sm">
                  <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-2 flex justify-center items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
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
              {!isMe && msg.sender_name && (
                <span className="text-[10px] text-gray-400 mb-1 ml-2 font-bold tracking-wide">{msg.sender_name}</span>
              )}

              <div className={`flex items-center gap-2 max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                {isSelectionMode && canDelete && !isBanned && !msg.isPending && (
                  <input type="checkbox" checked={isSelected} onChange={() => toggleMessageSelection(msg.id)} className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer flex-shrink-0" />
                )}

                <div 
                  onClick={() => { if (isSelectionMode && canDelete && !isBanned && !msg.isPending) toggleMessageSelection(msg.id); }}
                  className={`px-5 py-3.5 rounded-3xl shadow-sm transition-all ${
                    isMe ? 'bg-blue-600 text-white rounded-br-sm' : (isSupport ? 'bg-gray-800 text-white rounded-bl-sm' : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm')
                  } ${isSelectionMode && canDelete && !isBanned && !msg.isPending ? 'cursor-pointer hover:opacity-90 ' + (isSelected ? 'ring-4 ring-red-400' : '') : ''} ${msg.isPending ? 'opacity-70' : ''}`}
                >
                  <p className="text-[15px] whitespace-pre-wrap leading-relaxed">
                    {isGroupOrder && msg.text.includes('http') ? (
                      <a href={msg.text.match(/https?:\/\/[^\s]+/)?.[0]} target="_blank" rel="noopener noreferrer" className={`underline font-bold transition ${isMe ? 'text-blue-200 hover:text-white' : 'text-blue-500 hover:text-blue-700'}`}>
                        {msg.text}
                      </a>
                    ) : (
                      renderTextWithLinks(msg.text)
                    )}
                  </p>
                  
                  {/* Bidding UI (Marketplace) */}
                  {!isSupport && !isGroupOrder && msg.is_bid && msg.bid_amount && (
                    <div className={`mt-3 p-4 rounded-2xl border ${isMe ? 'bg-blue-700/50 border-blue-400' : 'bg-green-50 border-green-200'}`}>
                      <div className="flex items-center justify-between gap-6">
                        <div><span className="text-[10px] font-bold uppercase opacity-80 tracking-wider">Official Bid</span><p className="text-xl font-black">₹{msg.bid_amount}</p></div>
                        {!isMe && msg.status !== 'accepted' && msg.bid_status !== 'accepted' && roomStatus === 'active' && !isSelectionMode && !isBanned && !msg.isPending && (
                          <button onClick={(e) => { e.stopPropagation(); handleAccept(msg.id); }} className="px-5 py-2.5 bg-green-600 text-white text-xs font-bold rounded-xl hover:bg-green-700 transition shadow-sm">Accept Deal</button>
                        )}
                        {(msg.status === 'accepted' || msg.bid_status === 'accepted') && <span className="text-xs font-black text-green-500 uppercase tracking-wider">Accepted ✓</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-1 mt-1 mx-2">
                {msg.isPending ? (
                  <span className="text-[10px] text-gray-400 font-bold tracking-wider animate-pulse flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Sending...
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-400 font-medium">{formatTime(msg.created_at || msg.timestamp)}</span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* ========================================= */}
      {/* 5. INPUT FORM & POST-DEAL DASHBOARD       */}
      {/* ========================================= */}
      <div className="p-4 bg-white border-t border-gray-100 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20 shrink-0">
        
        {/* Quick Replies for Shop Chats */}
        {quickReplies.length > 0 && !isSelectionMode && roomStatus !== 'resolved' && canChat && roomDetails?.buyer_id === profile?.uid && (
          <div className="flex gap-2 pb-3 overflow-x-auto scrollbar-hide">
            {quickReplies.map((qr: any, idx: number) => (
              <button
                key={idx} type="button"
                onClick={() => { setNewMessage(qr.trigger); }}
                className="whitespace-nowrap px-4 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-100 hover:bg-blue-100 transition-colors shadow-sm shrink-0"
              >
                {qr.trigger}
              </button>
            ))}
          </div>
        )}

        {/* 🚨 THE PERSISTENT DEAL HUB (For Sold Items) */}
        {roomStatus === 'sold' && !isGroupOrder && (
          <div className="mb-2 p-4 bg-green-50 rounded-2xl border border-green-200 shadow-sm animate-fade-in-up">
            <div className="flex items-center justify-between mb-4 border-b border-green-200/50 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎉</span> 
                <span className="text-green-800 text-sm font-black tracking-wide">Deal finalized for ₹{finalDealPrice}!</span>
              </div>
              
              {/* 🔄 Revert Deal (Seller Only) */}
              {!amIBuyer && (
                <button 
                  onClick={async () => {
                    if (!window.confirm("Are you sure you want to cancel this deal and restore the item to the marketplace?")) return;
                    setIsReverting(true);
                    try { await revertDeal(roomId); } catch(e) { alert("Failed to restore listing."); setIsReverting(false); }
                  }}
                  disabled={isReverting}
                  className="flex items-center gap-1 text-[10px] font-black text-gray-500 hover:text-red-600 transition uppercase tracking-widest disabled:opacity-50"
                >
                  <svg className={`w-3.5 h-3.5 ${isReverting ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  {isReverting ? 'Reverting...' : 'Restore Listing'}
                </button>
              )}
            </div>
            
            {/* --- SELLER'S DEAL HUB --- */}
            {!amIBuyer ? (
              <>
                {/* 1. Contact Info Card (Edit Mode OR Display Mode) */}
                {(!roomDetails?.seller_upi || isEditingContact) ? (
                  <div className="flex flex-col gap-2 w-full mb-3 p-3 bg-white rounded-xl shadow-inner border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Share your UPI ID to get paid:</p>
                    <input type="text" value={contactUpiInput} onChange={(e) => setContactUpiInput(e.target.value)} placeholder="e.g. 9876543210@ybl" className="px-4 py-2.5 text-xs font-bold bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-green-500" />
                    <label className="flex items-center gap-2 mt-1 cursor-pointer">
                      <input type="checkbox" checked={saveAsDefault} onChange={(e) => setSaveAsDefault(e.target.checked)} className="w-3.5 h-3.5 text-green-600 rounded border-gray-300" />
                      <span className="text-[10px] font-bold text-gray-500">Save as my default for future deals</span>
                    </label>
                    <div className="flex gap-2 mt-1">
                      {isEditingContact && roomDetails?.seller_upi && <button onClick={() => setIsEditingContact(false)} className="flex-1 py-2.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-xl">Cancel</button>}
                      <button 
                        disabled={!contactUpiInput || isSavingContact}
                        onClick={async () => {
                          setIsSavingContact(true);
                          try { await saveChatContactInfo(roomId, { upi_id: contactUpiInput, save_as_default: saveAsDefault }); setIsEditingContact(false); } catch(e) { alert("Failed to save."); } finally { setIsSavingContact(false); }
                        }} 
                        className="flex-[2] py-2.5 bg-green-600 text-white text-xs font-bold rounded-xl shadow-sm hover:bg-green-700 disabled:opacity-50"
                      >Save & Request Payment</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center bg-white/50 px-3 py-2 rounded-lg border border-green-200/50 mb-3">
                    <span className="text-[10px] font-bold text-gray-600">Receiving payment at: <strong className="text-gray-900">{roomDetails.seller_upi}</strong></span>
                    <button onClick={() => { setContactUpiInput(roomDetails.seller_upi); setIsEditingContact(true); }} className="text-[10px] font-black text-blue-600 hover:text-blue-800 flex items-center gap-1">✏️ Edit</button>
                  </div>
                )}
                
                {/* 2. Action Buttons (Buyer Contact) */}
                <div className="flex gap-2 w-full">
                  {otherPersonPhone ? (
                    <>
                      <a href={`https://wa.me/91${otherPersonPhone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex-1 py-3 bg-[#25D366] text-white text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center shadow-sm hover:bg-[#1ebd5a] transition active:scale-95">WhatsApp Buyer</a>
                      <a href={`tel:+91${otherPersonPhone.replace(/\D/g, '')}`} className="flex-1 py-3 bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center shadow-sm hover:bg-blue-200 transition active:scale-95">Call Buyer</a>
                    </>
                  ) : (
                    <div className="w-full py-3 bg-green-200/50 text-green-800 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center shadow-sm border border-green-200">
                      🕒 Awaiting Buyer Contact Info...
                    </div>
                  )}
                </div>
              </>
            ) : (
            
            /* --- BUYER'S DEAL HUB --- */
              <>
                {/* 1. Contact Info Card (Edit Mode OR Display Mode) */}
                {(!roomDetails?.buyer_phone || isEditingContact) ? (
                  <div className="flex flex-col gap-2 w-full mb-3 p-3 bg-white rounded-xl shadow-inner border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Share your phone number for pickup:</p>
                    <input type="tel" value={contactPhoneInput} onChange={(e) => setContactPhoneInput(e.target.value)} placeholder="e.g. 9876543210" className="px-4 py-2.5 text-xs font-bold bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-green-500" />
                    <label className="flex items-center gap-2 mt-1 cursor-pointer">
                      <input type="checkbox" checked={saveAsDefault} onChange={(e) => setSaveAsDefault(e.target.checked)} className="w-3.5 h-3.5 text-green-600 rounded border-gray-300" />
                      <span className="text-[10px] font-bold text-gray-500">Save as my default for future deals</span>
                    </label>
                    <div className="flex gap-2 mt-1">
                      {isEditingContact && roomDetails?.buyer_phone && <button onClick={() => setIsEditingContact(false)} className="flex-1 py-2.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-xl">Cancel</button>}
                      <button 
                        disabled={!contactPhoneInput || isSavingContact}
                        onClick={async () => {
                          setIsSavingContact(true);
                          try { await saveChatContactInfo(roomId, { phone: contactPhoneInput, save_as_default: saveAsDefault }); setIsEditingContact(false); } catch(e) { alert("Failed to save."); } finally { setIsSavingContact(false); }
                        }} 
                        className="flex-[2] py-2.5 bg-green-600 text-white text-xs font-bold rounded-xl shadow-sm hover:bg-green-700 disabled:opacity-50"
                      >Save & Share</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center bg-white/50 px-3 py-2 rounded-lg border border-green-200/50 mb-3">
                    <span className="text-[10px] font-bold text-gray-600">Sharing phone: <strong className="text-gray-900">{roomDetails.buyer_phone}</strong></span>
                    <button onClick={() => { setContactPhoneInput(roomDetails.buyer_phone); setIsEditingContact(true); }} className="text-[10px] font-black text-blue-600 hover:text-blue-800 flex items-center gap-1">✏️ Edit</button>
                  </div>
                )}

                {/* 2. Action Buttons (Seller Contact & Pay) */}
                <div className="flex gap-2 w-full">
                  {otherPersonPhone ? (
                    <>
                      <a href={`https://wa.me/91${otherPersonPhone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex-1 py-3 bg-[#25D366] text-white text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center shadow-sm hover:bg-[#1ebd5a] transition active:scale-95">WhatsApp</a>
                      <a href={`tel:+91${otherPersonPhone.replace(/\D/g, '')}`} className="flex-1 py-3 bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center shadow-sm hover:bg-blue-200 transition active:scale-95">Call</a>
                    </>
                  ) : (
                    <div className="flex-1 py-3 bg-gray-100 text-gray-400 text-[10px] font-black uppercase tracking-wider rounded-xl flex items-center justify-center border border-gray-200">Awaiting Seller No.</div>
                  )}
                  <button 
                    onClick={() => {
                      if (roomDetails?.seller_upi) { setP2pUpiId(roomDetails.seller_upi); setShowP2PUpiModal(true); } 
                      else { alert("The seller hasn't added their UPI ID yet."); }
                    }} 
                    className={`flex-[2] py-3 text-white text-[10px] font-black uppercase tracking-wider rounded-xl shadow-sm transition active:scale-95 ${roomDetails?.seller_upi ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-400 cursor-not-allowed'}`}
                  >
                    {roomDetails?.seller_upi ? `💸 Pay ₹${finalDealPrice}` : '🕒 Awaiting Seller UPI'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Input Blocking Logic & The Main Input Form */}
        {roomStatus === 'resolved' ? (
          <div className="py-4 px-6 bg-gray-50 border border-gray-200 rounded-2xl text-center">
            <p className="text-gray-500 font-bold text-sm">🛡️ Ticket resolved. Chat closed.</p>
          </div>
        ) : !canChat ? (
          <div className="py-4 px-6 bg-red-50 border border-red-200 rounded-2xl text-center">
            <p className="text-red-600 font-bold text-sm">🚫 Your account is suspended. You can only reply in official Admin Support threads.</p>
          </div>
        ) : (
          <form onSubmit={(e) => handleSendMessage(e)} className="space-y-3">
             
             {/* Upper Actions Row (Bidding Checkbox & Share Contact Card) */}
             <div className="flex items-center justify-between px-2">
               {/* Bidding Checkbox */}
               {!isSupport && !isGroupOrder && roomStatus !== 'sold' && ( 
                 <div className="flex items-center gap-2">
                    <input type="checkbox" id="bid" checked={isBidding} onChange={(e) => setIsBidding(e.target.checked)} disabled={isSelectionMode} className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer" />
                    <label htmlFor="bid" className="text-xs font-bold text-gray-500 hover:text-gray-700 transition cursor-pointer select-none tracking-wide">MAKE OFFICIAL BID</label>
                 </div>
               )}

               {/* 🚨 NEW: Share Contact Card for Seller (Pre-deal off-app option) */}
               {!isSupport && !isGroupOrder && roomStatus !== 'sold' && !amIBuyer && profile?.phone && (
                 <button 
                   type="button" 
                   onClick={() => handleSendMessage(undefined, `You can reach me directly on WhatsApp: ${profile.phone}`)} 
                   className="text-[10px] font-bold text-gray-500 hover:text-blue-600 transition flex items-center gap-1 bg-gray-100 hover:bg-blue-50 px-2 py-1 rounded-lg"
                 >
                   🪪 Share My Contact
                 </button>
               )}
             </div>
             
             {/* Input Area */}
             <div className="flex gap-2">
                {isBidding && !isSupport && !isGroupOrder && roomStatus !== 'sold' && (
                  <input type="number" placeholder="₹" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} disabled={isSelectionMode} className="w-24 p-3.5 bg-gray-50 border border-gray-200 rounded-2xl font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-all shadow-inner" />
                )}
                
                <input type="text" placeholder={isSelectionMode ? "Exit selection mode to type..." : (isBidding ? "Add a note to your bid..." : "Message...")} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} disabled={isSelectionMode} className="flex-1 p-3.5 bg-gray-50 border border-gray-200 rounded-2xl font-medium outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-all shadow-inner text-[15px]" />
                
                <button type="submit" disabled={isSelectionMode || (!newMessage.trim() && (!bidAmount && isBidding))} className="p-3.5 bg-blue-600 text-white font-bold rounded-2xl px-6 disabled:opacity-50 hover:bg-blue-700 active:scale-95 transition-all shadow-sm">
                  Send
                </button>
             </div>
          </form>
        )}
      </div>
    </div>
  );
}