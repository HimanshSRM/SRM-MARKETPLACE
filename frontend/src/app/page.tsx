'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { getLiveProducts, fetchLiveRequests, Product, initiateChat } from '@/lib/api';
import ReportModal from '@/components/ReportModal';
import GroupOrdersTab from '@/components/GroupOrdersTab';

type FeedTab = 'all' | 'product' | 'service' | 'request' | 'pools';

const CATEGORY_MAP = {
  product: [
    { id: 'books', label: 'Books & Notes' },
    { id: 'electronics', label: 'Electronics' },
    { id: 'clothing', label: 'Clothing & Accessories' },
    { id: 'furniture', label: 'Furniture & Dorm' },
    { id: 'other', label: 'Other Product' }
  ],
  service: [
    { id: 'tutoring', label: 'Tutoring & Academic Help' },
    { id: 'tech', label: 'Tech & Freelance' },
    { id: 'labor', label: 'Moving & Errands' },
    { id: 'beauty', label: 'Beauty & Haircut' },
    { id: 'other', label: 'Other Service' }
  ],
  request: [
    { id: 'item_needed', label: 'Looking for an Item' },
    { id: 'service_needed', label: 'Looking for a Service' },
    { id: 'roommate', label: 'Roommate / Housing' },
    { id: 'other', label: 'Other Request' }
  ]
};

function ExpandableDescription({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!text) return null;

  const isLong = text.length > 70; 

  return (
    <div className="mt-2 flex flex-col items-start flex-grow">
      <p className={`text-sm text-gray-500 leading-relaxed transition-all duration-300 ${isExpanded ? '' : 'line-clamp-2'}`}>
        {text}
      </p>
      
      {isLong && (
        <button 
          onClick={(e) => {
            e.preventDefault(); 
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }} 
          className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-800 mt-1.5 transition-colors"
        >
          {isExpanded ? 'Read Less' : 'Read More'}
        </button>
      )}
    </div>
  );
}

export default function HomePage() {
  const { profile, withRoleCheck, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  // 🌟 PAGINATION STATE (Already perfectly set up by you!)
  const [products, setProducts] = useState<Product[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // --- PERSISTENT STATE: TABS & CATEGORIES ---
  const [activeTab, setActiveTab] = useState<FeedTab>('all');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [isRestoringState, setIsRestoringState] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTab = localStorage.getItem('homeFeedTab');
      const savedCategory = localStorage.getItem('homeFeedCategory');
      if (savedTab) setActiveTab(savedTab as FeedTab);
      if (savedCategory) setActiveCategory(savedCategory);
    }
    setIsRestoringState(false);
  }, []);

  useEffect(() => {
    if (!isRestoringState) {
      localStorage.setItem('homeFeedTab', activeTab);
      localStorage.setItem('homeFeedCategory', activeCategory);
    }
  }, [activeTab, activeCategory, isRestoringState]);

  const [reportingListing, setReportingListing] = useState<{id: string, title: string} | null>(null);

  const fetchProducts = async (cursor = '', category = '', reset = false, tabToFetch = activeTab) => {
    try {
      let response;
      const catParam = category === 'all' ? '' : category;
      const safeCursor = cursor || undefined; // Safely pass undefined if empty

      if (tabToFetch === 'request') {
        response = await fetchLiveRequests(catParam, safeCursor as any);
      } else {
        response = await getLiveProducts(15, safeCursor, catParam);
      }
      
      // 🚨 UI SAFEGUARD: Added fallback empty arrays to prevent mapping crashes
      const newData = response?.data || [];
      
      if (reset) {
        setProducts(newData);
      } else {
        setProducts(prev => [...prev, ...newData]);
      }
      
      setNextCursor(response?.next_cursor || null);
    } catch (err: any) {
      console.error("Feed Error:", err);
      if (err.message && err.message.includes("Access denied")) {
        setError("locked");
      } else {
        setError("Could not load the feed. Please try again.");
      }
    }
  };

  useEffect(() => {
    if (isAuthLoading || isRestoringState) return;

    setIsLoading(true);
    setError(null);
    fetchProducts('', activeCategory, true, activeTab).finally(() => setIsLoading(false));
  }, [profile, isAuthLoading, isRestoringState, activeCategory, activeTab]); 

  const handleLoadMore = async () => {
    if (!nextCursor || isFetchingMore) return;
    setIsFetchingMore(true);
    await fetchProducts(nextCursor, activeCategory, false, activeTab);
    setIsFetchingMore(false);
  };

  const handleMessageSeller = async (e: React.MouseEvent, product: any) => {
    e.preventDefault();
    if (!profile || profile.role === 'guest') {
      withRoleCheck(() => {}); 
      return;
    }

    try {
      const ownerId = product.owner_id || product.seller_id || product.user_id || product.creator_id;
      if (!ownerId) {
        alert("Error: This product is missing an owner ID in the database.");
        return;
      }

      const isRequest = product.type === 'request';
      const initialMessage = isRequest 
        ? `Hi! I saw your request for "${product.title}". I might be able to help!` 
        : `Hi! I saw your listing for "${product.title}". Is this still available?`;

      const room = await initiateChat(product.id, ownerId, initialMessage);
      const roomId = room.id || room.room_id; 
      
      router.push(`/chat/${roomId}`); 

    } catch (err) {
      console.error("Chat initiation failed:", err);
      alert("Could not start chat. You might be the seller, or the item is unavailable.");
    }
  };

  const handleTabChange = (tab: FeedTab) => {
    setActiveTab(tab);
    setActiveCategory('all'); 
  };

  const displayedProducts = products.filter((p: any) => {
    const pType = p.type || 'product'; 
    const typeMatch = activeTab === 'all' || pType === activeTab;
    return typeMatch;
  });

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto min-h-screen relative">
      
      <div className="mb-8 pb-4 border-b">
        <h1 className="text-3xl font-bold text-gray-900">Campus Live Feed</h1>
        <p className="text-sm text-gray-500 mt-1">Discover what's happening on campus today.</p>
      </div>

      {error !== "locked" && (
        <>
          <div className="flex flex-wrap gap-2 mb-4 bg-gray-100/50 p-1.5 rounded-xl w-full sm:w-fit">
            <button onClick={() => handleTabChange('all')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}>All Feed</button>
            <button onClick={() => handleTabChange('product')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'product' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}>Products</button>
            <button onClick={() => handleTabChange('service')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'service' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}>Services</button>
            <button onClick={() => handleTabChange('request')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'request' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}>Requests</button>
            <button onClick={() => handleTabChange('pools')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'pools' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}> Cart Pools</button>
          </div>

          {activeTab !== 'all' && activeTab !== 'pools' && CATEGORY_MAP[activeTab as keyof typeof CATEGORY_MAP] && (
            <div className="flex flex-wrap gap-2 mb-8">
              <button
                onClick={() => setActiveCategory('all')}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
                  activeCategory === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                All {activeTab}s
              </button>
              {CATEGORY_MAP[activeTab as keyof typeof CATEGORY_MAP].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
                    activeCategory === cat.id ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="relative">
        {!profile && !isAuthLoading && !isLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pt-16 sm:pt-32 px-4 backdrop-blur-[12px] bg-white/40">
            <div className="relative z-10 text-center max-w-2xl mx-auto p-6 sm:p-8 bg-white/90 backdrop-blur-md rounded-3xl shadow-2xl border border-white/50">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white mb-6 shadow-lg transform -rotate-3 font-black text-4xl">S</div>
              <h2 className="text-3xl sm:text-5xl font-black text-gray-900 tracking-tight mb-4 leading-tight">
                Your Campus. <br className="hidden sm:block" /> 
                <span className="text-blue-600">Your Marketplace.</span>
              </h2>
              <p className="text-base sm:text-lg text-gray-600 font-medium mb-8 max-w-md mx-auto leading-relaxed">
                Buy, sell, and split deliveries instantly. Verified students only. No outsiders, no scams.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full px-4 sm:px-0">
                <button 
                  onClick={() => router.push('/login')} 
                  className="w-full sm:w-auto px-12 py-4 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-lg hover:bg-blue-700 hover:shadow-xl transition-all active:scale-95"
                >
                  Log In
                </button>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-gray-50 to-transparent"></div>
          </div>
        )}

        <div className={!profile && !isAuthLoading && !isLoading ? "select-none pointer-events-none opacity-60 overflow-hidden max-h-[80vh]" : ""}>
          {isAuthLoading || isLoading || isRestoringState ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((skeleton) => (
                <div key={skeleton} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-pulse">
                  <div className="h-48 bg-gray-200 w-full"></div>
                  <div className="p-5 space-y-3"><div className="h-5 bg-gray-200 rounded w-3/4"></div><div className="h-4 bg-gray-200 rounded w-1/2"></div></div>
                </div>
              ))}
            </div>
          ) : error === "locked" ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-gray-200 shadow-sm max-w-2xl mx-auto">
              <h3 className="text-xl font-bold text-gray-900">Marketplace is Locked</h3>
              <p className="text-gray-500 mt-2">You must verify your campus identity to view the live feed.</p>
            </div>
          ) : activeTab === 'pools' ? (
            <GroupOrdersTab currentUser={profile} />
          ) : displayedProducts.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300">
              <h3 className="text-lg font-medium text-gray-900">No items found</h3>
              {profile && <button onClick={() => router.push('/create-product')} className="mt-4 text-blue-600 font-medium hover:underline">Create a listing →</button>}
            </div>
          ) : (
            <>
              {/* THE GRID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayedProducts.map((product: any) => {
                  const isRequest = product.type === 'request';
                  const isService = product.type === 'service';
                  const isProduct = !isRequest && !isService;
                  
                  return (
                    <div key={product.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col group">
                      
                      {/* 🚨 THE SLEEK IMAGE PLACEHOLDER ARCHITECTURE */}
                      <div className={`h-48 w-full relative flex items-center justify-center transition-colors ${
                        isRequest ? 'bg-orange-50/40 group-hover:bg-orange-50/80' : 
                        isService ? 'bg-indigo-50/40 group-hover:bg-indigo-50/80' : 
                        'bg-slate-50 group-hover:bg-slate-100/60'
                      }`}>
                        {product.image_url ? (
                          <img src={product.image_url} alt={product.title} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-center opacity-70 transition-transform group-hover:scale-105 duration-500">
                            {isRequest && (
                              <>
                                <svg className="w-10 h-10 text-orange-400 mb-2.5 drop-shadow-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                <span className="text-[9px] font-black text-orange-500 uppercase tracking-[0.25em]">In Search Of</span>
                              </>
                            )}
                            {isService && (
                              <>
                                <svg className="w-10 h-10 text-indigo-400 mb-2.5 drop-shadow-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                <span className="text-[9px] font-black text-indigo-500 uppercase tracking-[0.25em]">Service Offered</span>
                              </>
                            )}
                            {isProduct && (
                              <>
                                <svg className="w-10 h-10 text-slate-400 mb-2.5 drop-shadow-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.25em]">Item For Sale</span>
                              </>
                            )}
                          </div>
                        )}

                        {/* TINTED PRICE BADGE */}
                        <div className={`absolute top-3 right-3 backdrop-blur-md px-3 py-1 rounded-full text-sm font-bold shadow-sm border ${
                          isRequest ? 'bg-orange-100/90 text-orange-800 border-orange-200' : 
                          isService ? 'bg-indigo-100/90 text-indigo-800 border-indigo-200' : 
                          'bg-white/90 text-gray-900 border-gray-100'
                        }`}>
                          {isRequest ? `Budget: ₹${product.price}` : `₹${product.price}`}
                        </div>
                      </div>

                      <div className="p-5 flex flex-col flex-grow">
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="text-lg font-bold text-gray-900 line-clamp-1">{product.title}</h3>
                          {/* TINTED CATEGORY PILL */}
                          <span className={`text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-wider shrink-0 border ${
                            isRequest ? 'bg-orange-50 text-orange-600 border-orange-100' : 
                            isService ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 
                            'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>
                            {product.category || 'misc'}
                          </span>
                        </div>
                        
                        <ExpandableDescription text={product.description} />

                        <div className="mt-6 pt-4 border-t border-gray-50 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-medium text-gray-400 block">{product.seller_name || 'Campus Member'}</span>
                            {profile && profile.uid !== (product.owner_id || product.seller_id) && (
                              <button 
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setReportingListing({ id: product.id.toString(), title: product.title });
                                }}
                                className="text-[10px] text-red-400 hover:text-red-600 font-bold mt-1 uppercase tracking-wider transition-colors"
                              >
                                🚩 Report
                              </button>
                            )}
                          </div>
                          <button onClick={(e) => handleMessageSeller(e, product)} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold hover:bg-blue-100 transition-colors">
                            {isRequest ? 'Contact' : 'Message'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 🚨 THE PERFECT PAGINATION BUTTON */}
              {profile && nextCursor && (
                <div className="flex justify-center pt-8 pb-4">
                  <button
                    onClick={handleLoadMore}
                    disabled={isFetchingMore}
                    className="px-8 py-3 bg-white border-2 border-gray-200 text-gray-900 font-bold rounded-2xl hover:border-blue-600 hover:text-blue-600 transition-all shadow-sm disabled:opacity-50"
                  >
                    {isFetchingMore ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        Loading...
                      </span>
                    ) : (
                      "View More Items"
                    )}
                  </button>
                </div>
              )}

              {profile && !nextCursor && products.length > 0 && (
                <p className="text-center text-gray-400 text-sm font-medium mt-8">
                  🎉 You've seen everything! No more items to show.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {reportingListing && (
        <ReportModal
          listingId={reportingListing.id}
          listingTitle={reportingListing.title}
          onClose={() => setReportingListing(null)}
        />
      )}
    </div>
  );
}