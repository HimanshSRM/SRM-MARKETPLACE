'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getLiveShops, getShopCatalog, Shop, CatalogItem, initiateChat } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import ReportModal from '@/components/ReportModal'; 

export default function ShopCatalogPage() {
  const params = useParams();
  const router = useRouter();
  const shopId = params.shopId as string;
  
  // 🚨 1. Grabbed the auth loading state
  const { profile, isLoading: isAuthLoading } = useAuth();

  const [shop, setShop] = useState<Shop | null>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reportingItem, setReportingItem] = useState<{id: string, title: string, shopId: string} | null>(null);

  useEffect(() => {
    // 🚨 2. WAIT FOR FIREBASE FIRST before attempting to fetch anything
    if (isAuthLoading) return;

    const fetchShopData = async () => {
      try {
        setIsLoading(true);
        const token = await auth.currentUser?.getIdToken();
        
        // 🚨 3. Now it's safe to check if they are logged out
        if (!token || !profile) {
          setError("You must be logged in to view shop catalogs.");
          setIsLoading(false);
          return;
        }
        
        const allShops = await getLiveShops(token);
        const currentShop = allShops.find(s => s.id === shopId);
        
        if (!currentShop) {
          setError("Shop not found or is not verified yet.");
          setIsLoading(false);
          return;
        }
        setShop(currentShop);

        const catalogData = await getShopCatalog(token, shopId);
        setCatalog(catalogData);

      } catch (err) {
        console.error("Failed to load catalog:", err);
        setError("Could not load the shop's catalog.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchShopData();
  }, [shopId, profile, isAuthLoading]); // 🚨 Added isAuthLoading to dependencies

  const handleMessageShop = async (item: any) => {
    if (!profile || profile.role === 'guest') {
      alert("Please verify your student ID to message shops.");
      return;
    }

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token || !shop?.owner_id) return;

      const itemName = item.name || item.title;
      const displayName = shop.shop_name || shop.name || "Shop";
      const initialMessage = `Hi ${displayName}! I'm interested in "${itemName}". Is this currently available?`;
      
      const room = await initiateChat(token, item.id, shop.owner_id, initialMessage);
      const roomId = room.id || room.room_id; 
      
      router.push(`/chat/${roomId}`); 
    } catch (err) {
      console.error("Chat initiation failed:", err);
      alert("Could not start chat. You might be the shop owner.");
    }
  };

  // 🚨 4. COMBINED LOADING CHECK: Spin while either Firebase OR the backend is working
  if (isAuthLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-gray-500">Loading Catalog...</p>
      </div>
    );
  }

  // Safe fallback if there's an error or the shop doesn't exist
  if (error || !shop) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mt-10">{error}</h2>
        <button onClick={() => router.push('/shops')} className="mt-4 text-blue-600 font-bold">← Back to Directory</button>
      </div>
    );
  }

  const displayShopName = shop.shop_name || shop.name || 'Shop';

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Shop Header Banner */}
        <div className="bg-white rounded-3xl p-8 mb-8 shadow-sm border border-gray-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center font-black text-4xl uppercase tracking-tighter shadow-inner">
              {displayShopName.substring(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">{displayShopName}</h1>
                {shop.is_verified && (
                  <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-wider rounded-lg border border-blue-100">Verified</span>
                )}
              </div>
              <p className="text-gray-500 mt-2 max-w-xl">{shop.description}</p>
              
              <div className="flex items-center gap-4 mt-3 text-sm font-medium text-gray-400">
                {shop.location && <span>📍 {shop.location}</span>}
                {(shop.contact_number || shop.contact_info) && <span>📞 {shop.contact_number || shop.contact_info}</span>}
              </div>
            </div>
          </div>
          
          <button onClick={() => router.push('/shops')} className="px-5 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition">
            Directory
          </button>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-6">Available Catalog</h2>

        {/* Catalog Grid */}
        {catalog.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
            <h3 className="text-xl font-bold text-gray-900">Nothing here yet!</h3>
            <p className="text-gray-500 mt-2">This shop hasn't added any items to their catalog.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {catalog.map((item) => {
              const itemName = item.name || item.title;
              const isAvailable = item.is_available ?? item.in_stock;

              return (
                <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                  
                  {/* Image Placeholder */}
                  <div className="h-48 bg-gray-100 w-full relative group">
                    {item.image_url ? (
                      <img src={item.image_url} alt={itemName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 bg-gray-50">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      </div>
                    )}
                    <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-sm font-black text-gray-900 shadow-sm">
                      ₹{item.price}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="p-5 flex flex-col flex-grow">
                    <h3 className="text-lg font-bold text-gray-900 line-clamp-1">{itemName}</h3>
                    <p className="text-sm text-gray-500 mt-2 line-clamp-2 flex-grow">{item.description}</p>
                    
                    {/* 🚨 THE REPORT BUTTON FOR SHOPS */}
                    {profile?.uid !== shop.owner_id && (
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setReportingItem({ id: item.id, title: itemName, shopId: shop.id });
                        }}
                        className="text-[10px] text-red-500 hover:text-red-700 font-bold mt-2 uppercase tracking-wider transition-colors self-start"
                      >
                        🚩 Report Item
                      </button>
                    )}
                    
                    <div className="mt-6 pt-4 border-t border-gray-50 flex items-center justify-between">
                      <span className={`text-xs font-bold uppercase tracking-wider ${isAvailable ? 'text-green-500' : 'text-red-500'}`}>
                        {isAvailable ? 'In Stock' : 'Out of Stock'}
                      </span>
                      <button 
                        onClick={() => handleMessageShop(item)} 
                        disabled={!isAvailable}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:bg-gray-400"
                      >
                        Buy / Message
                      </button>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}

        {/* 🚨 MOUNT THE MODAL HERE */}
        {reportingItem && (
          <ReportModal
            listingId={reportingItem.id}
            listingTitle={reportingItem.title}
            shopId={reportingItem.shopId}
            onClose={() => setReportingItem(null)}
          />
        )}

      </div>
    </div>
  );
}