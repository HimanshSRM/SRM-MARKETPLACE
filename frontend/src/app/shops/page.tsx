'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getLiveShops, Shop } from '@/lib/api';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

export default function ShopsDirectoryPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Bring in profile to ensure we wait for Firebase to initialize
  const { profile } = useAuth();

  useEffect(() => {
    const fetchShops = async () => {
      // Don't try to fetch until we know the user's auth status
      if (profile === undefined) return;

      try {
        setIsLoading(true);
        
        // 1. Get the secure token
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          setError("You must be logged in to view the shops directory.");
          setIsLoading(false);
          return;
        }

        // 2. 🚨 Pass the token to fix the 401 Unauthorized Error
        const data = await getLiveShops(token);
        
        // Only show verified shops in the public directory
        const verifiedShops = data.filter(shop => shop.is_verified);
        setShops(verifiedShops);
        
      } catch (err) {
        console.error("Failed to fetch shops:", err);
        setError("Could not load the campus shops directory.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchShops();
  }, [profile]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="mb-10 text-center sm:text-left">
          <h1 className="text-4xl font-black text-gray-900 tracking-tight">Campus Shops</h1>
          <p className="text-gray-500 mt-2 text-lg">Verified businesses and services around SRM.</p>
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-xl mb-8 border border-red-100 font-medium">
            {error}
          </div>
        )}

        {/* Loading State */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((n) => (
              <div key={n} className="bg-white h-48 rounded-2xl border border-gray-100 shadow-sm animate-pulse"></div>
            ))}
          </div>
        ) : shops.length === 0 && !error ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">No Shops Available</h3>
            <p className="text-gray-500 mt-2">Verified campus shops will appear here soon.</p>
          </div>
        ) : (
          /* Shops Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {shops.map((shop) => (
              <Link 
                href={`/shops/${shop.id}`} 
                key={shop.id}
                className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-black text-2xl uppercase tracking-tighter">
                    {shop.shop_name ? shop.shop_name.substring(0, 2) : 'SH'}
                  </div>
                  {shop.is_verified && (
                    <span className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-wider rounded-lg border border-blue-100">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                      Verified
                    </span>
                  )}
                </div>
                
                <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {shop.shop_name || shop.name}
                </h3>
                
                <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                  {shop.description}
                </p>

                {shop.location && (
                  <div className="mt-4 pt-4 border-t border-gray-50 flex items-center gap-2 text-xs text-gray-400 font-medium">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    {shop.location}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}