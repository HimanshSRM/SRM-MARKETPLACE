'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getLiveShops } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export default function ShopsDirectoryPage() {
  const [shops, setShops] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { profile, isLoading: isAuthLoading } = useAuth();

  useEffect(() => {
    if (isAuthLoading) return;

    const fetchShops = async () => {
      try {
        setIsLoading(true);
        
        if (!profile) {
          setError("You must be logged in to view the shops directory.");
          return;
        }

        const data = await getLiveShops();
        
        // Only show verified shops in the public directory
        const verifiedShops = data.filter((shop: any) => shop.is_verified || shop.status === 'approved');
        setShops(verifiedShops);
        
      } catch (err) {
        console.error("Failed to fetch shops:", err);
        setError("Could not load the campus shops directory.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchShops();
  }, [profile, isAuthLoading]);

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

        {/* LOADING STATE SKELETON */}
        {isAuthLoading || isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="bg-white h-56 rounded-3xl border border-gray-100 shadow-sm animate-pulse p-6 flex flex-col justify-between">
                <div className="flex justify-between items-start">
                  <div className="w-14 h-14 bg-gray-200 rounded-2xl"></div>
                  <div className="w-16 h-6 bg-gray-200 rounded-full"></div>
                </div>
                <div className="space-y-3 mt-4">
                  <div className="h-5 bg-gray-200 w-3/4 rounded-md"></div>
                  <div className="h-4 bg-gray-200 w-full rounded-md"></div>
                </div>
              </div>
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
            {shops.map((shop) => {
              const catalogCount = shop.catalog?.length || 0;
              const isOpen = shop.is_open === true;

              return (
                <Link 
                  href={`/shops/${shop.id}`} 
                  key={shop.id}
                  className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col h-full"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-600 rounded-2xl flex items-center justify-center font-black text-2xl uppercase tracking-tighter border border-blue-100/50 shadow-inner group-hover:scale-105 transition-transform flex-shrink-0">
                      {shop.shop_name ? shop.shop_name.substring(0, 2) : 'SH'}
                    </div>
                    
                    <div className="flex flex-col items-end gap-2">
                      <span className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-black uppercase tracking-wider rounded-lg border border-blue-100">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                        Verified
                      </span>
                      
                      {/* 🚨 OPEN/CLOSED INDICATOR */}
                      <span className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-md ${
                        isOpen ? 'text-green-600 bg-green-50' : 'text-gray-400 bg-gray-50'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></span>
                        {isOpen ? 'Open Now' : 'Closed'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex-grow">
                    <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                      {shop.shop_name || shop.name}
                    </h3>
                    
                    {/* 📍 AESTHETIC SHOP LOCATION / ADDRESS */}
                    {(shop.location || shop.block) && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-gray-400">
                        <svg className="w-4 h-4 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-xs font-bold truncate tracking-wide">{shop.location || shop.block}</span>
                      </div>
                    )}
                    
                    <p className="text-sm text-gray-500 mt-2.5 line-clamp-2 font-medium">
                      {shop.tagline || shop.description}
                    </p>

                    {/* 🚨 THE FLASH DEAL BANNER */}
                    {shop.active_deal && new Date(shop.active_deal.expires_at) > new Date() && (
                      <div className="mt-4 bg-gradient-to-r from-yellow-400 to-orange-500 p-3 rounded-xl shadow-sm border border-yellow-300 text-yellow-950 animate-fade-in-up">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-black uppercase tracking-widest flex items-center gap-1">
                            <span className="animate-pulse">⚡</span> Flash Deal
                          </span>
                          <span className="text-[10px] font-bold bg-white/30 px-2 py-0.5 rounded-full">
                            Ends Soon
                          </span>
                        </div>
                        <p className="font-bold text-sm truncate">{shop.active_deal.item_name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-lg font-black tracking-tight">₹{shop.active_deal.deal_price}</span>
                          <span className="text-xs line-through opacity-60 font-bold">₹{shop.active_deal.original_price}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 pt-4 border-t border-gray-50 flex items-center justify-between text-xs font-bold">
                    {/* 🚨 CATALOG COUNT */}
                    <span className="bg-gray-50 text-gray-500 px-3 py-1.5 rounded-lg border border-gray-100">
                      {catalogCount} {catalogCount === 1 ? 'Service' : 'Services'}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}