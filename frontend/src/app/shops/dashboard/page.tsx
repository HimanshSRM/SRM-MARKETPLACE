'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { 
  getLiveShops, 
  getShopCatalog, 
  addCatalogItem, 
  updateCatalogItem, 
  deleteCatalogItem, 
  updateShopProfile, // 🚨 Make sure this is in your api.ts!
  Shop 
} from '@/lib/api';
import Link from 'next/link';

// ==========================================
// 🚨 NEW: THE EDIT SHOP MODAL COMPONENT
// ==========================================
function EditShopModal({ currentShop, onClose, onRefresh }: { currentShop: any, onClose: () => void, onRefresh: () => void }) {
  const [formData, setFormData] = useState({
    shop_name: currentShop?.shop_name || currentShop?.name || '',
    description: currentShop?.description || '',
    phone_number: currentShop?.phone_number || '',
    location: currentShop?.location || '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      await updateShopProfile(token, currentShop.id, formData);
      
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl animate-fade-in-up">
        <h2 className="text-2xl font-black text-gray-900 mb-6">Edit Shop Profile</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Shop Name</label>
            <input 
              type="text" required
              value={formData.shop_name} 
              onChange={(e) => setFormData({...formData, shop_name: e.target.value})}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Phone Number</label>
            <input 
              type="tel" required
              value={formData.phone_number} 
              onChange={(e) => setFormData({...formData, phone_number: e.target.value})}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Location / Drop-off Point</label>
            <input 
              type="text" 
              value={formData.location} 
              onChange={(e) => setFormData({...formData, location: e.target.value})}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
              placeholder="e.g., Tech Park Gate, Abacus..."
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Description</label>
            <textarea 
              rows={3} required
              value={formData.description} 
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-bold"
            />
          </div>

          <div className="flex gap-3 pt-4 mt-2 border-t">
            <button type="button" onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition">
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition disabled:opacity-50">
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
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
  const { profile } = useAuth();

  const [myShop, setMyShop] = useState<Shop | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false); // 🚨 NEW STATE FOR MODAL

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    is_available: true,
  });

  // 🚨 Extracted fetch logic so we can call it after saving profile edits
  const loadDashboardData = async () => {
    if (!profile) return;
    try {
      setIsLoading(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Authentication error");
      
      const allShops = await getLiveShops(token);
      const userShop = allShops.find(s => s.owner_id === profile.uid);
      
      if (userShop) {
        setMyShop(userShop);
        const shopCatalog = await getShopCatalog(token, userShop.id);
        setCatalog(shopCatalog);
      }
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [profile]);

  const handleEditClick = (item: any) => {
    setEditingItemId(item.id);
    setFormData({
      name: item.name || item.title || '',
      description: item.description || '',
      price: item.price !== undefined && item.price !== null ? item.price.toString() : '',
      is_available: item.is_available ?? item.in_stock ?? true,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setFormData({ name: '', description: '', price: '', is_available: true });
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myShop) return;

    try {
      setIsSubmitting(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Authentication error");

      const payload = {
        name: formData.name, 
        description: formData.description,
        price: parseFloat(formData.price),
        image_url: null, 
        is_available: formData.is_available,
      };

      if (editingItemId) {
        // Optimistic Update for Edit
        await updateCatalogItem(token, editingItemId, payload);
        setCatalog(catalog.map(item => 
          item.id === editingItemId ? { ...item, ...payload } : item
        ));
      } else {
        // 🚨 FIX: Safely construct the new item for the UI using the returned item_id
        const response : any = await addCatalogItem(token, payload);
        const newItem = {
          id: response.item_id || response.id || Date.now().toString(), // Fallback ID just in case
          ...payload
        };
        setCatalog([newItem, ...catalog]);
      }
      handleCancelEdit();
    } catch (error) {
      console.error("Error saving item:", error);
      alert("Failed to save item.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm("Are you sure you want to delete this item? This action cannot be undone.")) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Authentication error");

      await deleteCatalogItem(token, itemId);
      setCatalog(catalog.filter(item => item.id !== itemId));
      
      if (editingItemId === itemId) {
        handleCancelEdit();
      }
    } catch (error) {
      console.error("Error deleting item:", error);
      alert("Failed to delete item. Please check your connection.");
    }
  };

  if (isLoading || profile === undefined) return <div className="min-h-screen flex items-center justify-center bg-gray-50 font-bold text-gray-500">Loading Dashboard...</div>;
  if (!profile) return null;

  if (!myShop) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 max-w-md text-center">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🏪</div>
          <h2 className="text-2xl font-bold text-gray-900">No Shop Found</h2>
          <p className="text-gray-500 mt-2 mb-6">You need to register a business before you can access the dashboard.</p>
          <button onClick={() => router.push('/shops/register')} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition">
            Register a Shop Now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 relative">
      
      {/* 🚨 RENDER THE MODAL IF OPEN */}
      {isEditModalOpen && (
        <EditShopModal 
          currentShop={myShop} 
          onClose={() => setIsEditModalOpen(false)} 
          onRefresh={loadDashboardData} 
        />
      )}

      <div className="max-w-6xl mx-auto space-y-8">
        
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-gray-900">Shop Dashboard</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <p className="text-sm text-gray-500 font-medium">Managing <span className="text-blue-600 font-bold">{myShop.shop_name || myShop.name}</span></p>
              
              {/* 🚨 NEW: EDIT PROFILE BUTTON */}
              <button 
                onClick={() => setIsEditModalOpen(true)}
                className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition-colors border border-gray-200 shadow-sm"
              >
                ⚙️ Edit Shop Info
              </button>
            </div>
          </div>
          <Link href={`/shops/${myShop.id}`} className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-sm font-bold rounded-xl transition whitespace-nowrap">
            View Public Storefront →
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-1">
            <div className={`p-6 rounded-2xl shadow-sm border transition-colors sticky top-24 ${editingItemId ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-100'}`}>
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                {editingItemId ? '✏️ Edit Catalog Item' : '+ Add New Item'}
              </h2>
              
              <form onSubmit={handleSaveItem} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Item Name</label>
                  <input
                    type="text" required
                    value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g., iPhone Screen Repair"
                    className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Price (₹)</label>
                  <input
                    type="number" required min="0"
                    value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})}
                    placeholder="e.g., 1500"
                    className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Description</label>
                  <textarea
                    required rows={3}
                    value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})}
                    placeholder="Describe the product or service..."
                    className="w-full p-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input 
                    type="checkbox" id="is_available" 
                    checked={formData.is_available} onChange={(e) => setFormData({...formData, is_available: e.target.checked})}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="is_available" className="text-sm font-bold text-gray-700 cursor-pointer">Item is currently available</label>
                </div>

                <div className="flex gap-3 mt-4">
                  {editingItemId && (
                    <button 
                      type="button" onClick={handleCancelEdit} disabled={isSubmitting}
                      className="flex-1 py-3 bg-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-300 transition disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                  <button 
                    type="submit" disabled={isSubmitting}
                    className={`flex-1 py-3 text-white font-bold rounded-xl transition disabled:opacity-50 ${editingItemId ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {isSubmitting ? 'Saving...' : (editingItemId ? 'Save Changes' : 'Add Item')}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Current Inventory ({catalog.length})</h2>
            
            {catalog.length === 0 ? (
              <div className="p-12 text-center bg-white border border-dashed border-gray-300 rounded-2xl">
                <p className="text-gray-500 font-medium">Your catalog is empty. Add your first item using the form!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {catalog.map((item,index) => (
                  <div key={item.id || index} className={`bg-white p-4 rounded-2xl shadow-sm flex flex-col justify-between transition-all border ${editingItemId === item.id ? 'border-yellow-400 ring-2 ring-yellow-100' : 'border-gray-100'}`}>
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-gray-900 line-clamp-1">{item.name || item.title}</h3>
                        <span className="font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-sm">₹{item.price}</span>
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2">{item.description}</p>
                    </div>
                    
                    <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between">
                      <span className={`text-[10px] font-black uppercase tracking-wider ${item.is_available ?? item.in_stock ? 'text-green-500' : 'text-red-500'}`}>
                        {item.is_available ?? item.in_stock ? '● In Stock' : '○ Out of Stock'}
                      </span>
                      
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleEditClick(item)}
                          className="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteItem(item.id)}
                          title="Delete Item"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>

                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}