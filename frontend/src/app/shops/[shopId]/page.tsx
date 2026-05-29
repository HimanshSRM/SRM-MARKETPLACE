'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getLiveShops, initiateChat } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import ReportModal from '@/components/ReportModal'; 

export default function ShopCatalogPage() {
  const params = useParams();
  const router = useRouter();
  const shopId = params.shopId as string;
  
  const { profile, isLoading: isAuthLoading } = useAuth();

  const [shop, setShop] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportingItem, setReportingItem] = useState<{id: string, title: string, shopId: string} | null>(null);

  // 🚨 NEW: State for the general Inquire button
  const [isStartingChat, setIsStartingChat] = useState(false);

  useEffect(() => {
    if (isAuthLoading) return;

    const fetchShopData = async () => {
      try {
        setIsLoading(true);
        if (!profile) {
          setError("You must be logged in to view shop catalogs.");
          return;
        }
        
        const allShops = await getLiveShops();
        const currentShop = allShops.find((s: any) => s.id === shopId);
        
        if (!currentShop) {
          setError("Shop not found or is not verified yet.");
          return;
        }
        
        setShop(currentShop);
      } catch (err) {
        console.error("Failed to load shop:", err);
        setError("Could not load the shop profile.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchShopData();
  }, [shopId, profile, isAuthLoading]);

  // Handler for item-specific chats
  const handleMessageShop = async (item: any) => {
    if (!profile || profile.role === 'guest') {
      alert("Please verify your student ID to message shops.");
      return;
    }

    try {
      if (!shop?.owner_id) return;
      const itemName = item.name || item.title;
      const displayName = shop.shop_name || shop.name || "Shop";
      const initialMessage = `Hi ${displayName}! I'm interested in "${itemName}". Is this currently available?`;
      
      const room = await initiateChat(item.id, shop.owner_id, initialMessage);
      const roomId = room.id || room.room_id; 
      router.push(`/chat/${roomId}`); 
    } catch (err) {
      console.error("Chat initiation failed:", err);
      alert("Could not start chat. You might be the shop owner.");
    }
  };

  // 🚨 NEW: Handler for general shop inquiries
  const handleGeneralInquire = async () => {
    if (!profile || profile.role === 'guest') {
      alert("Please verify your student ID to message shops.");
      return;
    }

    setIsStartingChat(true);
    try {
      if (!shop?.owner_id) return;
      const displayName = shop.shop_name || shop.name || "Shop";
      const initialMessage = `Hi ${displayName}! I have a general inquiry about your shop.`;
      
      // Pass shop.id as the "item ID" so the chat is linked to the shop itself
      const room = await initiateChat(shop.id, shop.owner_id, initialMessage);
      const roomId = room.id || room.room_id; 
      router.push(`/chat/${roomId}`); 
    } catch (err) {
      console.error("Chat initiation failed:", err);
      alert("Could not start chat. You might be the shop owner.");
      setIsStartingChat(false);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 sm:p-8 animate-pulse">
        <div className="max-w-6xl mx-auto">
          <div className="h-32 bg-gray-200 rounded-3xl mb-8 w-full"></div>
          <div className="h-8 bg-gray-200 w-48 rounded-lg mb-6"></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 h-72 flex flex-col">
                <div className="h-48 bg-gray-200 w-full rounded-t-2xl"></div>
                <div className="p-5 flex-1 space-y-3">
                  <div className="h-5 bg-gray-200 w-3/4 rounded"></div>
                  <div className="h-4 bg-gray-200 w-full rounded"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !shop) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 text-center flex flex-col items-center justify-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{error}</h2>
        <button onClick={() => router.push('/shops')} className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition">← Back to Directory</button>
      </div>
    );
  }

  const displayShopName = shop.shop_name || shop.name || 'Shop';
  const catalog = shop.catalog || []; 
  const isShopOpen = shop.is_open === true;

  // Format WhatsApp Link safely
  const waNumber = shop.contact_number ? shop.contact_number.replace(/\D/g, '') : '';
  const finalWaNumber = waNumber.startsWith('91') ? waNumber : `91${waNumber}`;
  const waLink = `https://wa.me/${finalWaNumber}?text=Hi%20${encodeURIComponent(displayShopName)},%20I%20am%20from%20SRM.%20Are%20you%20available?`;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        
        {shop.live_notice?.is_active && shop.live_notice?.text && (
          <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-2xl shadow-sm flex items-start gap-3 animate-fade-in-up">
            <span className="text-xl">📣</span>
            <div>
              <h3 className="text-sm font-black text-yellow-800 uppercase tracking-wider">Live Shop Update</h3>
              <p className="text-yellow-900 font-medium">{shop.live_notice.text}</p>
            </div>
          </div>
        )}

        {/* Shop Header Banner */}
        <div className="bg-white rounded-3xl p-8 mb-8 shadow-sm border border-gray-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-6 w-full md:w-auto">
            <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center font-black text-4xl uppercase tracking-tighter shadow-inner shrink-0">
              {displayShopName.substring(0, 2)}
            </div>
            <div className="w-full">
              <div className="flex items-center flex-wrap gap-3 mb-1">
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">{displayShopName}</h1>
                <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg flex items-center gap-1.5 border ${isShopOpen ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isShopOpen ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                  {isShopOpen ? 'Open Now' : 'Currently Closed'}
                </span>
              </div>
              <p className="text-gray-500 mt-2 max-w-xl">{shop.tagline || shop.description || "Campus Vendor"}</p>
              
              <div className="flex items-center gap-4 mt-3 text-sm font-medium text-gray-400">
                {shop.block && <span>📍 {shop.block}</span>}
              </div>

              {/* 🚨 ADDED PHONE, WHATSAPP, & INQUIRE LINKS */}
              {shop.contact_number && (
                <div className="flex flex-wrap gap-3 mt-4">
                  <a 
                    href={waLink} 
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs font-bold text-white bg-[#25D366] hover:bg-[#1ebd5a] px-4 py-2 rounded-xl transition shadow-sm active:scale-95"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                  </a>
                  <a 
                    href={`tel:${shop.contact_number}`} 
                    className="flex items-center gap-2 text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-xl transition shadow-sm active:scale-95"
                  >
                    📞 Call Shop
                  </a>
                  
                  {/* 🚨 NEW: IN-APP INQUIRE BUTTON */}
                  <button 
                    onClick={handleGeneralInquire}
                    disabled={isStartingChat || profile?.uid === shop.owner_id}
                    className="flex items-center gap-1.5 px-4 py-2 bg-purple-100 text-purple-700 font-bold text-xs rounded-xl hover:bg-purple-200 transition shadow-sm active:scale-95 disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    {isStartingChat ? 'Opening...' : 'Inquire'}
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <button onClick={() => router.push('/shops')} className="px-5 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition shrink-0 hidden md:block">
            Directory
          </button>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-6">Available Services</h2>

        {catalog.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
            <h3 className="text-xl font-bold text-gray-900">Nothing here yet!</h3>
            <p className="text-gray-500 mt-2">This shop hasn't added any items to their catalog.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {catalog.map((item: any) => {
              const itemName = item.name || item.title;
              const isAvailable = item.in_stock ?? item.is_available ?? true;

              return (
                <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow group">
                  <div className="h-48 bg-gray-50 border-b border-gray-100 w-full relative flex items-center justify-center overflow-hidden">
                    {item.image_url ? (
                      <img src={item.image_url} alt={itemName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="text-gray-300 transform group-hover:scale-110 transition-transform duration-500">
                        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                      </div>
                    )}
                    <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm px-3 py-1 rounded-full text-sm font-black text-gray-900 shadow-sm border border-gray-100">
                      ₹{item.price}
                    </div>
                  </div>

                  <div className="p-5 flex flex-col flex-grow">
                    <h3 className="text-lg font-bold text-gray-900 line-clamp-1">{itemName}</h3>
                    {item.category && <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mt-1">{item.category}</p>}
                    
                    {profile?.uid !== shop.owner_id && (
                      <button 
                        onClick={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          setReportingItem({ id: item.id, title: itemName, shopId: shop.id });
                        }}
                        className="text-[10px] text-red-400 hover:text-red-600 font-bold mt-3 uppercase tracking-wider transition-colors self-start"
                      >
                        🚩 Report Issue
                      </button>
                    )}
                    
                    <div className="mt-auto pt-5 flex items-center justify-between">
                      <span className={`text-xs font-black uppercase tracking-wider ${isAvailable ? 'text-green-500' : 'text-red-500'}`}>
                        {isAvailable ? 'In Stock' : 'Out of Stock'}
                      </span>
                      
                      <button 
                        onClick={() => handleMessageShop(item)} 
                        disabled={!isAvailable || !isShopOpen}
                        className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                          !isAvailable || !isShopOpen 
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm hover:shadow-md active:scale-95'
                        }`}
                      >
                        {!isShopOpen ? 'Shop Closed' : 'Inquire'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

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