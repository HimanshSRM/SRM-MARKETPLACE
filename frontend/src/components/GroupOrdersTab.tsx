'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { getActiveGroupOrders, createGroupOrder, joinGroupOrder, updateGroupOrderStatus, kickParticipant, settleGroupOrder } from '@/lib/api';

// --- INTERFACES ---
interface PoolItem { item_name: string; quantity: number; estimated_price: number; }
interface Participant { user_id: string; user_name: string; contact_number: string; items: PoolItem[]; total_estimated_price: number; }
interface GroupOrder {
  id: string; host_id: string; host_name: string; app_name: string; pickup_location: string; contact_number: string;
  upi_id?: string; delivery_fee?: number; 
  status: 'open' | 'locked' | 'delivered' | 'cancelled' | 'settled'; 
  expires_at: string; chat_room_id: string; participants: Participant[]; participant_ids: string[];
}

export default function GroupOrdersTab({ currentUser }: { currentUser: any }) {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState<GroupOrder | null>(null); 
  const [showManageModal, setShowManageModal] = useState<GroupOrder | null>(null); 
  
  const [myPools, setMyPools] = useState<GroupOrder[]>([]);
  const [discoverPools, setDiscoverPools] = useState<GroupOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        const data = await getActiveGroupOrders(token);
        
        // 🚨 Split the pools and hide cancelled/settled ones!
        const mine = data.filter((o: GroupOrder) => 
          (
            o.host_id === currentUser.uid || 
            o.participant_ids?.includes(currentUser.uid) || 
            o.participants?.some(p => p.user_id === currentUser.uid)
          ) 
          && o.status !== 'cancelled' 
          && o.status !== 'settled'
        );

        const discover = data.filter((o: GroupOrder) => 
          o.status === 'open' 
          && o.host_id !== currentUser.uid 
          && !o.participant_ids?.includes(currentUser.uid) 
        );
        
        setMyPools(mine);
        setDiscoverPools(discover);
        
        if (showManageModal) {
          const updatedOrder = data.find((o: GroupOrder) => o.id === showManageModal.id);
          if (updatedOrder && updatedOrder.status !== 'cancelled' && updatedOrder.status !== 'settled') {
            setShowManageModal(updatedOrder);
          } else if (updatedOrder?.status === 'cancelled' || updatedOrder?.status === 'settled') {
            setShowManageModal(null); // Close modal if order got cancelled/settled elsewhere
          }
        }
      }
    } catch (err) { console.error("Failed to load pools", err); } 
    finally { setIsLoading(false); }
  };

  useEffect(() => { fetchOrders(); }, []);

  return (
    <div className="space-y-8 animate-fade-in-up">
      <div className="flex justify-between items-center bg-purple-50 p-6 rounded-3xl border border-purple-100 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-purple-900">Cart Pooling</h2>
          <p className="text-sm text-purple-700 mt-1 font-medium">Split delivery fees by joining an active order.</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="px-6 py-3 bg-purple-600 text-white font-bold rounded-xl shadow-sm hover:bg-purple-700 transition">+ Start an Order</button>
      </div>

      {isLoading ? (
        <div className="text-center py-10"><div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto"></div></div>
      ) : (
        <>
          {myPools.length > 0 && (
            <div>
              <h3 className="text-lg font-black text-gray-900 mb-4 flex items-center gap-2">🛒 My Active Pools</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {myPools.map(order => <GroupOrderCard key={order.id} order={order} currentUser={currentUser} router={router} onJoin={() => setShowJoinModal(order)} onManage={() => setShowManageModal(order)} onRefresh={fetchOrders}/>)}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-lg font-black text-gray-900 mb-4 flex items-center gap-2">🔍 Discover Campus Orders</h3>
            {discoverPools.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-300"><p className="text-gray-500 font-medium">No open cart pools to join right now.</p></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {discoverPools.map(order => <GroupOrderCard key={order.id} order={order} currentUser={currentUser} router={router} onJoin={() => setShowJoinModal(order)} onManage={() => setShowManageModal(order)} onRefresh={fetchOrders}/>)}
              </div>
            )}
          </div>
        </>
      )}

      {showCreateModal && <CreateOrderModal onClose={() => setShowCreateModal(false)} onSuccess={() => { setShowCreateModal(false); fetchOrders(); }} />}
      {showJoinModal && <JoinOrderModal order={showJoinModal} onClose={() => setShowJoinModal(null)} router={router} />}
      {showManageModal && <ManageOrderModal order={showManageModal} onClose={() => setShowManageModal(null)} onRefresh={fetchOrders} />}
    </div>
  );
}

// ==========================================
// 1. THE GROUP ORDER CARD
// ==========================================
function GroupOrderCard({ order, currentUser, onJoin, onManage, onRefresh, router }: any) {
  const [timeLeft, setTimeLeft] = useState('');
  const [isExpired, setIsExpired] = useState(order.status !== 'open');
  const isHost = currentUser?.uid === order.host_id;
  const hasJoined = !isHost && order.participant_ids?.includes(currentUser?.uid);

  useEffect(() => {
    if (order.status !== 'open') { setTimeLeft('Locked'); setIsExpired(true); return; }
    
    const interval = setInterval(() => {
      const distance = new Date(order.expires_at).getTime() - new Date().getTime();
      if (distance < 0) { clearInterval(interval); setTimeLeft('Time is up!'); setIsExpired(true); } 
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

    const token = await auth.currentUser?.getIdToken();
    if (token) { await updateGroupOrderStatus(token, order.id, newStatus, fee); onRefresh(); }
  };

  return (
    <div className={`bg-white p-5 rounded-2xl border shadow-sm transition flex flex-col ${order.status === 'delivered' ? 'border-green-200 bg-green-50/30' : 'border-gray-200'}`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-[10px] font-black uppercase tracking-widest rounded-lg">{order.app_name}</span>
          <h3 className="text-lg font-bold text-gray-900 mt-2">{order.host_name}'s Order</h3>
          <p className="text-xs text-gray-500 font-medium mt-1">📍 Meet at: {order.pickup_location}</p>
        </div>
        <div className={`text-right ${order.status === 'delivered' ? 'text-green-600' : (isExpired ? 'text-red-500' : 'text-blue-600')}`}>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {order.status === 'delivered' ? 'Status' : 'Ordering In'}
          </span>
          <span className="text-xl font-black tabular-nums">{order.status === 'delivered' ? 'Arrived!' : timeLeft}</span>
        </div>
      </div>

      <div className="mt-auto pt-4 flex gap-2">
        {isHost ? (
          <>
            {order.status === 'open' && <button onClick={() => updateStatus('locked')} className="flex-1 py-2 bg-red-600 text-white font-bold text-sm rounded-xl hover:bg-red-700 transition">Lock & Buy</button>}
            {order.status === 'locked' && <button onClick={() => updateStatus('delivered')} className="flex-1 py-2 bg-green-600 text-white font-bold text-sm rounded-xl hover:bg-green-700 transition animate-pulse">Mark Arrived</button>}
            {order.status === 'delivered' && <button disabled className="flex-1 py-2 bg-gray-200 text-gray-500 font-bold text-sm rounded-xl">Completed</button>}
            
            <button onClick={onManage} className="p-2 bg-gray-900 text-white rounded-xl hover:bg-black transition" title="Manage Order"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg></button>
            <button onClick={() => router.push(`/chat/${order.chat_room_id}`)} className="px-4 py-2 bg-blue-50 text-blue-700 font-bold text-sm rounded-xl border border-blue-100 hover:bg-blue-100 transition">Chat</button>
          </>
        ) : (
          <>
            {!hasJoined && order.status === 'open' && <button onClick={onJoin} className="flex-1 py-2 bg-purple-600 text-white font-bold text-sm rounded-xl hover:bg-purple-700 transition">Join & Add Items</button>}
            {(hasJoined || order.status !== 'open') && <button onClick={() => router.push(`/chat/${order.chat_room_id}`)} className="flex-1 py-2 bg-blue-600 text-white font-bold text-sm rounded-xl hover:bg-blue-700 transition">Open Group Chat</button>}
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 3. THE MANAGE ORDER MODAL (Host View)
// ==========================================
function ManageOrderModal({ order, onClose, onRefresh }: { order: GroupOrder, onClose: () => void, onRefresh: () => Promise<void> }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const totalPoolValue = order.participants.reduce((acc, p) => acc + p.total_estimated_price, 0);

  const handleRefresh = async () => { setIsRefreshing(true); await onRefresh(); setIsRefreshing(false); };

  const handleKick = async (userId: string, userName: string) => {
    if (!window.confirm(`Are you sure you want to remove ${userName} from the order?`)) return;
    setIsRefreshing(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) { await kickParticipant(token, order.id, userId); await onRefresh(); }
    } catch (err: any) { alert(err.message || "Failed to remove user"); setIsRefreshing(false); }
  };

  // 🚨 THE NEW SETTLE LOGIC
  const handleSettle = async () => {
    if (!window.confirm("Are you sure? This will permanently close the order and archive it.")) return;
    setIsRefreshing(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        await settleGroupOrder(token, order.id);
        onClose();
        await onRefresh();
      }
    } catch (err: any) {
      alert(err.message || "Failed to settle order");
      setIsRefreshing(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!window.confirm("Are you sure you want to cancel this entire order? All participants will be notified.")) return;
    
    if (order.participants.length > 0) {
      const wantToBlast = window.confirm("Do you want to send a WhatsApp blast to tell everyone it's cancelled?");
      if (wantToBlast) {
        let msg = `❌ *${order.app_name} Order Cancelled!*\nHey guys, I had to cancel the group order. Sorry about that!\n\n`;
        order.participants.forEach(p => { msg += `👤 ${p.user_name} (${p.contact_number})\n`; });
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
      }
    }

    setIsRefreshing(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        await updateGroupOrderStatus(token, order.id, 'cancelled');
        onClose(); 
        await onRefresh(); 
      }
    } catch (err: any) {
      alert(err.message || "Failed to cancel order");
      setIsRefreshing(false);
    }
  };

  const handleWhatsAppBlast = () => {
    const fee = order.delivery_fee || 0;
    const totalPeople = order.participants.length + 1; 
    const feePerPerson = fee / totalPeople;

    let message = "";
    if (order.status === 'open' || order.status === 'locked') {
      message = `🛒 *Locking the ${order.app_name} Order!*\nI am placing the order now.\n\n`;
    } else {
      message = `🛎️ *${order.app_name} is Here!*\nPlease meet at ${order.pickup_location}.\n\n`;
    }
    
    message += `*Payment Breakdown:*\n`;
    
    order.participants.forEach(p => { 
      const finalAmount = Math.ceil(p.total_estimated_price + feePerPerson);
      message += `👤 ${p.user_name}: ₹${finalAmount} ${feePerPerson > 0 ? `(inc. ₹${Math.ceil(feePerPerson)} fee)` : ''}\n`; 
    });

    message += `\nHost: ${order.host_name} (${order.contact_number})`;

    if (order.upi_id) {
      const encodedName = encodeURIComponent(order.host_name);
      message += `\n\n💸 *Pay via UPI:* \nupi://pay?pa=${order.upi_id}&pn=${encodedName}&cu=INR\n(UPI ID: ${order.upi_id})`;
    } else {
      message += `\nPlease bring exact change or keep UPI ready!`;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-xl animate-fade-in-up max-h-[80vh] overflow-y-auto">
        
        <div className="flex justify-between items-start mb-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-2xl font-black text-gray-900">Manage Order</h2>
            <p className="text-sm text-gray-500 font-medium mt-1">
              Participants: {order.participants.length} | Items: ₹{totalPoolValue} 
              {order.delivery_fee ? ` | Fee: ₹${order.delivery_fee}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {order.participants.length > 0 && (
              <button onClick={handleWhatsAppBlast} className="px-3 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition font-bold text-xs flex items-center gap-1"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> Blast</button>
            )}
            <button onClick={handleRefresh} disabled={isRefreshing} className="p-2 bg-purple-50 text-purple-600 rounded-xl hover:bg-purple-100 transition"><svg className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-xl transition"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        </div>

        {order.participants.length === 0 ? (
          <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed"><p className="text-gray-500 font-medium">Waiting for people to join...</p></div>
        ) : (
          <div className="space-y-4">
            {order.participants.map((p, idx) => (
              <div key={idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex justify-between items-start">
                <div className="w-full">
                  <div className="flex items-center mb-1">
                    <h4 className="font-bold text-gray-900">{p.user_name} <span className="text-xs text-gray-400 font-normal">({p.contact_number})</span></h4>
                    {order.status === 'open' && (
                      <button onClick={() => handleKick(p.user_id, p.user_name)} className="p-1.5 ml-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title={`Remove ${p.user_name}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                    )}
                  </div>
                  <ul className="mt-2 space-y-2">
                    {p.items.map((item, i) => (
                      <li key={i} className="text-sm text-gray-600 flex items-center justify-between border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                        <span><span className="font-black text-gray-900">{item.quantity}x</span> {item.item_name}</span>
                        <span className="text-xs text-gray-400 text-right">(₹{item.estimated_price} / unit) <br/><span className="text-sm font-bold text-gray-900">Total: ₹{item.estimated_price * item.quantity}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-2 ml-4 shrink-0">
                  <a href={`https://wa.me/91${p.contact_number.replace(/\D/g, '')}`} target="_blank" className="p-2 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition" title="WhatsApp"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></a>
                  <a href={`tel:+91${p.contact_number.replace(/\D/g, '')}`} className="p-2 bg-blue-100 text-blue-700 rounded-xl hover:bg-blue-200 transition" title="Call"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg></a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 🚨 THE NEW SETTLE BOX (Only shows when food has arrived) */}
        {order.status === 'delivered' && (
          <div className="mt-6 p-5 bg-green-50 border border-green-200 rounded-2xl animate-fade-in-up">
            <h4 className="text-sm font-black text-green-900 mb-2">Order Complete?</h4>
            <p className="text-xs text-green-800 mb-4">Once everyone has paid you back, click below to archive this order and remove it from your active feed.</p>
            <button onClick={handleSettle} disabled={isRefreshing} className="w-full py-3 bg-green-600 text-white font-black rounded-xl hover:bg-green-700 transition disabled:opacity-50 shadow-sm">
              Close & Archive Order
            </button>
          </div>
        )}

        {order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'settled' && (
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
// THE CREATE MODAL (Host Form)
// ==========================================
function CreateOrderModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const [formData, setFormData] = useState({ app_name: 'Blinkit', pickup_location: '', contact_number: '', expires_in_minutes: 15, upi_id: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setIsSubmitting(true);
    try { const token = await auth.currentUser?.getIdToken(); if (token) { await createGroupOrder(token, formData); onSuccess(); } } 
    catch (err) { setIsSubmitting(false); alert("Error creating order"); }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl animate-fade-in-up">
        <h2 className="text-2xl font-black text-gray-900 mb-6">Start a Group Order</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-xs font-bold text-gray-700 mb-1 uppercase">App</label><select value={formData.app_name} onChange={(e) => setFormData({...formData, app_name: e.target.value})} className="w-full p-3 bg-gray-50 border rounded-xl"><option>Blinkit</option><option>Zepto</option><option>Zomato</option><option>Swiggy</option></select></div>
          <div><label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Meeting Location</label><input type="text" required value={formData.pickup_location} onChange={(e) => setFormData({...formData, pickup_location: e.target.value})} className="w-full p-3 bg-gray-50 border rounded-xl" /></div>
          
          <div className="flex gap-4">
            <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Your Phone</label><input type="tel" required value={formData.contact_number} onChange={(e) => setFormData({...formData, contact_number: e.target.value})} className="w-full p-3 bg-gray-50 border rounded-xl" /></div>
            <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1 uppercase">UPI ID <span className="text-gray-400 font-normal">(Opt)</span></label><input type="text" placeholder="e.g. name@okhdfc" value={formData.upi_id} onChange={(e) => setFormData({...formData, upi_id: e.target.value})} className="w-full p-3 bg-gray-50 border rounded-xl" /></div>
          </div>

          <div><label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Cutoff Time</label><select value={formData.expires_in_minutes} onChange={(e) => setFormData({...formData, expires_in_minutes: Number(e.target.value)})} className="w-full p-3 bg-gray-50 border rounded-xl"><option value={15}>In 15 Mins</option><option value={30}>In 30 Mins</option><option value={60}>In 1 Hour</option></select></div>
          <div className="pt-4 flex gap-3"><button type="button" onClick={onClose} className="px-6 py-3 bg-gray-100 font-bold rounded-xl hover:bg-gray-200 transition">Cancel</button><button type="submit" disabled={isSubmitting} className="flex-1 py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700">{isSubmitting ? 'Starting...' : 'Broadcast Order'}</button></div>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// THE JOIN MODAL (Multi-Item Cart System)
// ==========================================
function JoinOrderModal({ order, onClose, router }: { order: GroupOrder, onClose: () => void, router: any }) {
  const [cart, setCart] = useState<PoolItem[]>([]);
  const [contactNumber, setContactNumber] = useState('');
  const [itemName, setItemName] = useState(''); const [qty, setQty] = useState(1); const [price, setPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddToCart = (e: React.FormEvent) => {
    e.preventDefault(); if (!itemName || !price) return;
    setCart([...cart, { item_name: itemName, quantity: qty, estimated_price: Number(price) }]);
    setItemName(''); setQty(1); setPrice(''); 
  };

  const handleFinalSubmit = async () => {
    if (cart.length === 0 || !contactNumber) return alert("Add an item and your phone number first!");
    setIsSubmitting(true);
    try { const token = await auth.currentUser?.getIdToken(); if (token) { await joinGroupOrder(token, order.id, { contact_number: contactNumber, items: cart }); router.push(`/chat/${order.chat_room_id}`); } } 
    catch (err) { setIsSubmitting(false); alert("Failed to join order"); }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl animate-fade-in-up">
        <div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-black text-gray-900">Add Your Items</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-900 text-3xl">&times;</button></div>
        {cart.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-2xl">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Your Cart</h4>
            <ul className="space-y-2">
              {cart.map((c, i) => (
                <li key={i} className="text-sm font-medium flex justify-between border-b border-gray-200 pb-1 last:border-0 last:pb-0">
                  <span><span className="font-black text-purple-600">{c.quantity}x</span> {c.item_name} <span className="text-xs text-gray-400 ml-1">(₹{c.estimated_price}/unit)</span></span>
                  <span className="text-gray-900 font-bold">₹{c.estimated_price * c.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form onSubmit={handleAddToCart} className="space-y-4 mb-6 pb-6 border-b border-gray-100">
          <div><label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Item Name</label><input type="text" value={itemName} onChange={e => setItemName(e.target.value)} placeholder="e.g., Maggi Masala" className="w-full p-3 bg-white border border-gray-300 shadow-sm rounded-xl" required /></div>
          <div className="flex gap-4">
            <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Qty</label><input type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} className="w-full p-3 bg-white border border-gray-300 shadow-sm rounded-xl" required /></div>
            <div className="flex-1"><label className="block text-xs font-bold text-gray-700 mb-1 uppercase">Unit Cost (₹)</label><input type="number" min="1" value={price} onChange={e => setPrice(e.target.value)} placeholder="₹" className="w-full p-3 bg-white border border-gray-300 shadow-sm rounded-xl" required /></div>
          </div>
          <button type="submit" className="w-full py-2 bg-gray-100 text-gray-900 font-bold rounded-xl hover:bg-gray-200 border border-gray-200 border-dashed transition">+ Add to Order List</button>
        </form>
        <div className="space-y-4">
          <div><label className="block text-xs font-bold text-gray-700 mb-1 uppercase text-purple-600">Your Phone (Required)</label><input type="tel" value={contactNumber} onChange={e => setContactNumber(e.target.value)} placeholder="For Host WhatsApp..." className="w-full p-3 bg-purple-50 border border-purple-200 rounded-xl outline-none focus:border-purple-600" required /></div>
          <button onClick={handleFinalSubmit} disabled={cart.length === 0 || !contactNumber || isSubmitting} className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition disabled:opacity-50">{isSubmitting ? 'Joining...' : 'Done & Enter Chat'}</button>
        </div>
      </div>
    </div>
  );
}