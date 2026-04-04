'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { getLiveProducts, Product, initiateChat } from '@/lib/api';
import { auth } from '@/lib/firebase';
import ReportModal from '@/components/ReportModal';

type FeedTab = 'all' | 'product' | 'service' | 'request';

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

export default function HomePage() {
  // 🚨 1. Grabbed the auth loading state
  const { profile, withRoleCheck, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  // 🌟 PAGINATION STATE
  const [products, setProducts] = useState<Product[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Tab & Filter State
  const [activeTab, setActiveTab] = useState<FeedTab>('all');
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // Reporting State
  const [reportingListing, setReportingListing] = useState<{id: string, title: string} | null>(null);

  // 🌟 FETCH LOGIC
  const fetchProducts = async (cursor = '', category = '', reset = false) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const response = await getLiveProducts(token, 15, cursor, category === 'all' ? '' : category);
      
      if (reset) {
        setProducts(response.data);
      } else {
        setProducts(prev => [...prev, ...response.data]);
      }
      
      setNextCursor(response.next_cursor);
    } catch (err: any) {
      console.error("Feed Error:", err);
      if (err.message && err.message.includes("Access denied")) {
        setError("locked");
      } else {
        setError("Could not load the feed. Please try again.");
      }
    }
  };

  // 🚨 2. COMBINED & SMART USE EFFECT
  // This single effect now safely handles the initial load AND any tab/category changes!
  useEffect(() => {
    // Wait for AuthContext to figure out who the user is
    if (isAuthLoading) return;

    // If no profile, clear the feed and stop the spinner
    if (!profile) {
      setProducts([]);
      setNextCursor(null);
      setIsLoading(false);
      return;
    }

    // If they are logged in, fetch the products based on the current tabs!
    setIsLoading(true);
    setError(null);
    fetchProducts('', activeCategory, true).finally(() => setIsLoading(false));

  }, [profile, isAuthLoading, activeCategory, activeTab]); 

  // 3. The "Load More" Handler
  const handleLoadMore = async () => {
    if (!nextCursor || isFetchingMore) return;
    setIsFetchingMore(true);
    await fetchProducts(nextCursor, activeCategory, false);
    setIsFetchingMore(false);
  };

  const handleMessageSeller = async (e: React.MouseEvent, product: any) => {
    e.preventDefault();
    if (!profile || profile.role === 'guest') {
      withRoleCheck(() => {}); 
      return;
    }

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Please log in again.");

      const ownerId = product.owner_id || product.seller_id || product.user_id || product.creator_id;

      if (!ownerId) {
        alert("Error: This product is missing an owner ID in the database.");
        return;
      }

      const initialMessage = `Hi! I saw your listing for "${product.title}". Is this still available?`;
      const room = await initiateChat(token, product.id, ownerId, initialMessage);
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

      {profile && error !== "locked" && (
        <>
          {/* TABS */}
          <div className="flex flex-wrap gap-2 mb-4 bg-gray-100/50 p-1.5 rounded-xl w-full sm:w-fit">
            <button onClick={() => handleTabChange('all')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}>All Feed</button>
            <button onClick={() => handleTabChange('product')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'product' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}>Products</button>
            <button onClick={() => handleTabChange('service')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'service' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}>Services</button>
            <button onClick={() => handleTabChange('request')} className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'request' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200/50'}`}>Requests</button>
          </div>

          {/* CATEGORIES */}
          {activeTab !== 'all' && CATEGORY_MAP[activeTab] && (
            <div className="flex flex-wrap gap-2 mb-8">
              <button
                onClick={() => setActiveCategory('all')}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
                  activeCategory === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                All {activeTab}s
              </button>
              {CATEGORY_MAP[activeTab].map((cat) => (
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

      {/* 🚨 3. RENDER LOGIC: Shows skeleton loaders while Firebase OR Backend is loading! */}
      {isAuthLoading || isLoading ? (
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
      ) : !profile ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300">
          <h3 className="text-lg font-medium text-gray-900">Please log in to view the campus feed</h3>
        </div>
      ) : displayedProducts.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300">
          <h3 className="text-lg font-medium text-gray-900">No items found</h3>
          <button onClick={() => router.push('/create-product')} className="mt-4 text-blue-600 font-medium hover:underline">Create a listing →</button>
        </div>
      ) : (
        <>
          {/* THE GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayedProducts.map((product: any) => (
              <div key={product.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                <div className="h-48 bg-gray-100 w-full relative group">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <svg className="w-12 h-12 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    </div>
                  )}
                  <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-sm font-bold text-gray-900 shadow-sm">
                    ₹{product.price}
                  </div>
                </div>
                <div className="p-5 flex flex-col flex-grow">
                  <div className="flex justify-between items-start gap-2">
                    <h3 className="text-lg font-bold text-gray-900 line-clamp-1">{product.title}</h3>
                    <span className="text-[10px] font-bold px-2 py-1 bg-gray-100 text-gray-500 rounded-md uppercase tracking-wide">
                      {product.category || 'misc'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2 flex-grow">{product.description}</p>
                  <div className="mt-6 pt-4 border-t border-gray-50 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-gray-400 block">{product.seller_name || 'Campus Member'}</span>
                      {profile.uid !== (product.owner_id || product.seller_id) && (
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setReportingListing({ id: product.id.toString(), title: product.title });
                          }}
                          className="text-[10px] text-red-500 hover:text-red-700 font-bold mt-1 uppercase tracking-wider transition-colors"
                        >
                          🚩 Report
                        </button>
                      )}
                    </div>
                    <button onClick={(e) => handleMessageSeller(e, product)} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-semibold hover:bg-blue-100 transition-colors">
                      Message
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 🌟 THE LOAD MORE BUTTON */}
          {nextCursor && (
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

          {!nextCursor && products.length > 0 && (
            <p className="text-center text-gray-400 text-sm font-medium mt-8">
              🎉 You've seen everything! No more items to show.
            </p>
          )}
        </>
      )}

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