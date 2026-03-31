'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { 
  getPendingShops, verifyShop, rejectShop, Shop,
  setUserRole,
  getAllSupportTickets, warnUser, getAllUsers 
} from '@/lib/api';

type AdminTab = 'shops' | 'users' | 'support';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { profile } = useAuth();
  
  const [activeTab, setActiveTab] = useState<AdminTab>('shops');
  const [isLoading, setIsLoading] = useState(false);

  // Tab States
  const [pendingShops, setPendingShops] = useState<Shop[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  
  // User Directory State
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newRole, setNewRole] = useState('guest');
  const [userFilterTab, setUserFilterTab] = useState('all');

  // Warning State
  const [warnSubject, setWarnSubject] = useState('⚠️ Official Warning: Policy Violation');
  const [warnMessage, setWarnMessage] = useState('');
  const [isWarning, setIsWarning] = useState(false);

  // Support Audit Log Filters
  const [supportView, setSupportView] = useState<'inbox' | 'audit'>('inbox');
  const [auditTarget, setAuditTarget] = useState<'all' | 'users' | 'items'>('all');
  const [auditAction, setAuditAction] = useState<'all' | 'warn' | 'ban' | 'nuke' | 'hide' | 'delete' | 'restore'>('all');
  
  // Inbox Filter State
  const [inboxFilter, setInboxFilter] = useState<'all' | 'reports' | 'disputes' | 'high_priority'>('all');

  // Fetch Data based on Active Tab
  useEffect(() => {
    const fetchAdminData = async () => {
      if (!profile || profile.role !== 'admin') return;
      try {
        setIsLoading(true);
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        if (activeTab === 'shops') {
          const shops = await getPendingShops(token);
          setPendingShops(shops);
        } else if (activeTab === 'support') {
          const allTickets = await getAllSupportTickets(token);
          setTickets(allTickets);
        } else if (activeTab === 'users') { 
          const usersList = await getAllUsers(token);
          setAllUsers(usersList);
        }
      } catch (error) {
        console.error("Failed to fetch admin data:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAdminData();
  }, [profile, activeTab]);

  // --- SHOP HANDLERS ---
  const handleVerify = async (shopId: string) => {
    if (!window.confirm("Approve this shop to go live?")) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      await verifyShop(token, shopId);
      setPendingShops(pendingShops.filter(s => s.id !== shopId));
      alert("Shop verified successfully!");
    } catch (error) {
      alert("Failed to verify shop.");
    }
  };

  const handleReject = async (shopId: string) => {
    const reason = window.prompt("Reason for rejection:");
    if (!reason) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      await rejectShop(token, shopId, reason);
      setPendingShops(pendingShops.filter(s => s.id !== shopId));
      alert("Shop rejected.");
    } catch (error) {
      alert("Failed to reject shop.");
    }
  };

  const handleOpenTicketChat = (chatRoomId: string) => {
    if (!chatRoomId) {
      alert("Chat room ID missing for this ticket.");
      return;
    }
    router.push(`/chat/${chatRoomId}`);
  };

  // 🚨 NEW: Filter Logic Pre-Processed for Legacy Tickets
  const filteredTickets = tickets.filter(ticket => {
    // 1. Legacy Check: If an old ticket has no status, treat it as 'open'
    const currentStatus = ticket.status || 'open';
    
    // 2. Master View Toggle
    if (supportView === 'inbox' && currentStatus === 'resolved') return false;
    if (supportView === 'audit' && currentStatus !== 'resolved') return false;

    // 3. Inbox Filters Logic
    if (supportView === 'inbox') {
      const isUserTicket = ticket.listing_id === 'USER_MODERATION';
      // A report is either an item explicitly tied to a listing ID, OR it has the word 'REPORT'
      const isReport = (ticket.listing_id && !isUserTicket) || ticket.subject?.includes('REPORT') || ticket.subject?.includes('🚩');
      
      if (inboxFilter === 'reports' && !isReport) return false;
      if (inboxFilter === 'disputes' && isReport) return false; 
      if (inboxFilter === 'high_priority' && ticket.severity !== 'high') return false;
    }

    // 4. Audit Filters Logic
    if (supportView === 'audit') {
      const isUserTicket = ticket.listing_id === 'USER_MODERATION';
      if (auditTarget === 'users' && !isUserTicket) return false;
      if (auditTarget === 'items' && isUserTicket) return false;
      if (auditAction !== 'all' && ticket.resolution_action !== auditAction) return false;
    }
    
    return true;
  });

  if (profile === undefined) return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  if (profile === null || profile.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 text-center">
        <h1 className="text-4xl text-red-500 mb-4">⛔</h1>
        <h2 className="text-2xl font-bold text-gray-900">Access Restricted</h2>
        <button onClick={() => router.push('/')} className="mt-6 px-6 py-2 bg-gray-900 text-white font-bold rounded-xl">Go Home</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        
        <div className="mb-8">
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Admin Control Center</h1>
          <p className="text-gray-500">Manage shops, users, and support tickets.</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto gap-2 mb-8 border-b border-gray-200 pb-2">
          {(['shops', 'users', 'support'] as AdminTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm capitalize transition-colors whitespace-nowrap ${
                activeTab === tab ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {tab === 'shops' ? 'Pending Shops' : tab}
            </button>
          ))}
        </div>

        {/* --- TAB: PENDING SHOPS --- */}
        {activeTab === 'shops' && (
          <div className="space-y-4">
             {isLoading ? <p>Loading...</p> : pendingShops.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                <h3 className="text-xl font-bold text-gray-900">Inbox Zero!</h3>
                <p className="text-gray-500">No pending shop applications.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingShops.map((shop) => (
                  <div key={shop.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                    <h3 className="text-xl font-bold text-gray-900">{shop.shop_name || shop.name}</h3>
                    <p className="text-sm text-gray-500 mb-4">{shop.owner_email}</p>
                    <p className="text-sm bg-gray-50 p-3 rounded-lg border border-gray-100 mb-4">{shop.description}</p>
                    <div className="flex gap-3">
                      <button onClick={() => handleVerify(shop.id)} className="flex-1 py-2 bg-green-600 text-white font-bold rounded-xl">Approve</button>
                      <button onClick={() => handleReject(shop.id)} className="flex-1 py-2 bg-red-50 text-red-600 font-bold rounded-xl border border-red-200">Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- TAB: USERS DIRECTORY --- */}
        {activeTab === 'users' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            <div className="md:col-span-1 bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col h-[600px]">
              <h2 className="text-xl font-bold mb-4">User Directory</h2>
              
              <input 
                type="text" placeholder="Filter by email or name..."
                value={userSearchTerm} onChange={(e) => setUserSearchTerm(e.target.value)}
                className="w-full p-3 mb-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm"
              />

              <div className="flex gap-2 overflow-x-auto mb-4 pb-2" style={{ scrollbarWidth: 'none' }}>
                {['all', 'student', 'shop_verified', 'admin', 'banned', 'guest'].map((role) => (
                  <button
                    key={role}
                    onClick={() => setUserFilterTab(role)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg whitespace-nowrap transition-colors ${
                      userFilterTab === role 
                        ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                        : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {role === 'shop_verified' ? 'Shop' : role}
                  </button>
                ))}
              </div>

              <div className="overflow-y-auto flex-1 space-y-2 pr-2">
                {isLoading ? (
                  <p className="text-sm text-gray-500 text-center mt-10">Loading users...</p>
                ) : (
                  allUsers
                    .filter(u => {
                      const matchesSearch = u.email?.toLowerCase().includes(userSearchTerm.toLowerCase());
                      const userRole = u.role || 'guest';
                      const matchesTab = userFilterTab === 'all' || userRole === userFilterTab;
                      return matchesSearch && matchesTab;
                    })
                    .map(user => (
                      <button 
                        key={user.uid}
                        onClick={() => {
                          setSelectedUser(user);
                          setNewRole(user.role || 'guest');
                        }}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${selectedUser?.uid === user.uid ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100 hover:border-gray-300'}`}
                      >
                        <p className="font-bold text-sm text-gray-900 truncate">{user.email}</p>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{user.role || 'guest'}</span>
                          {user.strikes > 0 && <span className="text-xs">⚠️</span>}
                        </div>
                      </button>
                    ))
                )}
              </div>
            </div>

            <div className="md:col-span-2">
              {!selectedUser ? (
                <div className="h-full bg-white rounded-3xl border border-dashed border-gray-300 flex items-center justify-center p-8 text-center min-h-[400px]">
                  <p className="text-gray-500 font-medium">Select a user from the directory to manage their account.</p>
                </div>
              ) : (
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
                  
                  <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                    <div>
                      <h2 className="text-2xl font-black text-gray-900">{selectedUser.email}</h2>
                      <p className="text-xs text-gray-400 mt-1 font-mono">UID: {selectedUser.uid}</p>
                    </div>
                    {selectedUser.strikes > 0 && (
                      <div className="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-sm font-bold border border-red-200">
                        {selectedUser.strikes} Strike(s)
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-2">Change User Role</label>
                    <div className="flex gap-2">
                      <select 
                        value={newRole} onChange={(e) => setNewRole(e.target.value)}
                        className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none"
                      >
                        <option value="guest">Guest</option>
                        <option value="student">Student</option>
                        <option value="shop_verified">Verified Shop</option>
                        <option value="admin">Admin</option>
                        <option value="banned">Banned</option>
                      </select>
                      <button onClick={async () => {
                        try {
                          const token = await auth.currentUser?.getIdToken();
                          if (!token) return;
                          await setUserRole(token, selectedUser.uid, newRole);
                          alert(`Role updated to ${newRole}!`);
                          setSelectedUser({ ...selectedUser, role: newRole });
                          setAllUsers(allUsers.map(u => u.uid === selectedUser.uid ? { ...u, role: newRole } : u));
                        } catch (err) { alert("Failed to update role."); }
                      }} className="px-6 py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition">
                        Update
                      </button>
                    </div>
                  </div>

                  <div className="p-5 bg-red-50 rounded-2xl border border-red-100">
                    <h3 className="text-red-800 font-bold mb-3 flex items-center gap-2">
                      🛡️ Issue Official Warning
                    </h3>
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      if (!window.confirm(`Open an official warning thread with ${selectedUser.email}?`)) return;
                      try {
                        setIsWarning(true);
                        const token = await auth.currentUser?.getIdToken();
                        if (!token) return;
                        
                        const response = await warnUser(token, selectedUser.uid, warnSubject, warnMessage);
                        
                        setWarnMessage(''); 
                        setWarnSubject('⚠️ Official Warning: Policy Violation');
                        
                        if (response.room_id) {
                          router.push(`/chat/${response.room_id}`);
                        } else {
                          alert("Warning sent! A support chat has been opened in the user's inbox.");
                        }

                      } catch (error) { 
                        alert("Failed to send warning."); 
                      } finally { 
                        setIsWarning(false); 
                      }
                    }} className="space-y-3">
                      <input 
                        type="text" required
                        value={warnSubject} onChange={(e) => setWarnSubject(e.target.value)}
                        className="w-full p-3 bg-white border border-red-200 rounded-xl outline-none text-sm"
                        placeholder="Warning Subject..."
                      />
                      <textarea 
                        required rows={3}
                        value={warnMessage} onChange={(e) => setWarnMessage(e.target.value)}
                        className="w-full p-3 bg-white border border-red-200 rounded-xl outline-none text-sm"
                        placeholder={`Type the official warning message to ${selectedUser.email}...`}
                      />
                      <button 
                        type="submit" disabled={isWarning}
                        className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition disabled:opacity-50"
                      >
                        {isWarning ? 'Opening Chat...' : 'Open Moderation Chat'}
                      </button>
                    </form>
                  </div>

                </div>
              )}
            </div>
          </div>
        )}

        {/* --- TAB: SUPPORT & AUDIT LOG --- */}
        {activeTab === 'support' && (
          <div className="space-y-6">
            
            {/* 1. Top Level View Switcher (Inbox vs Audit Log) */}
            <div className="flex bg-gray-200 p-1 rounded-xl w-full max-w-md mx-auto mb-6">
              <button onClick={() => setSupportView('inbox')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${supportView === 'inbox' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                📥 Active Inbox
              </button>
              <button onClick={() => setSupportView('audit')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${supportView === 'audit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                🛡️ Audit Log (Resolved)
              </button>
            </div>

            {/* 2a. INBOX Filter Pills */}
            {supportView === 'inbox' && (
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mb-6 flex items-center gap-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Filter:</span>
                {[
                  { id: 'all', label: 'All Active' },
                  { id: 'reports', label: '🚩 Community Reports' },
                  { id: 'disputes', label: '⚠️ Active Disputes & Appeals' },
                  { id: 'high_priority', label: '🔥 High Priority' }
                ].map(filter => (
                  <button 
                    key={filter.id} 
                    onClick={() => setInboxFilter(filter.id as any)} 
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${inboxFilter === filter.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            )}

            {/* 2b. AUDIT Log Filter Pills */}
            {supportView === 'audit' && (
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mb-6 space-y-3">
                <div className="flex items-center gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Target:</span>
                  {['all', 'users', 'items'].map(target => (
                    <button key={target} onClick={() => setAuditTarget(target as any)} className={`px-3 py-1.5 text-xs font-bold rounded-lg capitalize whitespace-nowrap transition-colors ${auditTarget === target ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {target}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Action:</span>
                  {['all', 'warn', 'ban', 'nuke', 'hide', 'delete', 'restore'].map(action => (
                    <button key={action} onClick={() => setAuditAction(action as any)} className={`px-3 py-1.5 text-xs font-bold rounded-lg capitalize whitespace-nowrap transition-colors ${auditAction === action ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}>
                      {action === 'ban' ? 'Suspended' : action}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. The Tickets Render Logic */}
            {isLoading ? <p className="text-center text-gray-500 font-bold py-10">Loading database...</p> : (
              <div className="grid grid-cols-1 gap-4">
                {filteredTickets.map((ticket) => {
                    const isUserTicket = ticket.listing_id === 'USER_MODERATION';
                    const act = ticket.resolution_action;
                    
                    return (
                      <div key={ticket.id} className={`bg-white p-6 rounded-2xl border shadow-sm flex flex-col sm:flex-row justify-between gap-4 hover:shadow-md transition-shadow ${ticket.status === 'resolved' ? 'border-l-4 border-l-gray-400' : 'border-l-4 border-l-orange-500'}`}>
                        <div>
                          <div className="flex items-center flex-wrap gap-2 mb-2">
                            <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded ${ticket.status === 'resolved' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700 animate-pulse'}`}>
                              {ticket.status || 'open'}
                            </span>
                            
                            {ticket.severity === 'high' && supportView === 'inbox' && (
                               <span className="px-2 py-0.5 text-[10px] font-black uppercase rounded bg-red-100 text-red-700">🔥 High Priority</span>
                            )}
                            
                            <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded ${isUserTicket ? 'bg-purple-100 text-purple-700' : 'bg-teal-100 text-teal-700'}`}>
                              {isUserTicket ? '👤 User Account' : '📦 Catalog Item'}
                            </span>

                            {act && (
                              <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded border ${
                                act === 'nuke' || act === 'delete' ? 'bg-red-50 text-red-700 border-red-200' :
                                act === 'ban' || act === 'hide' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                act === 'restore' ? 'bg-green-50 text-green-700 border-green-200' :
                                'bg-yellow-50 text-yellow-700 border-yellow-200'
                              }`}>
                                {act === 'ban' ? 'Suspended' : act === 'nuke' ? '☢️ Nuked' : act}
                              </span>
                            )}
                          </div>
                          
                          <h3 className="font-bold text-gray-900">{ticket.subject}</h3>
                          <p className="text-sm text-gray-600 mb-2 line-clamp-2">{ticket.description || ticket.last_message}</p>
                          <p className="text-[10px] text-gray-400 font-mono">ID Tracker: {ticket.listing_id === 'USER_MODERATION' ? ticket.buyer_id : ticket.listing_id}</p>
                        </div>
                        
                        <button 
                          onClick={() => handleOpenTicketChat(ticket.chat_room_id || ticket.id)}
                          className={`self-start px-5 py-2.5 text-sm font-bold rounded-xl whitespace-nowrap transition-all ${ticket.status === 'resolved' ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-gray-900 hover:bg-gray-800 text-white shadow-md'}`}
                        >
                          {ticket.status === 'resolved' ? 'View Log →' : 'Open Ticket →'}
                        </button>
                      </div>
                    );
                  })}
                  
                  {/* 🚨 Empty State Handler now correctly checking filtered array */}
                  {filteredTickets.length === 0 && (
                    <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-300">
                      <h3 className="text-xl font-bold text-gray-400">Nothing here!</h3>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}