'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { 
  getPendingShops, verifyShop, rejectShop, Shop,
  setUserRole,
  getAllSupportTickets, warnUser, getAllUsers, moderateUser 
} from '@/lib/api';

type AdminTab = 'shops' | 'users' | 'support';

type ExtendedShop = Shop & {
  category?: string;
  phone?: string;
  location?: string;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const { profile, isLoading: isAuthLoading } = useAuth();
  
  const [activeTab, setActiveTab] = useState<AdminTab>('shops');
  const [isDataLoading, setIsDataLoading] = useState(false);

  // Tab States
  const [pendingShops, setPendingShops] = useState<ExtendedShop[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  
  // User Directory State
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newRole, setNewRole] = useState('guest');
  const [userFilterTab, setUserFilterTab] = useState('all');

  // Warning/Action State
  const [warnSubject, setWarnSubject] = useState('⚠️ Official Warning: Policy Violation');
  const [warnMessage, setWarnMessage] = useState('');
  const [isWarning, setIsWarning] = useState(false);

  // Support Filters
  const [supportView, setSupportView] = useState<'inbox' | 'audit'>('inbox');
  const [auditTarget, setAuditTarget] = useState<'all' | 'users' | 'items'>('all');
  const [auditAction, setAuditAction] = useState<'all' | 'warn' | 'ban' | 'nuke' | 'hide' | 'delete' | 'restore'>('all');
  
  // Inbox Filters
  const [inboxFilter, setInboxFilter] = useState<'all' | 'needs_reply' | 'general' | 'moderation'>('needs_reply');
  const [moderationTarget, setModerationTarget] = useState<'all' | 'users' | 'items'>('all');

  // --- PROTECTOR ---
  useEffect(() => {
    if (isAuthLoading) return;
    if (!profile) {
      router.push('/login');
      return;
    }
  }, [profile, isAuthLoading, router]);

  // --- DATA FETCHING ---
  useEffect(() => {
    const fetchAdminData = async () => {
      if (!profile || profile.role !== 'admin') return;

      try {
        setIsDataLoading(true);
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
        setIsDataLoading(false);
      }
    };
    fetchAdminData();
  }, [profile, activeTab, isAuthLoading]);

  // --- SHOP HANDLERS ---
  const handleVerify = async (shopId: string) => {
    if (!window.confirm("Approve this shop to go live?")) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      await verifyShop(token, shopId);
      setPendingShops(pendingShops.filter(s => s.id !== shopId));
    } catch (error) { alert("Failed to verify shop."); }
  };

  const handleReject = async (shopId: string) => {
    const reason = window.prompt("Reason for rejection:");
    if (!reason) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      await rejectShop(token, shopId, reason);
      setPendingShops(pendingShops.filter(s => s.id !== shopId));
    } catch (error) { alert("Failed to reject shop."); }
  };

  const handleQuickRestore = async () => {
    if (!selectedUser) return;
    if (!window.confirm(`Instantly unban ${selectedUser.email}?`)) return;
    
    try {
      setIsWarning(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      
      await moderateUser(token, selectedUser.uid, 'restore', 'Quick Unban via Directory', 'QUICK_ACTION_LOG');
      
      alert(`${selectedUser.email} has been unbanned!`);
      setSelectedUser({ ...selectedUser, role: 'student', status: 'active' });
      setAllUsers(allUsers.map(u => u.uid === selectedUser.uid ? { ...u, role: 'student', status: 'active' } : u));
    } catch (error) {
      alert("Failed to execute Quick Unban.");
    } finally {
      setIsWarning(false);
    }
  };

  // --- FILTER LOGIC ---
  const filteredTickets = tickets.filter(ticket => {
    const currentStatus = ticket.status || 'open';
    if (supportView === 'inbox' && currentStatus === 'resolved') return false;
    if (supportView === 'audit' && currentStatus !== 'resolved') return false;

    // Helper flag for both views
    const isUserTicket = ticket.listing_id === 'USER_MODERATION' || ticket.listing_id === 'system_warning';

    if (supportView === 'inbox') {
      const needsReply = ticket.last_sender_id !== 'ADMIN_TEAM' && currentStatus !== 'resolved';
      const isGeneral = ticket.listing_id === 'system_support';
      const isModeration = !isGeneral;

      if (inboxFilter === 'needs_reply' && !needsReply) return false;
      if (inboxFilter === 'general' && !isGeneral) return false;
      
      if (inboxFilter === 'moderation') {
        if (!isModeration) return false;
        if (moderationTarget === 'users' && !isUserTicket) return false;
        if (moderationTarget === 'items' && isUserTicket) return false;
      }
    }

    if (supportView === 'audit') {
      if (auditTarget === 'users' && !isUserTicket) return false;
      if (auditTarget === 'items' && isUserTicket) return false;
      if (auditAction !== 'all' && ticket.resolution_action !== auditAction) return false;
    }
    return true;
  });

  // --- RENDER LOGIC ---
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-gray-500">Securing Admin Session...</p>
      </div>
    );
  }

  if (!profile) return null;

  if (profile.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 text-center">
        <h1 className="text-4xl text-red-500 mb-4">⛔</h1>
        <h2 className="text-2xl font-bold text-gray-900">Access Restricted</h2>
        <p className="text-gray-500 mt-2">This panel is for administrators only.</p>
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
             {isDataLoading ? (
               <div className="py-20 text-center font-bold text-gray-400">Loading shop data...</div>
             ) : pendingShops.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🏪</div>
                <h3 className="text-xl font-bold text-gray-900">Inbox Zero!</h3>
                <p className="text-gray-500 mt-1">No pending shop applications.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {pendingShops.map((shop) => (
                  <div key={shop.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col hover:shadow-md transition-shadow">
                    
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-black text-gray-900 line-clamp-1">
                          {shop.shop_name || shop.name || "Unnamed Shop"}
                        </h3>
                        <p className="text-sm font-medium text-gray-500 mt-1 flex items-center gap-1.5">
                           <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" /></svg>
                           {shop.owner_email}
                        </p>
                      </div>
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-widest rounded-lg border border-blue-100 whitespace-nowrap">
                        {shop.category || 'Retail'}
                      </span>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-4 flex-1">
                      <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Business Pitch</h4>
                      <p className="text-sm text-gray-700 font-medium leading-relaxed">
                        {shop.description || "No description provided by the applicant."}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6 p-4 border border-gray-100 rounded-2xl bg-white shadow-sm">
                       <div>
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">Contact Phone</span>
                          <p className="text-sm font-bold text-gray-900">{shop.phone || 'Not Provided'}</p>
                       </div>
                       <div>
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">Campus Location</span>
                          <p className="text-sm font-bold text-gray-900 line-clamp-1">{shop.location || 'Online / Remote'}</p>
                       </div>
                       
                       <div className="col-span-2 pt-3 border-t border-gray-50 mt-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Storefront Catalog</span>
                            <span className="text-[11px] font-bold text-orange-600 flex items-center gap-1 bg-orange-50 px-2 py-1 rounded-md border border-orange-100">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                              Locked until approved
                            </span>
                          </div>
                       </div>
                    </div>

                    <div className="flex gap-3 mt-auto pt-4 border-t border-gray-100">
                      <button onClick={() => handleReject(shop.id)} className="px-5 py-3 bg-red-50 hover:bg-red-100 text-red-700 font-bold text-sm rounded-xl border border-red-200 transition shadow-sm">
                        Reject
                      </button>
                      <button onClick={() => handleVerify(shop.id)} className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold text-sm rounded-xl shadow-sm transition flex justify-center items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Approve Business
                      </button>
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
                {isDataLoading ? (
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
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${user.role === 'banned' ? 'text-red-600' : 'text-gray-500'}`}>{user.role || 'guest'}</span>
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

                  {(selectedUser.role === 'banned' || selectedUser.status === 'banned') && (
                    <div className="bg-orange-50 border border-orange-200 p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                      <div>
                        <h3 className="font-black text-orange-800 text-base flex items-center gap-2">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          Account Suspended
                        </h3>
                        <p className="text-orange-700 text-xs mt-1 font-medium">This user is locked in read-only mode.</p>
                      </div>
                      <button 
                        onClick={handleQuickRestore} 
                        disabled={isWarning}
                        className="px-6 py-2.5 bg-green-600 text-white font-bold text-sm rounded-xl hover:bg-green-700 shadow-md disabled:opacity-50 transition w-full sm:w-auto flex justify-center items-center gap-2"
                      >
                        {isWarning ? 'Restoring...' : '⚡ Quick Unban'}
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-2">Change User Role Manually</label>
                    <div className="flex gap-2">
                      <select 
                        value={newRole} onChange={(e) => setNewRole(e.target.value)}
                        className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm font-medium"
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
                      }} className="px-6 py-3 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition">
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
                        if (response.room_id) router.push(`/chat/${response.room_id}`);
                      } catch (error) { alert("Failed to send warning."); } 
                      finally { setIsWarning(false); }
                    }} className="space-y-3">
                      <input 
                        type="text" required
                        value={warnSubject} onChange={(e) => setWarnSubject(e.target.value)}
                        className="w-full p-3 bg-white border border-red-200 rounded-xl outline-none text-sm font-medium"
                        placeholder="Warning Subject..."
                      />
                      <textarea 
                        required rows={3}
                        value={warnMessage} onChange={(e) => setWarnMessage(e.target.value)}
                        className="w-full p-3 bg-white border border-red-200 rounded-xl outline-none text-sm font-medium"
                        placeholder={`Type the official warning message to ${selectedUser.email}...`}
                      />
                      <button 
                        type="submit" disabled={isWarning}
                        className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition shadow-sm disabled:opacity-50 text-sm"
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
            
            <div className="flex bg-gray-200 p-1 rounded-xl w-full max-w-md mx-auto mb-6">
              <button onClick={() => setSupportView('inbox')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${supportView === 'inbox' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                📥 Active Inbox
              </button>
              <button onClick={() => setSupportView('audit')} className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${supportView === 'audit' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                🛡️ Audit Log (Resolved)
              </button>
            </div>

            {supportView === 'inbox' && (
              <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-200 flex overflow-x-auto gap-2" style={{ scrollbarWidth: 'none' }}>
                <button onClick={() => setInboxFilter('all')} className={`px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex-1 ${inboxFilter === 'all' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50'}`}>
                  📋 All Active
                </button>
                <button onClick={() => setInboxFilter('needs_reply')} className={`px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex-1 ${inboxFilter === 'needs_reply' ? 'bg-red-100 text-red-700 shadow-sm border border-red-200' : 'text-gray-500 hover:bg-gray-50'}`}>
                  🔴 Needs Reply
                </button>
                <button onClick={() => setInboxFilter('moderation')} className={`px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex-1 ${inboxFilter === 'moderation' ? 'bg-orange-100 text-orange-800 shadow-sm border border-orange-200' : 'text-gray-500 hover:bg-gray-50'}`}>
                  ⚠️ Moderation & Appeals
                </button>
                <button onClick={() => setInboxFilter('general')} className={`px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors flex-1 ${inboxFilter === 'general' ? 'bg-blue-100 text-blue-700 shadow-sm border border-blue-200' : 'text-gray-500 hover:bg-gray-50'}`}>
                  💬 General Support
                </button>
              </div>
            )}

            {supportView === 'inbox' && inboxFilter === 'moderation' && (
              <div className="flex gap-2 mb-2 animate-fade-in-up overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
                <button onClick={() => setModerationTarget('all')} className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition ${moderationTarget === 'all' ? 'bg-orange-100 text-orange-800 border border-orange-200 shadow-sm' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  All Moderation
                </button>
                <button onClick={() => setModerationTarget('users')} className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition ${moderationTarget === 'users' ? 'bg-purple-100 text-purple-800 border border-purple-200 shadow-sm' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  👤 User Rules & Appeals
                </button>
                <button onClick={() => setModerationTarget('items')} className={`px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition ${moderationTarget === 'items' ? 'bg-teal-100 text-teal-800 border border-teal-200 shadow-sm' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  📦 Product Reports
                </button>
              </div>
            )}

            {supportView === 'audit' && (
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-200 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                  
                  <div className="flex items-center gap-2 overflow-x-auto flex-1" style={{ scrollbarWidth: 'none' }}>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-2">Target:</span>
                    {['all', 'users', 'items'].map(target => (
                      <button key={target} onClick={() => setAuditTarget(target as any)} className={`px-5 py-2.5 text-xs font-bold rounded-xl capitalize whitespace-nowrap transition-colors ${auditTarget === target ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
                        {target === 'users' ? '👤 Users' : target === 'items' ? '📦 Products' : target}
                      </button>
                    ))}
                  </div>

                  <div className="hidden sm:block w-px h-10 bg-gray-200"></div>

                  <div className="flex items-center gap-2 overflow-x-auto flex-1" style={{ scrollbarWidth: 'none' }}>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mr-2">Action:</span>
                    {['all', 'warn', 'ban', 'nuke', 'hide', 'delete', 'restore'].map(action => (
                      <button key={action} onClick={() => setAuditAction(action as any)} className={`px-5 py-2.5 text-xs font-bold rounded-xl capitalize whitespace-nowrap transition-colors ${auditAction === action ? 'bg-blue-100 text-blue-800 border border-blue-300 shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
                        {action === 'ban' ? 'Suspended' : action}
                      </button>
                    ))}
                  </div>

                </div>
              </div>
            )}

            <div className="mt-4">
              {isDataLoading ? <p className="text-center text-gray-500 font-bold py-10">Loading database...</p> : (
                <div className="grid grid-cols-1 gap-4">
                  {filteredTickets.map((ticket) => {
                      const isUserTicket = ticket.listing_id === 'USER_MODERATION' || ticket.listing_id === 'system_warning';
                      const act = ticket.resolution_action;
                      const needsReply = ticket.last_sender_id !== 'ADMIN_TEAM' && ticket.status !== 'resolved';
                      
                      return (
                        <div key={ticket.id} className={`bg-white p-6 rounded-3xl border shadow-sm flex flex-col sm:flex-row justify-between gap-4 hover:shadow-md transition-shadow ${needsReply ? 'border-l-4 border-l-red-500 bg-red-50/40' : (ticket.status === 'resolved' ? 'border-l-4 border-l-gray-400 opacity-90' : 'border-l-4 border-l-blue-500')}`}>
                          <div>
                            <div className="flex items-center flex-wrap gap-2 mb-3">
                              
                              {needsReply && (
                                <span className="px-2.5 py-1 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg shadow-sm animate-pulse flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                  Needs Reply
                                </span>
                              )}
                              
                              <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border ${ticket.status === 'resolved' ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                                {ticket.status || 'open'}
                              </span>
                              
                              {ticket.listing_id === 'system_support' ? (
                                 <span className="px-2.5 py-1 text-[10px] font-black uppercase rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1">
                                   <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                                   General
                                 </span>
                              ) : (
                                 <span className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-lg border flex items-center gap-1 ${isUserTicket ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
                                   {isUserTicket ? (
                                     <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> User Rules</>
                                   ) : (
                                     <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg> Catalog Rules</>
                                   )}
                                 </span>
                              )}

                              {act && (
                                <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg border ${
                                  act === 'nuke' || act === 'delete' ? 'bg-red-50 text-red-700 border-red-200' :
                                  act === 'ban' || act === 'hide' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                  act === 'restore' ? 'bg-green-50 text-green-700 border-green-200' :
                                  'bg-yellow-50 text-yellow-700 border-yellow-200'
                                }`}>
                                  {act === 'ban' ? 'Suspended' : act === 'nuke' ? '☢️ Nuked' : act}
                                </span>
                              )}
                            </div>
                            
                            <h3 className={`font-bold text-lg ${needsReply ? 'text-red-900' : 'text-gray-900'}`}>{ticket.subject}</h3>
                            
                            {/* Hide empty bid strings gracefully */}
                            {ticket.description || (ticket.last_message && !ticket.last_message.startsWith('Bid: ₹')) ? (
                               <p className="text-sm text-gray-600 mb-2 line-clamp-2 font-medium">{ticket.description || ticket.last_message}</p>
                            ) : null}
                            
                            <p className="text-[10px] text-gray-400 font-mono mt-1">ID Tracker: {ticket.listing_id === 'USER_MODERATION' ? ticket.buyer_id : ticket.listing_id}</p>
                          </div>
                          
                          <button 
                            onClick={() => router.push(`/chat/${ticket.chat_room_id || ticket.id}`)}
                            className={`self-start px-6 py-3 text-sm font-bold rounded-xl whitespace-nowrap transition-all ${ticket.status === 'resolved' ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : (needsReply ? 'bg-red-600 hover:bg-red-700 text-white shadow-md ring-2 ring-red-200 ring-offset-2' : 'bg-gray-900 hover:bg-gray-800 text-white shadow-md')}`}
                          >
                            {ticket.status === 'resolved' ? 'View Log' : (needsReply ? 'Reply Now →' : 'Open Ticket')}
                          </button>
                        </div>
                      );
                    })}
                    
                    {filteredTickets.length === 0 && (
                      <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-300">
                        <h3 className="text-xl font-bold text-gray-400">Inbox Zero!</h3>
                        <p className="text-sm text-gray-400 mt-2">No tickets match this filter.</p>
                      </div>
                    )}
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}