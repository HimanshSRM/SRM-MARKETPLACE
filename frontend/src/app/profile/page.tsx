'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { 
  getStudentDashboard, 
  deleteMyListing, 
  updateStudentContact, 
  toggleListingVisibility 
} from '@/lib/api';
import Link from 'next/link';
import toast from 'react-hot-toast';
import EditListingModal from '../../components/EditListingModal';

export default function StudentDashboardPage() {
  // 🚨 THE FIX: Grabbed setProfile from context to forcefully update local memory
  const { profile, setProfile, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [myListings, setMyListings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // UI States for Settings
  const [phoneInput, setPhoneInput] = useState('');
  const [upiInput, setUpiInput] = useState('');
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);

  const [editingListing, setEditingListing] = useState<any>(null);

  useEffect(() => {
    if (isAuthLoading) return;

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
        const data = await getStudentDashboard();
        setDashboardData(data);
        setMyListings(data.listings || []);
        
        // Pre-fill settings inputs
        setPhoneInput(data.phone || '');
        setUpiInput(data.upi_id || '');
      } catch (error) {
        console.error("Failed to load dashboard:", error);
        toast.error("Could not load your profile data.");
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboard();
  }, [profile, router, isAuthLoading]);

  // Handle Saving Default Contact Info
  const handleSaveDefaults = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingDefaults(true);
    try {
      await updateStudentContact({ phone: phoneInput, upi_id: upiInput });
      
      // 🚨 THE FIX: Instantly overwrite React's local memory so it updates everywhere without a refresh!
      setProfile((prev: any) => prev ? { ...prev, phone: phoneInput, upi_id: upiInput } : null);
      
      toast.success("Default settings saved successfully!");
    } catch (error: any) {
      toast.error(error.message || "Failed to save settings.");
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const handleDelete = async (listingId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this listing?")) return;
    try {
      await deleteMyListing(listingId);
      setMyListings((prev) => prev.filter(item => item.id !== listingId));
      toast.success("Listing deleted successfully.");
    } catch (error: any) {
      toast.error("Failed to delete listing.");
      console.error(error);
    }
  };

  const handleToggleVisibility = async (listingId: string, currentStatus: string) => {
    const willBeActive = currentStatus !== 'active';
    try {
      await toggleListingVisibility(listingId, willBeActive);
      
      // Optimistic UI Update
      setMyListings((prevListings) => 
        prevListings.map(item => 
          item.id === listingId 
            ? { ...item, status: willBeActive ? 'active' : 'hidden' } 
            : item
        )
      );
      toast.success(`Listing is now ${willBeActive ? 'Live' : 'Hidden'}.`);
    } catch (error: any) {
      toast.error(error.message || "Failed to change listing status.");
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

  if (!profile) return null;

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
        
        {/* Profile Header Center Stack */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-4 sm:gap-6 transition-all">
          <div className="w-20 h-20 bg-blue-600 text-white rounded-full flex items-center justify-center text-4xl font-black shadow-md shrink-0">
            {profile?.email?.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col items-center sm:items-start w-full">
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">My Profile</h1>
            <p className="text-gray-500 font-medium mt-1 break-words w-full max-w-sm sm:max-w-none">
              {dashboardData?.message || `Logged in as ${profile?.email}`}
            </p>
            <span className="inline-block mt-3 px-3 py-1 bg-green-100 text-green-700 text-[10px] font-black uppercase tracking-wider rounded-lg border border-green-200">
              Verified Student
            </span>
          </div>
        </div>

        {/* Default Settings Panel */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-sm">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">Default Chat Settings</h2>
            <p className="text-sm text-gray-500 mt-1">This info auto-fills in the chat room when you finalize a deal. Buyers will see your UPI, Sellers will see your WhatsApp.</p>
          </div>
          <form onSubmit={handleSaveDefaults} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">WhatsApp Number</label>
                <input 
                  type="tel" 
                  value={phoneInput} 
                  onChange={(e) => setPhoneInput(e.target.value)} 
                  placeholder="e.g. 9876543210" 
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">UPI ID</label>
                <input 
                  type="text" 
                  value={upiInput} 
                  onChange={(e) => setUpiInput(e.target.value.toLowerCase())} 
                  placeholder="e.g. 9876543210@ybl" 
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button 
                type="submit" 
                disabled={isSavingDefaults}
                className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-sm hover:bg-blue-700 disabled:opacity-50 transition active:scale-95 flex items-center justify-center gap-2"
              >
                {isSavingDefaults && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                {isSavingDefaults ? 'Saving...' : 'Save Defaults'}
              </button>
            </div>
          </form>
        </div>

        {/* My Listings Section */}
        <div>
          <div className="flex flex-wrap gap-4 justify-between items-center mb-6 px-1">
            <h2 className="text-2xl font-bold text-gray-900">My Listings</h2>
            <Link href="/create-product" className="px-5 py-2.5 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition shadow-sm whitespace-nowrap">
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
                <div key={listing.id} className={`bg-white rounded-2xl border shadow-sm flex flex-col overflow-hidden relative transition-all ${listing.status === 'hidden' ? 'border-orange-400 ring-2 ring-orange-100' : listing.status === 'suspended' ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-100'}`}>
                  
                  <div className={`h-40 w-full relative group ${listing.status === 'suspended' || listing.status === 'sold' ? 'grayscale opacity-75' : 'bg-gray-100'}`}>
                    {listing.image_url ? (
                      <img src={listing.image_url} alt={listing.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-100">
                        <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      </div>
                    )}
                  </div>

                  <div className="p-5 flex flex-col flex-grow">
                    <h3 className="font-bold text-gray-900 text-lg line-clamp-1">{listing.title}</h3>
                    <p className="text-sm font-black text-green-600 mt-1">₹{listing.price}</p>
                    
                    {listing.status === 'suspended' ? (
                      <div className="mt-3 text-[10px] font-black uppercase tracking-wider text-red-700 bg-red-50 px-3 py-1.5 rounded-lg inline-block self-start border border-red-200">
                        🚨 Suspended By Admin
                      </div>
                    ) : listing.status === 'sold' ? (
                      <div className="mt-3 text-[10px] font-black uppercase tracking-wider text-gray-700 bg-gray-100 px-3 py-1.5 rounded-lg inline-block self-start border border-gray-200">
                        🤝 Sold
                      </div>
                    ) : listing.status === 'hidden' ? (
                      <div className="mt-3 text-[10px] font-black uppercase tracking-wider text-orange-700 bg-orange-50 px-3 py-1.5 rounded-lg inline-block self-start border border-orange-200">
                        ⏸️ Hidden (Paused)
                      </div>
                    ) : (
                      <div className="mt-3 text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg inline-block self-start border border-blue-100">
                        ✅ Live on Feed
                      </div>
                    )}
                    
                    <div className="mt-auto pt-4 flex flex-col gap-2">
                      {listing.status !== 'suspended' && listing.status !== 'sold' && (
                        <button 
                          onClick={() => handleToggleVisibility(listing.id, listing.status)}
                          className={`w-full py-2 font-bold text-xs rounded-xl transition ${
                            listing.status === 'active' 
                              ? 'bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-100' 
                              : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-100'
                          }`}
                        >
                          {listing.status === 'active' ? '⏸️ Pause / Hide Listing' : '▶️ Make Live on Feed'}
                        </button>
                      )}

                      <div className="flex gap-2">
                        <button 
                          onClick={() => setEditingListing(listing)}
                          disabled={listing.status === 'suspended'}
                          className="flex-1 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 font-bold text-xs rounded-xl transition disabled:opacity-50"
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
                </div>
              ))}
            </div>
          )}
        </div>

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