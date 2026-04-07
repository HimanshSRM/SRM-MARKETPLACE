'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { createShopProfile } from '@/lib/api'; // Make sure this matches your api.ts export!

// If your API expects this exact interface, we define it here:
export interface ShopApplicationData {
  shop_name: string;
  description: string;
  location: string;
  contact_number: string;
  contact_email: string;
}

export default function ShopApplicationPage() {
  const router = useRouter();
  const { profile, setProfile, isLoading: isAuthLoading } = useAuth();
  
  const [formData, setFormData] = useState<ShopApplicationData>({
    shop_name: '',
    description: '',
    location: '',
    contact_number: '',
    contact_email: '',
  });

  // --- PERSISTENT STATE: FORM DRAFT ---
  // 1. Load saved form data on initial render
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedForm = localStorage.getItem('draft_shopApplication');
      if (savedForm) {
        try {
          setFormData(JSON.parse(savedForm));
        } catch (e) {
          console.error('Failed to parse saved application draft');
        }
      }
    }
  }, []);

  // 2. Save form data to memory whenever it changes
  useEffect(() => {
    localStorage.setItem('draft_shopApplication', JSON.stringify(formData));
  }, [formData]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🚨 NEW: State to hold the "Old Shop" choice
  const [previousShop, setPreviousShop] = useState<any>(null);
  const [choiceMade, setChoiceMade] = useState(false);
  const [isOverwriting, setIsOverwriting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Authentication lost. Please log in again.');

      // 1. Submit to FastAPI (Passing the overwrite flag)
      const response = await createShopProfile(token, formData, isOverwriting);

      // 🚨 The Intercept: Backend found an old shop and we haven't made a choice yet!
      if (response.status === 'exists' && !isOverwriting) {
        setPreviousShop(response.shop_data);
        setIsLoading(false);
        return; // Stop the form submission and show the choice UI
      }

      // 2. Update local context 
      if (profile) {
        setProfile({ ...profile, role: 'student' }); // Set back to student while pending
      }

      // 🚨 CLEAR DRAFT ON SUCCESS
      localStorage.removeItem('draft_shopApplication');

      // 3. Route back to directory
      alert("Shop profile submitted successfully! Waiting for admin verification.");
      router.push('/shops');
      
    } catch (err: any) {
      setError(err.message || 'Could not submit application. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // 🚨 THE HANDLERS FOR THEIR CHOICE
  const handleRestoreOldShop = () => {
    setFormData({
      shop_name: previousShop.shop_name || previousShop.name || '',
      description: previousShop.description || '',
      location: previousShop.location || '',
      contact_number: previousShop.contact_number || '',
      contact_email: previousShop.contact_email || '',
    });
    setChoiceMade(true);
    setIsOverwriting(true); 
  };

  const handleStartFresh = () => {
    if (!window.confirm("Are you sure? This will PERMANENTLY delete your old shop and all its items!")) return;
    setFormData({ shop_name: '', description: '', location: '', contact_number: '', contact_email: '' });
    setChoiceMade(true);
    setIsOverwriting(true);
    // Clear any existing drafts since they want to start fresh
    localStorage.removeItem('draft_shopApplication');
  };

  // 🚨 1. Wait for Firebase to finish checking
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        {/* Note: I made the spinner purple to match your shop branding! */}
        <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-gray-500">Loading Application...</p>
      </div>
    );
  }

  // 🚨 2. Safe fallback if they actually aren't logged in
  if (!profile) {
    return <div className="p-20 text-center font-bold text-red-500">Please log in to apply for a shop.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        
        {/* 🚨 THE INTERCEPT UI: If we found an old shop and they haven't chosen yet */}
        {previousShop && !choiceMade ? (
          <div className="text-center animate-fade-in-up">
            <div className="w-20 h-20 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl font-black">
              {previousShop.shop_name?.substring(0, 2) || '🏪'}
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-2">Welcome Back!</h2>
            <p className="text-gray-500 mb-8 max-w-md mx-auto">
              We noticed you previously registered a shop named <strong className="text-gray-900">"{previousShop.shop_name}"</strong>. What would you like to do?
            </p>
            
            <div className="space-y-4">
              <button 
                onClick={handleRestoreOldShop}
                className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition shadow-sm"
              >
                ♻️ Reactivate "{previousShop.shop_name}"
              </button>
              
              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                <div className="relative flex justify-center"><span className="bg-white px-4 text-xs font-bold text-gray-400 uppercase tracking-widest">OR</span></div>
              </div>

              <button 
                onClick={handleStartFresh}
                className="w-full py-4 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold rounded-xl transition"
              >
                🧨 Delete Old Shop & Start a New Business
              </button>
            </div>
          </div>
        ) : (
          /* --- THE STANDARD REGISTRATION FORM --- */
          <div className="animate-fade-in-up">
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-gray-900">
                {isOverwriting && previousShop ? 'Update & Reactivate Shop' : 'Partner with Us'}
              </h2>
              <p className="text-gray-500 mt-2">
                Apply to open your campus shop. We review all applications within 24 hours.
              </p>
            </div>

            {error && (
              <div className="mb-6 p-4 rounded-lg bg-red-50 text-red-600 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                
                {/* Shop Name */}
                <div className="sm:col-span-2">
                  <label htmlFor="shop_name" className="block text-sm font-medium text-gray-700 mb-1">Shop Name</label>
                  <input
                    type="text"
                    name="shop_name"
                    id="shop_name"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                    value={formData.shop_name}
                    onChange={handleChange}
                  />
                </div>

                {/* Description */}
                <div className="sm:col-span-2">
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">What do you sell?</label>
                  <textarea
                    name="description"
                    id="description"
                    rows={3}
                    required
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all resize-none"
                    value={formData.description}
                    onChange={handleChange}
                  />
                </div>

                {/* Location */}
                <div className="sm:col-span-2">
                  <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">Campus Location (or Online)</label>
                  <input
                    type="text"
                    name="location"
                    id="location"
                    required
                    placeholder="e.g., Java Tech Park, Block C"
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                    value={formData.location}
                    onChange={handleChange}
                  />
                </div>

                {/* Contact Email */}
                <div>
                  <label htmlFor="contact_email" className="block text-sm font-medium text-gray-700 mb-1">Business Email</label>
                  <input
                    type="email"
                    name="contact_email"
                    id="contact_email"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                    value={formData.contact_email}
                    onChange={handleChange}
                  />
                </div>

                {/* Contact Number */}
                <div>
                  <label htmlFor="contact_number" className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    name="contact_number"
                    id="contact_number"
                    required
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                    value={formData.contact_number}
                    onChange={handleChange}
                  />
                </div>

              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg disabled:opacity-50 transition-colors"
                >
                  {isLoading ? 'Submitting Application...' : (isOverwriting && previousShop ? 'Submit Reactivation Request' : 'Submit Application')}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}