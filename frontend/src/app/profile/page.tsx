'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { getStudentDashboard, deleteMyListing } from '@/lib/api';
import Link from 'next/link';
import toast from 'react-hot-toast';
import EditListingModal from '../../components/EditListingModal';

export default function StudentDashboardPage() {
  const { profile, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [myListings, setMyListings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 🚨 The State for the Edit Modal
  const [editingListing, setEditingListing] = useState<any>(null);

  useEffect(() => {
    // 🚨 0. Wait for Firebase to finish checking
    if (isAuthLoading) return;

    // 1. If not logged in, kick to login
    if (!profile) {
      router.push('/login');
      return;
    }

    const loadDashboard = async () => {
      if (!profile || profile.role !== 'student') {
        setIsLoading(false);
        return;
      }

      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        
        const data = await getStudentDashboard(token);
        setDashboardData(data);
        setMyListings(data.listings || []);
      } catch (error) {
        console.error("Failed to load dashboard:", error);
        toast.error("Could not load your profile data.");
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboard();
  }, [profile, router]);

  // THE DELETE LOGIC
  const handleDelete = async (listingId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this listing?")) return;
    
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      
      await deleteMyListing(token, listingId);
      
      setMyListings((prev) => prev.filter(item => item.id !== listingId));
      toast.success("Listing deleted successfully.");
    } catch (error: any) {
      toast.error("Failed to delete listing.");
      console.error(error);
    }
  };

  if (isAuthLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-gray-500">Loading Student Dashboard...</p>
      </div>
    );
  }

  // 🚨 2. Safe fallback while router redirects
  if (!profile) return null;

  // Bouncer
  if (profile?.role !== 'student') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-center p-4">
        <h2 className="text-2xl font-bold mb-2">Access Restricted</h2>
        <p className="text-gray-500 mb-4">This dashboard is specifically for students. Your role is: {profile?.role}</p>
        <button onClick={() => router.push('/')} className="px-6 py-2 bg-gray-900 text-white rounded-xl font-bold">Go Home</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Profile Header */}
        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-6">
          <div className="w-20 h-20 bg-blue-600 text-white rounded-full flex items-center justify-center text-4xl font-black shadow-inner">
            {profile?.email?.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">My Profile</h1>
            <p className="text-gray-500 font-medium">{dashboardData?.message || `Logged in as ${profile?.email}`}</p>
            <span className="inline-block mt-2 px-3 py-1 bg-green-100 text-green-700 text-[10px] font-black uppercase tracking-wider rounded-lg border border-green-200">
              Verified Student
            </span>
          </div>
        </div>

        {/* My Listings Section */}
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">My Listings</h2>
            <Link href="/create-product" className="px-5 py-2.5 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition shadow-sm">
              + Post New Item
            </Link>
          </div>

          {myListings.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-300">
              <p className="text-gray-500 mb-4 font-medium">You haven't posted anything to the marketplace yet.</p>
              <Link href="/create-product" className="text-blue-600 font-bold hover:underline">
                Create your first listing →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {myListings.map((listing: any) => (
                <div key={listing.id} className={`bg-white rounded-2xl border shadow-sm flex flex-col overflow-hidden relative transition-all ${listing.status === 'hidden' ? 'border-orange-400 ring-2 ring-orange-100' : 'border-gray-100'}`}>
                  
                  {/* Image Placeholder */}
                  <div className="h-40 w-full bg-gray-100 relative group">
                    {listing.image_url ? (
                      <img src={listing.image_url} alt={listing.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      </div>
                    )}
                  </div>

                  {/* Info & Actions */}
                  <div className="p-5 flex flex-col flex-grow">
                    <h3 className="font-bold text-gray-900 text-lg line-clamp-1">{listing.title}</h3>
                    <p className="text-sm font-black text-green-600 mt-1">₹{listing.price}</p>
                    
                    {/* THE STATUS BADGE */}
                    {listing.status === 'hidden' ? (
                      <div className="mt-3 text-[10px] font-black uppercase tracking-wider text-orange-700 bg-orange-100 px-3 py-1.5 rounded-lg inline-block self-start border border-orange-200">
                        ⚠️ Hidden By Admin
                      </div>
                    ) : (
                      <div className="mt-3 text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg inline-block self-start border border-blue-100">
                        ✅ Live on Feed
                      </div>
                    )}
                    
                    <div className="mt-auto pt-5 flex gap-2">
                      <button 
                        onClick={() => setEditingListing(listing)}
                        className="flex-1 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 font-bold text-xs rounded-xl transition"
                      >
                        ✏️ Edit
                      </button>
                      <button 
                        onClick={() => handleDelete(listing.id)}
                        className="flex-1 py-2 bg-red-50 text-red-600 hover:bg-red-100 font-bold text-xs rounded-xl transition border border-red-100"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 🚨 THE MODAL IS MOUNTED HERE SO IT IS OFFICIALLY 'USED' */}
        {editingListing && (
          <EditListingModal 
            listing={editingListing} 
            onClose={() => setEditingListing(null)} 
            onSuccess={(updated) => {
              setMyListings(prev => prev.map(item => item.id === updated.id ? updated : item));
            }}
          />
        )}

      </div>
    </div>
  );
}