'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { getActiveGroupOrders, createGroupOrder, joinGroupOrder, updateParticipantCart, updateGroupOrderStatus, kickParticipant, settleGroupOrder, sendMessage, updateParticipantPrice } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

// --- INTERFACES ---
interface PoolItem { item_name: string; quantity: number; estimated_price: number; }
interface Participant { user_id: string; user_name: string; contact_number: string; block?: string; cart_link?: string; items: PoolItem[]; total_estimated_price: number; } 
interface GroupOrder {
  id: string; host_id: string; host_name: string; app_name: string; pickup_location: string; contact_number: string;
  upi_id?: string; cart_link?: string; delivery_fee?: number; 
  status: 'open' | 'locked' | 'delivered' | 'cancelled' | 'settled'; 
  expires_at: string; chat_room_id: string; participants: Participant[]; participant_ids: string[];
}

export default function GroupOrdersTab({ currentUser }: { currentUser: any }) {
  const router = useRouter();
  const { profile } = useAuth(); 
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState<GroupOrder | null>(null); 
  const [showManageModal, setShowManageModal] = useState<GroupOrder | null>(null); 
  
  const [myActivePools, setMyActivePools] = useState<GroupOrder[]>([]);
  const [discoverPools, setDiscoverPools] = useState<GroupOrder[]>([]);
  const [pastPools, setPastPools] = useState<GroupOrder[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);

  const fetchOrders = async (showSpinner = true) => {
    if (showSpinner) setIsLoading(true);
    try {
      const data = await getActiveGroupOrders();
      
      const mine = data.filter((o: GroupOrder) => 
        o.host_id === currentUser.uid || 
        o.participant_ids?.includes(currentUser.uid) || 
        o.participants?.some(p => p.user_id === currentUser.uid)
      );

      // BUCKET 1: Active
      setMyActivePools(mine.filter((o: GroupOrder) => o.status === 'open' || o.status === 'locked'));
      
      // BUCKET 2: Past
      setPastPools(mine.filter((o: GroupOrder) => o.status === 'delivered' || o.status === 'cancelled' || o.status === 'settled'));

      // BUCKET 3: Discover
      setDiscoverPools(data.filter((o: GroupOrder) => 
        o.status === 'open' && 
        o.host_id !== currentUser.uid && 
        !o.participant_ids?.includes(currentUser.uid) 
      ));
      
      if (showManageModal) {
        const updatedOrder = data.find((o: GroupOrder) => o.id === showManageModal.id);
        if (updatedOrder) {
          setShowManageModal(updatedOrder);
        } else {
          setShowManageModal(null); 
        }
      }
    } catch (err) { 
      console.error("Failed to load pools", err); 
    } 
    finally { 
      if (showSpinner) setIsLoading(false); 
    }
  };

  useEffect(() => {
    if (!currentUser?.uid || !auth.currentUser) return;
    
    fetchOrders(true);

    let timeoutId: NodeJS.Timeout;
    const q = collection(db, 'group_orders');
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.metadata.hasPendingWrites) {
         clearTimeout(timeoutId);
         timeoutId = setTimeout(() => { fetchOrders(false); }, 2000); 
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [currentUser]);

  return (
    <div className="space-y-10 animate-fade-in-up">
      
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-purple-50 p-6 rounded-3xl border border-purple-100 shadow-sm gap-4">
        <div>
          <h2 className="text-xl font-black text-purple-900">Cart Pooling</h2>
          <p className="text-sm text-purple-700 mt-1 font-medium">Split delivery fees by joining an active order.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button 
            onClick={() => fetchOrders(true)} 
            disabled={isLoading}
            className="px-4 py-3 bg-white text-purple-600 border border-purple-200 font-bold rounded-xl shadow-sm hover:bg-purple-100 transition flex items-center justify-center disabled:opacity-50"
            title="Refresh Feed"
          >
            <svg className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
          <button onClick={() => setShowCreateModal(true)} className="flex-1 sm:flex-none px-6 py-3 bg-purple-600 text-white font-bold rounded-xl shadow-sm hover:bg-purple-700 transition">
            + Start an Order
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-10"><div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto"></div></div>
      ) : (
        <>
          {/* 1. MY ACTIVE POOLS */}
          {myActivePools.length > 0 && (
            <div>
              <h3 className="text-lg font-black text-gray-900 mb-4 flex items-center gap-2">🛒 My Active Pools</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {myActivePools.map(order => <GroupOrderCard key={order.id} order={order} currentUser={currentUser} router={router} onJoin={() => setShowJoinModal(order)} onManage={() => setShowManageModal(order)} onRefresh={() => fetchOrders(true)}/>)}
              </div>
            </div>
          )}

          {/* 2. DISCOVER CAMPUS ORDERS */}
          <div>
            <h3 className="text-lg font-black text-gray-900 mb-4 flex items-center gap-2">🔍 Discover Campus Orders</h3>
            {discoverPools.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-300"><p className="text-gray-500 font-medium">No open cart pools to join right now.</p></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {discoverPools.map(order => <GroupOrderCard key={order.id} order={order} currentUser={currentUser} router={router} onJoin={() => setShowJoinModal(order)} onManage={() => setShowManageModal(order)} onRefresh={() => fetchOrders(true)}/>)}
              </div>
            )}
          </div>

          {/* 3. PAST ORDERS */}
          {pastPools.length > 0 && (
            <div className="pt-8 border-t border-gray-200">
              <h3 className="text-lg font-black text-gray-400 mb-4 flex items-center gap-2">🕰️ Past Orders</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pastPools.map(order => <GroupOrderCard key={order.id} order={order} currentUser={currentUser} router={router} onJoin={() => setShowJoinModal(order)} onManage={() => setShowManageModal(order)} onRefresh={() => fetchOrders(true)}/>)}
              </div>
            </div>
          )}
        </>
      )}

      {showCreateModal && <CreateOrderModal profile={profile} onClose={() => setShowCreateModal(false)} onSuccess={() => { setShowCreateModal(false); fetchOrders(true); }} />}
      {showJoinModal && <JoinOrderModal profile={profile} currentUser={currentUser} order={showJoinModal} onClose={() => setShowJoinModal(null)} router={router} onRefresh={() => fetchOrders(true)} />}
      {showManageModal && <ManageOrderModal order={showManageModal} currentUser={currentUser} onClose={() => setShowManageModal(null)} onRefresh={() => fetchOrders(true)} />}
    </div>
  );
}

// ==========================================
// 1. THE GROUP ORDER CARD
// ==========================================
function GroupOrderCard({ order, currentUser, onJoin, onManage, onRefresh, router }: any) {
  const [timeLeft, setTimeLeft] = useState('');
  
  const isHost = currentUser?.uid === order.host_id;
  const hasJoined = !isHost && order.participant_ids?.includes(currentUser?.uid);
  
  const isPast = ['delivered', 'cancelled', 'settled'].includes(order.status);
  const isDiscover = !isHost && !hasJoined && order.status === 'open';
  const isExpired = order.status !== 'open';

  const formatOrderTime = (dateString: string) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const appNameLower = order.app_name?.toLowerCase() || '';
  let brandBadge = 'bg-gray-100 text-gray-600';
  let leftBorder = 'border-l-gray-300';
  
  if (appNameLower.includes('blinkit')) {
    brandBadge = 'bg-yellow-100 text-yellow-800';
    leftBorder = 'border-l-[#F8CB46]';
  } else if (appNameLower.includes('zepto')) {
    brandBadge = 'bg-purple-100 text-purple-800';
    leftBorder = 'border-l-[#3C006B]';
  } else if (appNameLower.includes('swiggy')) {
    brandBadge = 'bg-orange-100 text-orange-800';
    leftBorder = 'border-l-[#FC8019]';
  }

  useEffect(() => {
    if (order.status !== 'open') { setTimeLeft('Locked'); return; }
    
    const interval = setInterval(() => {
      const distance = new Date(order.expires_at).getTime() - new Date().getTime();
      if (distance < 0) { clearInterval(interval); setTimeLeft('Time is up!'); } 
      else {
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);
        setTimeLeft(`${m}m ${s}s`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [order.expires_at, order.status]);

  const updateStatus = async (newStatus: 'locked' | 'delivered') => {
    let fee = order.delivery_fee || 0;
    if (newStatus === 'locked') {
      const input = window.prompt("What is the final Delivery + Surge fee? (We will split this evenly. Enter 0 if none)", "0");
      if (input === null) return; 
      fee = parseFloat(input) || 0;
    }
    try {
      await updateGroupOrderStatus(order.id, newStatus, fee); 
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Failed to update order status");
    }
  };

  let statusText = isExpired ? 'Locked' : timeLeft;
  if (order.status === 'delivered') statusText = 'Arrived!';
  if (order.status === 'cancelled') statusText = 'Cancelled';
  if (order.status === 'settled') statusText = 'Settled';

  return (
    <div className={`bg-white p-5 rounded-2xl border-y border-r border-l-4 shadow-sm hover:shadow-md transition flex flex-col ${leftBorder} border-y-gray-100 border-r-gray-100`}>
      
      <div className="flex justify-between items-start mb-3">
        <div>
          <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg ${brandBadge}`}>
            {order.app_name}
          </span>
          
          <div className="flex items-center gap-3 mt-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-sm shrink-0 uppercase">
              {order.host_name ? order.host_name.charAt(0) : 'U'}
            </div>
            
            <div className="flex flex-col">
              {/* 🚨 RESPONSIVE FIX: flex-wrap, gap-y-1, and truncate for long names */}
              <div className="flex items-center flex-wrap gap-2 gap-y-1">
                <h3 className="text-lg font-bold text-gray-900 leading-none truncate max-w-[180px] sm:max-w-xs">
                  {order.host_name}'s Order
                </h3>
                {/* 🚨 shrink-0 keeps the badge from getting squished */}
                {isHost && <span className="shrink-0 text-[10px] text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded font-black border border-yellow-200" title="You are the host">👑 Host</span>}
              </div>
              <span className="text-[10px] text-gray-400 font-medium mt-1">🕒 {formatOrderTime(order.expires_at)}</span>
            </div>

            {!isHost && hasJoined && !isPast && order.contact_number && (
              <div className="flex gap-1.5 ml-1">
                <a href={`https://wa.me/91${order.contact_number.replace(/\D/g, '')}?text=${encodeURIComponent(`Hey ${order.host_name}, regarding the ${order.app_name} group order!`)}`} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition" title={`WhatsApp ${order.host_name}`}>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </a>
                <a href={`tel:+91${order.contact_number.replace(/\D/g, '')}`} className="p-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition" title={`Call ${order.host_name}`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                </a>
              </div>
            )}
          </div>
          
          {isDiscover ? (
            <div className="flex items-center gap-2 mt-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
              <span className="text-xs font-black text-green-600 uppercase tracking-widest">Accepting Joiners</span>
            </div>
          ) : (
            <p className="text-xs text-gray-500 font-medium mt-2">📍 Meet at: {order.pickup_location}</p>
          )}
        </div>

        <div className={`text-right ${isPast ? 'text-gray-400' : (isExpired ? 'text-red-500' : 'text-blue-600')}`}>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {isPast ? 'Status' : 'Ordering In'}
          </span>
          <span className={`text-xl font-black tabular-nums ${order.status === 'delivered' ? 'text-green-600' : ''}`}>
            {statusText}
          </span>
        </div>
      </div>

      {!isHost && hasJoined && order.delivery_fee !== undefined && order.delivery_fee > 0 && (
        <div className={`mt-2 mb-2 p-3 rounded-xl flex justify-between items-center text-xs ${isPast ? 'bg-gray-50 border border-gray-100' : 'bg-purple-50 border border-purple-100'}`}>
          <div>
            <span className={`${isPast ? 'text-gray-500' : 'text-purple-600'} block mb-0.5 font-medium`}>Total App Fee: ₹{order.delivery_fee}</span>
            <span className={`font-black block text-sm ${isPast ? 'text-gray-700' : 'text-purple-900'}`}>Your Split: +₹{Math.ceil(order.delivery_fee / (order.participants.length + 1))}</span>
          </div>
          <span className={`${isPast ? 'bg-gray-200 text-gray-600' : 'bg-purple-200 text-purple-800'} px-2 py-1 rounded-lg font-black text-[10px] uppercase tracking-wider`}>Fee Split</span>
        </div>
      )}

      <div className="mt-auto pt-4 flex flex-wrap gap-2">
        {isHost ? (
          <>
            {order.status === 'open' && <button onClick={() => updateStatus('locked')} className="flex-1 py-2 bg-red-600 text-white font-bold text-sm rounded-xl hover:bg-red-700 transition">Lock & Buy</button>}
            {order.status === 'locked' && <button onClick={() => updateStatus('delivered')} className="flex-1 py-2 bg-green-600 text-white font-bold text-sm rounded-xl hover:bg-green-700 transition animate-pulse">Mark Arrived</button>}
            {isPast && <button disabled className="flex-1 py-2 bg-gray-100 text-gray-400 font-bold text-sm rounded-xl border border-gray-200">Completed Order</button>}
            
            <button onClick={onManage} className="p-2 bg-gray-900 text-white rounded-xl hover:bg-black transition" title="Manage Order"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg></button>
            <Link href={`/chat/${order.chat_room_id}`} className="px-4 py-2 bg-blue-50 text-blue-700 font-bold text-sm rounded-xl border border-blue-100 hover:bg-blue-100 transition flex items-center justify-center">Chat</Link>
          </>
        ) : (
          <>
            {isDiscover && (
              <button onClick={onJoin} className="flex-1 py-2.5 bg-blue-600 text-white font-black text-sm rounded-xl hover:bg-blue-700 transition shadow-sm">
                + Join Order
              </button>
            )}
            
            {hasJoined && !isPast && (
              <div className="flex gap-2 flex-1">
                {order.status === 'open' && (
                  <button onClick={onJoin} className="flex-[2] py-2 bg-purple-50 text-purple-700 font-bold text-sm rounded-xl border border-purple-200 hover:bg-purple-100 transition flex items-center justify-center gap-1">
                    ✏️ Edit Cart
                  </button>
                )}
                <button onClick={onManage} className="flex-[1] flex items-center justify-center p-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition border border-gray-200" title="View Details">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63-.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                </button>
              </div>
            )}

            {(hasJoined || isPast) && !isDiscover && (
              <Link href={`/chat/${order.chat_room_id}`} prefetch={false} className={`flex-1 py-2 font-bold text-sm rounded-xl transition flex items-center justify-center shadow-sm ${isPast ? 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                {isPast ? 'View Receipt' : 'Open Chat'}
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 2. THE MANAGE ORDER MODAL (Host Edit Prices)
// ==========================================
function ManageOrderModal({ order, currentUser, onClose, onRefresh }: { order: GroupOrder, currentUser: any, onClose: () => void, onRefresh: () => Promise<void> }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBlasting, setIsBlasting] = useState(false); 
  const totalPoolValue = order.participants.reduce((acc, p) => acc + p.total_estimated_price, 0);

  const isHost = currentUser.uid === order.host_id;

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);

  const handleRefresh = async () => { setIsRefreshing(true); await onRefresh(); setIsRefreshing(false); };

  const handleKick = async (userId: string, userName: string) => {
    if (!window.confirm(`Are you sure you want to remove ${userName} from the order?`)) return;
    setIsRefreshing(true);
    try {
      await kickParticipant(order.id, userId); 
      await onRefresh(); 
    } catch (err: any) { alert(err.message || "Failed to remove user"); setIsRefreshing(false); }
  };

  const handleSettle = async () => {
    if (!window.confirm("Are you sure? This will permanently close the order and archive it.")) return;
    setIsRefreshing(true);
    try {
      await settleGroupOrder(order.id);
      onClose();
      await onRefresh();
    } catch (err: any) {
      alert(err.message || "Failed to settle order");
      setIsRefreshing(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!window.confirm("Are you sure you want to cancel this entire order? All participants will be notified.")) return;
    
    setIsRefreshing(true);
    try {
      await updateGroupOrderStatus(order.id, 'cancelled');
      onClose(); 
      await onRefresh(); 
    } catch (err: any) {
      alert(err.message || "Failed to cancel order");
      setIsRefreshing(false);
    }
  };

  const handleInAppBlast = async () => {
    const fee = order.delivery_fee || 0;
    const totalPeople = order.participants.length + 1; 
    const feePerPerson = fee / totalPeople;

    let message = "";
    if (order.status === 'open' || order.status === 'locked') {
      message = `🛒 *LOCKING ORDER: ${order.app_name}*\nI am placing the order now. Here is the payment breakdown:\n\n`;
    } else {
      message = `🛎️ *ORDER ARRIVED: ${order.app_name}*\nPlease meet at ${order.pickup_location}. Breakdown:\n\n`;
    }
    
    const encodedName = encodeURIComponent(order.host_name);
    
    order.participants.forEach(p => { 
      const finalAmount = Math.ceil(p.total_estimated_price + feePerPerson);
      message += `👤 ${p.user_name}: ₹${finalAmount} ${feePerPerson > 0 ? `(includes ₹${Math.ceil(feePerPerson)} fee)` : ''}\n`; 
      
      if (order.upi_id) {
        message += `👉 upi://pay?pa=${order.upi_id}&pn=${encodedName}&cu=INR&am=${finalAmount}\n\n`;
      } else {
        message += `\n`;
      }
    });

    if (!order.upi_id) message += `\nPlease bring exact change or keep UPI ready!`;

    setIsBlasting(true);
    try {
      await sendMessage(order.chat_room_id, currentUser.uid, message, false);
      alert("✅ Breakdown sent successfully to the Group Chat!");
    } catch (err) {
      alert("Failed to send breakdown to chat.");
    } finally {
      setIsBlasting(false);
    }
  };

  const handleEditPriceClick = (userId: string, currentPrice: number) => {
    setEditingUserId(userId);
    setEditPrice(currentPrice.toString());
  };

  const handleSavePrice = async (userId: string) => {
    const newPrice = parseFloat(editPrice);
    if (isNaN(newPrice) || newPrice < 0) return alert("Invalid price");

    setIsUpdatingPrice(true);
    try {
      await updateParticipantPrice(order.id, userId, newPrice);
      setEditingUserId(null);
      await onRefresh();
    } catch (err: any) {
      alert(err.message || "Failed to update price");
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-xl animate-fade-in-up max-h-[80vh] overflow-y-auto">
        
        <div className="flex justify-between items-start mb-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-2xl font-black text-gray-900">{isHost ? 'Manage Order' : 'Order Details'}</h2>
            <p className="text-sm text-gray-500 font-medium mt-1">
              Participants: {order.participants.length} | Items: ₹{totalPoolValue} 
              {order.delivery_fee ? ` | Fee: ₹${order.delivery_fee}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {isHost && order.participants.length > 0 && (
              <button 
                onClick={handleInAppBlast} 
                disabled={isBlasting}
                className="px-3 bg-blue-100 text-blue-700 rounded-xl hover:bg-blue-200 transition font-bold text-xs flex items-center gap-1 disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                {isBlasting ? 'Sending...' : 'Send to Chat'}
              </button>
            )}
            <button onClick={handleRefresh} disabled={isRefreshing} className="p-2 bg-purple-50 text-purple-600 rounded-xl hover:bg-purple-100 transition"><svg className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-xl transition"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        </div>

        {order.participants.length === 0 ? (
          <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed"><p className="text-gray-500 font-medium">Waiting for people to join...</p></div>
        ) : (
          <div className="space-y-4">
            {order.participants.map((p, idx) => {
              const fee = order.delivery_fee || 0;
              const totalPeople = order.participants.length + 1; 
              const feePerPerson = fee / totalPeople;
              const finalAmount = Math.ceil(p.total_estimated_price + feePerPerson);
              
              let waMessage = order.status === 'open' || order.status === 'locked'
                ? `🛒 *Locking the ${order.app_name} Order!*\nHey ${p.user_name}, I am placing the order now.\n\n`
                : `🛎️ *${order.app_name} is Here!*\nHey ${p.user_name}, please meet at ${order.pickup_location}.\n\n`;

              waMessage += `*Your Payment Breakdown:*\n`;
              waMessage += `Total: ₹${finalAmount} ${feePerPerson > 0 ? `(includes ₹${Math.ceil(feePerPerson)} fee split)` : ''}\n\n`;

              if (order.upi_id) {
                waMessage += `👉 Click to Pay: upi://pay?pa=${order.upi_id}&pn=${encodeURIComponent(order.host_name)}&cu=INR&am=${finalAmount}\n\n`;
              } else {
                waMessage += `Please bring exact change or keep UPI ready!\n\n`;
              }

              waMessage += `Host: ${order.host_name} (${order.contact_number})`;
              const smartWaLink = `https://wa.me/91${p.contact_number.replace(/\D/g, '')}?text=${encodeURIComponent(waMessage)}`;

              return (
                <div key={idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex justify-between items-start">
                  <div className="w-full">
                    <div className="flex items-center mb-1">
                      <h4 className="font-bold text-gray-900 flex items-center flex-wrap gap-2">
                        {p.user_name} 
                        <span className="text-xs text-gray-400 font-normal">({p.contact_number})</span>
                        {p.block && (
                          <span className="text-[10px] font-black text-purple-600 bg-purple-100 px-2 py-0.5 rounded-lg uppercase tracking-wider">
                            🏢 {p.block}
                          </span>
                        )}
                      </h4>
                      {isHost && order.status === 'open' && (
                        <button onClick={() => handleKick(p.user_id, p.user_name)} className="p-1.5 ml-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title={`Remove ${p.user_name}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                      )}
                    </div>
                    
                    {p.cart_link ? (
                      <div className="mt-2 mb-3">
                         <a href={p.cart_link} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg inline-flex items-center gap-1 transition">
                           🔗 Open Shared Cart
                         </a>
                      </div>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {p.items.map((item, i) => (
                          <li key={i} className="text-sm text-gray-600 flex items-center justify-between border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                            <span><span className="font-black text-gray-900">{item.quantity}x</span> {item.item_name}</span>
                            <span className="text-xs text-gray-400 text-right">(₹{item.estimated_price} / unit) <br/><span className="text-sm font-bold text-gray-900">Total: ₹{item.estimated_price * item.quantity}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                    
                    <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
                      <div className="text-xs text-gray-500 font-medium flex items-center flex-wrap gap-1">
                        <span>Cart:</span>
                        {editingUserId === p.user_id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-gray-900 font-bold">₹</span>
                            <input
                              type="number"
                              value={editPrice}
                              onChange={(e) => setEditPrice(e.target.value)}
                              className="w-16 px-1.5 py-0.5 text-xs font-bold text-gray-900 border border-purple-300 rounded shadow-inner outline-none focus:border-purple-500"
                              autoFocus
                            />
                            <button onClick={() => handleSavePrice(p.user_id)} disabled={isUpdatingPrice} className="text-green-600 bg-green-50 p-1 rounded hover:bg-green-100 transition"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg></button>
                            <button onClick={() => setEditingUserId(null)} className="text-red-500 bg-red-50 p-1 rounded hover:bg-red-100 transition"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg></button>
                          </div>
                        ) : (
                          <span className="font-bold text-gray-700 flex items-center gap-1">
                            ₹{p.total_estimated_price}
                            {isHost && (order.status === 'open' || order.status === 'locked') && (
                              <button onClick={() => handleEditPriceClick(p.user_id, p.total_estimated_price)} className="text-blue-500 hover:text-blue-700 transition" title="Override Cart Total">✏️</button>
                            )}
                          </span>
                        )}
                        {feePerPerson > 0 && <span className="text-purple-600 ml-1">+ Fee: ₹{Math.ceil(feePerPerson)}</span>}
                      </div>
                      <span className="text-sm font-black text-purple-700">
                        Total: ₹{finalAmount}
                      </span>
                    </div>

                  </div>
                  {isHost && (
                    <div className="flex flex-col gap-2 ml-4 shrink-0">
                      <a href={smartWaLink} target="_blank" className="p-2 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition" title={`Message ${p.user_name} on WhatsApp`}>
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      </a>
                      <a href={`tel:+91${p.contact_number.replace(/\D/g, '')}`} className="p-2 bg-blue-100 text-blue-700 rounded-xl hover:bg-blue-200 transition" title={`Call ${p.user_name}`}><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg></a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {isHost && order.status === 'delivered' && (
          <div className="mt-6 p-5 bg-green-50 border border-green-200 rounded-2xl animate-fade-in-up">
            <h4 className="text-sm font-black text-green-900 mb-2">Order Complete?</h4>
            <p className="text-xs text-green-800 mb-4">Once everyone has paid you back, click below to archive this order and remove it from your active feed.</p>
            <button onClick={handleSettle} disabled={isRefreshing} className="w-full py-3 bg-green-600 text-white font-black rounded-xl hover:bg-green-700 transition disabled:opacity-50 shadow-sm">
              Close & Archive Order
            </button>
          </div>
        )}

        {isHost && order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'settled' && (
          <div className="mt-6 pt-4 border-t border-red-100 flex justify-center">
            <button 
              onClick={handleCancelOrder} 
              className="text-red-500 hover:text-red-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Cancel Entire Order
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ==========================================
// 3. THE CREATE MODAL (Host Form with persistent Auto-Fill)
// ==========================================
function CreateOrderModal({ profile, onClose, onSuccess }: { profile: any, onClose: () => void, onSuccess: () => void }) {
  const [formData, setFormData] = useState({ 
    app_name: 'Blinkit', 
    pickup_location: '', 
    contact_number: '', 
    expires_in_minutes: 15, 
    upi_id: '',
    cart_link: ''
  });

  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      pickup_location: localStorage.getItem('last_pool_location') || profile?.block || '',
      contact_number: localStorage.getItem('last_pool_phone') || profile?.phone || '',
      upi_id: localStorage.getItem('last_pool_upi') || profile?.upi_id || ''
    }));
  }, [profile]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    
    localStorage.setItem('last_pool_location', formData.pickup_location);
    localStorage.setItem('last_pool_phone', formData.contact_number);
    localStorage.setItem('last_pool_upi', formData.upi_id);

    try { 
      await createGroupOrder(formData); 
      onSuccess(); 
    } 
    catch (err) { setIsSubmitting(false); alert("Error creating order"); }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl animate-fade-in-up">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-black text-gray-900">Start a Group Order</h2>
          <button onClick={onClose} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">App</label>
              <select value={formData.app_name} onChange={e => setFormData({...formData, app_name: e.target.value})} className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-purple-500">
                <option value="Blinkit">Blinkit</option>
                <option value="Zepto">Zepto</option>
                <option value="Swiggy">Swiggy Instamart</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Close Order In</label>
              <select value={formData.expires_in_minutes} onChange={e => setFormData({...formData, expires_in_minutes: Number(e.target.value)})} className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-purple-500">
                <option value={15}>15 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={60}>1 Hour</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 flex justify-between">
              <span>Host UPI ID</span> <span className="text-purple-500">Required for Splits</span>
            </label>
            <input type="text" required value={formData.upi_id} onChange={e => setFormData({...formData, upi_id: e.target.value})} placeholder="e.g., yourname@okhdfc" className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 transition-all shadow-inner" />
          </div>

          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 flex justify-between">
              <span>Master Cart Link</span> <span className="text-gray-400">Optional</span>
            </label>
            <input type="url" value={formData.cart_link} onChange={e => setFormData({...formData, cart_link: e.target.value})} placeholder="Paste your Blinkit cart link..." className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-medium outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 transition-all shadow-inner" />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Phone</label>
              <input type="tel" required value={formData.contact_number} onChange={e => setFormData({...formData, contact_number: e.target.value})} placeholder="WhatsApp..." className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Pickup Block</label>
              <input type="text" required value={formData.pickup_location} onChange={e => setFormData({...formData, pickup_location: e.target.value})} placeholder="e.g., M Block Gate" className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-purple-500" />
            </div>
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full mt-4 py-4 bg-purple-600 text-white font-black rounded-2xl hover:bg-purple-700 active:scale-95 transition-all shadow-sm">
            {isSubmitting ? 'Creating...' : 'Start Hosting'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// 4. THE JOIN / EDIT MODAL (Hybrid System & Persistent Auto-Fill)
// ==========================================
function JoinOrderModal({ profile, currentUser, order, onClose, router, onRefresh }: { profile: any, currentUser: any, order: GroupOrder, onClose: () => void, router: any, onRefresh?: () => void }) {
  const existingParticipant = order.participants.find(p => p.user_id === currentUser?.uid);
  const isEditing = !!existingParticipant;

  const [cart, setCart] = useState<PoolItem[]>(existingParticipant?.items || []);
  
  const [joinForm, setJoinForm] = useState({
    contact_number: '',
    block: '',
    joinMode: 'link', 
    cart_link: '',
    linkEstimatedPrice: '',
    manualItemName: '',
    manualItemPrice: ''
  });

  useEffect(() => {
    if (isEditing) {
      setJoinForm(prev => ({
        ...prev,
        contact_number: existingParticipant.contact_number,
        block: existingParticipant.block || '',
        joinMode: existingParticipant.cart_link ? 'link' : 'manual',
        cart_link: existingParticipant.cart_link || '',
        linkEstimatedPrice: existingParticipant.cart_link ? existingParticipant.total_estimated_price.toString() : ''
      }));
    } else {
      setJoinForm(prev => ({
        ...prev,
        contact_number: localStorage.getItem('last_pool_phone') || profile?.phone || '',
        block: localStorage.getItem('last_pool_block') || profile?.block || ''
      }));
    }
  }, [existingParticipant, profile, isEditing]);
  
  const [manualQty, setManualQty] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddToCart = (e?: React.FormEvent) => {
    if (e) e.preventDefault(); 
    if (!joinForm.manualItemName || !joinForm.manualItemPrice) return;
    
    setCart([...cart, { 
      item_name: joinForm.manualItemName, 
      quantity: manualQty, 
      estimated_price: Number(joinForm.manualItemPrice) 
    }]);
    
    setJoinForm({ ...joinForm, manualItemName: '', manualItemPrice: '' }); 
    setManualQty(1);
  };

  const handleRemoveItem = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!joinForm.contact_number || !joinForm.block) return alert("Please enter your phone and block.");
    if (joinForm.joinMode === 'link' && (!joinForm.cart_link || !joinForm.linkEstimatedPrice)) return alert("Please paste the Blinkit/Zepto cart link and enter your total value.");

    if (joinForm.joinMode === 'manual' && cart.length === 0) {
      if (joinForm.manualItemName && joinForm.manualItemPrice) {
        cart.push({ item_name: joinForm.manualItemName, quantity: manualQty, estimated_price: Number(joinForm.manualItemPrice) });
      } else {
        return alert("Please add at least one item to your cart.");
      }
    }

    setIsSubmitting(true);

    localStorage.setItem('last_pool_phone', joinForm.contact_number);
    localStorage.setItem('last_pool_block', joinForm.block);

    try { 
      const payload: any = { 
        contact_number: joinForm.contact_number, 
        block: joinForm.block, 
        cart_link: joinForm.joinMode === 'link' ? joinForm.cart_link : "",
        items: joinForm.joinMode === 'manual' ? cart : [{ item_name: "Shared Cart Link Items", quantity: 1, estimated_price: Number(joinForm.linkEstimatedPrice) }] 
      };

      if (isEditing) {
        await updateParticipantCart(order.id, payload);
        alert("Cart updated successfully!");
        onClose();
        if (onRefresh) onRefresh();
      } else {
        await joinGroupOrder(order.id, payload); 
        router.push(`/chat/${order.chat_room_id}`); 
      }
    } 
    catch (err) { setIsSubmitting(false); alert(`Failed to ${isEditing ? 'update' : 'join'} order`); }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex justify-center items-end sm:items-center z-50 p-4">
      <div className="bg-white w-full max-w-md rounded-[32px] p-6 shadow-2xl animate-fade-in-up max-h-[90vh] overflow-y-auto">
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-black text-gray-900">{isEditing ? 'Edit Your Cart' : 'Add Your Items'}</h2>
          <button onClick={onClose} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-xl mb-6">
          <button 
            type="button" 
            onClick={() => setJoinForm({...joinForm, joinMode: 'link'})} 
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${joinForm.joinMode === 'link' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            🔗 Shared Link
          </button>
          <button 
            type="button" 
            onClick={() => setJoinForm({...joinForm, joinMode: 'manual'})} 
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${joinForm.joinMode === 'manual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            ✍️ Type Manual
          </button>
        </div>

        <form onSubmit={handleFinalSubmit} className="space-y-4">
          
          {joinForm.joinMode === 'link' ? (
            <div className="animate-fade-in-up mb-6 pb-6 border-b border-gray-100 space-y-4">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Paste Cart Link</label>
                <input 
                  type="url" required 
                  value={joinForm.cart_link} 
                  onChange={e => setJoinForm({...joinForm, cart_link: e.target.value})} 
                  placeholder="https://link.blinkit.com/..." 
                  className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-medium outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 transition-all shadow-inner" 
                />
                <p className="text-[10px] text-gray-400 font-bold mt-2 ml-1">Go to Blinkit/Zepto app → Cart → Share Cart.</p>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Your Total Cart Value (₹)</label>
                <input 
                  type="number" required 
                  value={joinForm.linkEstimatedPrice} 
                  onChange={e => setJoinForm({...joinForm, linkEstimatedPrice: e.target.value})} 
                  placeholder="e.g., 140" 
                  className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-medium outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 transition-all shadow-inner" 
                />
              </div>
            </div>
          ) : (
            <div className="animate-fade-in-up">
              {cart.length > 0 && (
                <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-2xl">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Your Cart</h4>
                  <ul className="space-y-3">
                    {cart.map((c, i) => (
                      <li key={i} className="text-sm font-medium flex justify-between items-center border-b border-gray-200 pb-2 last:border-0 last:pb-0">
                        <div>
                          <span className="block mb-0.5"><span className="font-black text-purple-600">{c.quantity}x</span> {c.item_name} <span className="text-xs text-gray-400 ml-1">(₹{c.estimated_price}/unit)</span></span>
                          <span className="text-gray-900 font-bold">Total: ₹{c.estimated_price * c.quantity}</span>
                        </div>
                        <button type="button" onClick={() => handleRemoveItem(i)} className="p-1.5 text-red-500 hover:bg-red-100 rounded-md transition" title="Remove Item"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              <div className="space-y-3 mb-6 pb-6 border-b border-gray-100">
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Item Name</label>
                  <input type="text" value={joinForm.manualItemName} onChange={e => setJoinForm({...joinForm, manualItemName: e.target.value})} placeholder="e.g., Maggi Masala" className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-medium outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 transition-all shadow-inner" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1 flex justify-center">Quantity</label>
                    <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-2xl p-2 shadow-inner h-[48px]">
                      <button type="button" onClick={() => setManualQty(Math.max(1, manualQty - 1))} className="w-8 h-8 rounded-xl bg-white text-gray-600 font-bold hover:bg-gray-100 shadow-sm">-</button>
                      <span className="font-black text-gray-900">{manualQty}</span>
                      <button type="button" onClick={() => setManualQty(manualQty + 1)} className="w-8 h-8 rounded-xl bg-white text-gray-600 font-bold hover:bg-gray-100 shadow-sm">+</button>
                    </div>
                  </div>
                  <div className="flex-[1.5]">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Est. Cost (₹)</label>
                    <input type="number" value={joinForm.manualItemPrice} onChange={e => setJoinForm({...joinForm, manualItemPrice: e.target.value})} placeholder="40" className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-medium outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 transition-all shadow-inner h-[48px]" />
                  </div>
                </div>
                <button type="button" onClick={handleAddToCart} className="w-full py-3 bg-purple-50 text-purple-700 font-bold rounded-xl hover:bg-purple-100 border border-purple-200 transition text-sm shadow-sm">
                  + Add Item
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Phone</label>
              <input type="tel" required value={joinForm.contact_number} onChange={e => setJoinForm({...joinForm, contact_number: e.target.value})} placeholder="WhatsApp..." className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Hostel Block</label>
              <input type="text" required value={joinForm.block} onChange={e => setJoinForm({...joinForm, block: e.target.value})} placeholder="e.g. M Block" className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none focus:border-purple-500" />
            </div>
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full mt-4 py-4 bg-gray-900 text-white font-black rounded-2xl hover:bg-black active:scale-95 transition-all shadow-sm">
            {isSubmitting ? 'Saving...' : (isEditing ? 'Save Changes' : 'Done & Enter Chat')}
          </button>
        </form>
      </div>
    </div>
  );
}