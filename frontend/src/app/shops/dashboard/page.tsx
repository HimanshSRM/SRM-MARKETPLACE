'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { 
  getLiveShops, 
  addCatalogItem, 
  updateCatalogItem,
  deleteCatalogItem, 
  updateShopProfile, 
  updateShopStatus, 
  updateShopNotice, 
  triggerFlashDeal 
} from '@/lib/api';
import Link from 'next/link';

// ==========================================
// THE EDIT SHOP MODAL COMPONENT
// ==========================================
function EditShopModal({ currentShop, onClose, onRefresh }: { currentShop: any, onClose: () => void, onRefresh: () => void }) {
  const [formData, setFormData] = useState({
    shop_name: currentShop?.shop_name || currentShop?.name || '',
    tagline: currentShop?.tagline || currentShop?.description || '', 
    contact_number: currentShop?.contact_number || currentShop?.phone_number || '',
    block: currentShop?.block || currentShop?.location || '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateShopProfile(currentShop.id, formData);
      alert("Shop profile updated successfully! 🎉");
      onRefresh(); 
      onClose();   
    } catch (error: any) {
      alert(error.message || "Failed to save changes.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    // 🚨 RESPONSIVE FIX: Added max-h-[90vh] and overflow-y-auto for mobile keyboards
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl animate-fade-in-up max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-black text-gray-900 mb-6">Edit Shop Profile</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Shop Name</label><input type="text" required value={formData.shop_name} onChange={(e) => setFormData({...formData, shop_name: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold" /></div>
          <div><label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone Number</label><input type="tel" required value={formData.contact_number} onChange={(e) => setFormData({...formData, contact_number: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold" /></div>
          <div><label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Block / Location</label><input type="text" value={formData.block} onChange={(e) => setFormData({...formData, block: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold" /></div>
          <div><label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Tagline / Short Description</label><textarea rows={2} required value={formData.tagline} onChange={(e) => setFormData({...formData, tagline: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold" /></div>
          <div className="flex gap-3 pt-4 mt-2 border-t">
            <button type="button" onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition">Cancel</button>
            <button type="submit" disabled={isSaving} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition disabled:opacity-50">{isSaving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// 🏪 MAIN DASHBOARD PAGE
// ==========================================
export default function ShopDashboardPage() {
  const router = useRouter();
  const { profile, isLoading: isAuthLoading } = useAuth();

  const [myShop, setMyShop] = useState<any>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false); 

  const [isOpen, setIsOpen] = useState(false);
  const [noticeText, setNoticeText] = useState("");
  const [isNoticeActive, setIsNoticeActive] = useState(false);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', price: '', category: 'General', in_stock: true });

  const [showDealForm, setShowDealForm] = useState(false);
  const [dealData, setDealData] = useState({ item_name: '', original_price: '', deal_price: '', duration_hours: '2' });

  const loadDashboardData = async () => {
    if (isAuthLoading) return;
    if (!profile) { setIsLoading(false); return; }

    try {
      setIsLoading(true);
      const allShops = await getLiveShops();
      const userShop = allShops.find((s: any) => s.owner_id === profile.uid);
      
      if (userShop) {
        setMyShop(userShop);
        setCatalog(userShop.catalog || []);
        setIsOpen(userShop.is_open || false);
        
        if (userShop.live_notice) {
          setNoticeText(userShop.live_notice.text || "");
          setIsNoticeActive(userShop.live_notice.is_active || false);
        }
      }
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadDashboardData(); }, [profile, isAuthLoading]);

  // --- HANDLERS ---
  const handleToggleStatus = async () => {
    try {
      const newStatus = !isOpen; setIsOpen(newStatus); 
      await updateShopStatus(newStatus);
    } catch (err) { alert("Failed to update status"); setIsOpen(!isOpen); }
  };

  const handleUpdateNotice = async () => {
    try {
      setIsSubmitting(true);
      await updateShopNotice(noticeText, isNoticeActive);
      alert("Notice board updated!");
    } catch (err) { alert("Failed to update notice."); } 
    finally { setIsSubmitting(false); }
  };

  const handleBroadcastDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.confirm("Broadcast this deal to the entire campus via Push Notification?")) return;
    try {
      setIsSubmitting(true);
      await triggerFlashDeal({ item_name: dealData.item_name, original_price: parseFloat(dealData.original_price), deal_price: parseFloat(dealData.deal_price), duration_hours: parseInt(dealData.duration_hours) });
      alert("⚡ Flash Deal Broadcasted successfully!");
      setShowDealForm(false);
    } catch (err) { alert("Failed to broadcast deal."); } 
    finally { setIsSubmitting(false); }
  };

  const handleEditClick = (item: any) => {
    setEditingItemId(item.id);
    setFormData({
      name: item.name || item.title || '',
      price: item.price !== undefined ? item.price.toString() : '',
      category: item.category || 'General',
      in_stock: item.in_stock ?? item.is_available ?? true,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setFormData({ name: '', price: '', category: 'General', in_stock: true });
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const payload = {
        name: formData.name, 
        price: parseFloat(formData.price),
        category: formData.category,
        in_stock: formData.in_stock,
      };

      if (editingItemId) {
        await updateCatalogItem(editingItemId, payload);
        setCatalog(catalog.map(item => item.id === editingItemId ? { ...item, ...payload } : item));
        handleCancelEdit();
      } else {
        const response : any = await addCatalogItem(payload);
        setCatalog([{ id: response.item_id || Date.now().toString(), ...payload }, ...catalog]);
        setFormData({ name: '', price: '', category: 'General', in_stock: true });
      }
    } catch (error) {
      alert("Failed to save item.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm("Delete this item permanently?")) return;
    try {
      await deleteCatalogItem(itemId);
      setCatalog(catalog.filter(item => item.id !== itemId));
    } catch (error) { alert("Failed to delete item."); }
  };

  if (isAuthLoading || isLoading) return <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center animate-pulse"><div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div><p className="font-bold text-gray-500">Loading Dashboard...</p></div>;
  if (!profile) return null;

  if (!myShop) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 max-w-md text-center">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🏪</div>
          <h2 className="text-2xl font-bold text-gray-900">No Shop Found</h2>
          <button onClick={() => router.push('/shop-application')} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl mt-4">Register a Shop</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 relative">
      {isEditModalOpen && <EditShopModal currentShop={myShop} onClose={() => setIsEditModalOpen(false)} onRefresh={loadDashboardData} />}

      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* 🚨 RESPONSIVE FIX: HEADER */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="w-full">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight break-words">{myShop.shop_name}</h1>
            <div className="flex flex-wrap gap-3 mt-3">
              <button onClick={() => setIsEditModalOpen(true)} className="flex-1 sm:flex-none text-center text-xs px-4 py-2.5 bg-gray-100 hover:bg-gray-200 font-bold rounded-xl transition">⚙️ Edit Details</button>
              <Link href={`/shops/${myShop.id}`} className="flex-1 sm:flex-none text-center text-xs px-4 py-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold rounded-xl transition">👀 Public Page</Link>
            </div>
          </div>
          
          <div className="w-full md:w-auto flex items-center justify-between gap-4 bg-gray-50 p-3 pl-5 rounded-2xl border border-gray-200">
            <div><p className="text-sm font-bold text-gray-900">Accepting Inquiries</p></div>
            <button onClick={handleToggleStatus} className={`relative h-8 w-14 rounded-full transition-colors shrink-0 ${isOpen ? 'bg-green-500' : 'bg-gray-300'}`}><span className={`inline-block h-6 w-6 rounded-full bg-white transition-transform ${isOpen ? 'translate-x-7' : 'translate-x-1'}`} /></button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            
            {/* NOTICE BOARD */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 mb-4">📣 Notice Board</h2>
              <textarea rows={2} maxLength={80} value={noticeText} onChange={(e) => setNoticeText(e.target.value)} placeholder="e.g., Printer down until 2PM!" className="w-full p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm font-bold text-yellow-900 outline-none focus:ring-2 focus:ring-yellow-400" />
              <div className="flex items-center justify-between pt-3">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isNoticeActive} onChange={(e) => setIsNoticeActive(e.target.checked)} className="rounded" /> Show on profile
                </label>
                <button onClick={handleUpdateNotice} disabled={isSubmitting} className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-lg shrink-0">Update</button>
              </div>
            </div>

            {/* ADD / EDIT CATALOG ITEM FORM */}
            <div className={`p-6 rounded-3xl shadow-sm border transition-colors ${editingItemId ? 'bg-blue-50 border-blue-200 ring-2 ring-blue-100' : 'bg-white border-gray-100'}`}>
              <h2 className="text-lg font-black text-gray-900 mb-4 flex items-center gap-2">
                {editingItemId ? '✏️ Edit Inventory Item' : '📦 Add Inventory'}
              </h2>
              
              <form onSubmit={handleSaveItem} className="space-y-4">
                <input type="text" required value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm font-bold outline-none focus:border-blue-600" placeholder="Item Name (e.g., Maggi)" />
                <input type="number" required min="0" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm font-bold outline-none focus:border-blue-600" placeholder="Price (₹)" />
                
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Category</p>
                  <div className="flex flex-wrap gap-2">
                    {['🍔 Food', '💻 Tech', '📝 Print', '🛠️ Service', '📦 Other'].map((cat) => (
                      <button key={cat} type="button" onClick={() => setFormData({...formData, category: cat})} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${formData.category === cat ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}>{cat}</button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <input type="checkbox" id="in_stock" checked={formData.in_stock} onChange={(e) => setFormData({...formData, in_stock: e.target.checked})} className="w-4 h-4 text-blue-600 rounded cursor-pointer shrink-0" />
                  <label htmlFor="in_stock" className="text-sm font-bold text-gray-700 cursor-pointer">Item is In Stock</label>
                </div>

                <div className="flex gap-2 mt-4">
                  {editingItemId && (
                    <button type="button" onClick={handleCancelEdit} className="flex-1 py-3 bg-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-300 transition">Cancel</button>
                  )}
                  <button type="submit" disabled={isSubmitting} className="flex-[2] py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition active:scale-95 shadow-sm">
                    {isSubmitting ? 'Saving...' : (editingItemId ? 'Save Changes' : '+ Add Item')}
                  </button>
                </div>
              </form>
            </div>

            {/* FLASH DEAL BROADCAST */}
            <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-6 rounded-3xl shadow-md text-white">
              <h2 className="text-lg font-black mb-2 flex items-center gap-2">⚡ Broadcast Flash Deal</h2>
              <p className="text-xs text-indigo-100 mb-4 font-medium">Send a push notification to the entire campus instantly.</p>
              
              {!showDealForm ? (
                <button onClick={() => setShowDealForm(true)} className="w-full py-3 bg-white text-purple-700 font-black rounded-xl hover:bg-gray-50 transition shadow-sm">
                  Create Deal
                </button>
              ) : (
                <form onSubmit={handleBroadcastDeal} className="space-y-3 animate-fade-in-up">
                  <input type="text" required value={dealData.item_name} onChange={e => setDealData({...dealData, item_name: e.target.value})} placeholder="Item Name" className="w-full p-2.5 bg-white/10 border border-white/20 rounded-xl text-sm text-white placeholder:text-indigo-200 outline-none focus:bg-white/20" />
                  <div className="flex gap-3">
                    <input type="number" required value={dealData.original_price} onChange={e => setDealData({...dealData, original_price: e.target.value})} placeholder="Old ₹" className="w-full p-2.5 bg-white/10 border border-white/20 rounded-xl text-sm text-white placeholder:text-indigo-200 outline-none focus:bg-white/20" />
                    <input type="number" required value={dealData.deal_price} onChange={e => setDealData({...dealData, deal_price: e.target.value})} placeholder="Deal ₹" className="w-full p-2.5 bg-white/10 border border-white/20 rounded-xl text-sm text-white placeholder:text-indigo-200 outline-none focus:bg-white/20" />
                  </div>
                  <select value={dealData.duration_hours} onChange={e => setDealData({...dealData, duration_hours: e.target.value})} className="w-full p-2.5 bg-white/10 border border-white/20 rounded-xl text-sm text-white outline-none focus:bg-white/20 [&>option]:text-gray-900">
                    <option value="1">Ends in 1 Hour</option>
                    <option value="2">Ends in 2 Hours</option>
                    <option value="5">Ends in 5 Hours</option>
                  </select>
                  <div className="flex gap-2 pt-2">
                    <button type="button" onClick={() => setShowDealForm(false)} className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition">Cancel</button>
                    <button type="submit" disabled={isSubmitting} className="flex-[2] py-2.5 bg-yellow-400 text-yellow-900 hover:bg-yellow-500 rounded-xl text-xs font-black uppercase tracking-wider transition">Send Push 🚀</button>
                  </div>
                </form>
              )}
            </div>

          </div>

          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 h-full">
              <div className="flex justify-between mb-6"><h2 className="text-xl font-black text-gray-900">Live Inventory</h2></div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {catalog.map((item) => (
                  <div key={item.id} className={`p-5 rounded-2xl border transition-all group ${editingItemId === item.id ? 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-200' : 'border-gray-100 hover:border-blue-200 shadow-sm hover:shadow-md'}`}>
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-gray-900 text-sm pr-2 truncate">{item.name || item.title}</h3>
                      <span className="font-black text-blue-600 text-sm">₹{item.price}</span>
                    </div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{item.category}</p>
                    
                    {/* 🚨 RESPONSIVE FIX: Action buttons now wrap nicely on small screens */}
                    <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <span className={`text-[10px] self-start font-black uppercase px-2.5 py-1 rounded-md ${item.in_stock ?? item.is_available ?? true ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                        {item.in_stock ?? item.is_available ?? true ? 'In Stock' : 'Out of Stock'}
                      </span>
                      
                      <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0 border-t border-gray-100 sm:border-0 pt-3 sm:pt-0">
                        <button onClick={() => handleEditClick(item)} className="flex-1 sm:flex-none justify-center px-4 py-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl font-bold text-xs transition">Edit</button>
                        <button onClick={() => handleDeleteItem(item.id)} className="flex-1 sm:flex-none justify-center px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-xl font-bold text-xs transition border border-red-100">Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}