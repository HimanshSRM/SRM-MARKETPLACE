'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { createShopProfile, checkMyShop, restoreShopProfile } from '@/lib/api'; 

export default function ShopRegistrationPage() {
  const router = useRouter();
  const { profile, setProfile } = useAuth();
  
  const [isPageLoading, setIsPageLoading] = useState(true); 
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [previousShop, setPreviousShop] = useState<any>(null);
  const [choiceMade, setChoiceMade] = useState(false);
  const [isOverwriting, setIsOverwriting] = useState(false);

  const [formData, setFormData] = useState({
    shop_name: '',       
    description: '',
    location: '',
    contact_number: '',  
    contact_email: '',   
  });

  useEffect(() => {
    const fetchShopStatus = async () => {
      if (!profile) return;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        
        const check = await checkMyShop(token);
        if (check.has_shop) {
          setPreviousShop(check.shop_data);
        }
      } catch (error) {
        console.error("Error checking shop status", error);
      } finally {
        setIsPageLoading(false);
      }
    };
    
    fetchShopStatus();
  }, [profile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("You must be logged in.");

      // This is now ONLY called when starting fresh (or first time)
      await createShopProfile(token, formData, isOverwriting);
      
      // 🚨 SMART ROLE HANDLING: Only demote if they were a shop starting completely over
      if (profile) {
         const newRole = profile.role === 'shop_verified' ? 'guest' : profile.role;
         setProfile({ ...profile, role: newRole });
      }

      alert("Shop profile submitted successfully! Waiting for admin verification.");
      router.push('/shops');
      
    } catch (err: any) {
      console.error("Error creating shop:", err);
      setError(err.message || "Failed to submit shop registration. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestoreOldShop = async () => {
    if (!window.confirm("Restore your previous shop and catalog?")) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("You must be logged in.");

      await restoreShopProfile(token); // Calls the safe backend route

      // 🚨 SMART ROLE HANDLING: Safely demote them to guest if they were a verified shop awaiting re-approval
      if (profile) {
         const newRole = profile.role === 'shop_verified' ? 'guest' : profile.role;
         setProfile({ ...profile, role: newRole });
      }

      alert("Welcome back! Your shop has been restored and is pending admin approval.");
      router.push('/shops/dashboard'); // Send them straight to the dashboard
      
    } catch (err: any) {
      console.error("Error restoring shop:", err);
      setError(err.message || "Failed to restore shop. Please try again.");
      setIsSubmitting(false);
    }
  };

  const handleStartFresh = () => {
    if (!window.confirm("Are you sure? This will PERMANENTLY delete your old shop and all its items!")) return;
    setFormData({ shop_name: '', description: '', location: '', contact_number: '', contact_email: '' });
    setChoiceMade(true);
    setIsOverwriting(true);
  };

  if (!profile) {
    return <div className="p-20 text-center font-bold text-gray-500">Please log in to register a shop.</div>;
  }

  if (isPageLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 flex justify-center">
      <div className="max-w-2xl w-full space-y-8 bg-white p-8 sm:p-12 rounded-3xl shadow-sm border border-gray-100">
        
        {/* THE INTERCEPT UI */}
        {previousShop && !choiceMade ? (
          <div className="text-center animate-fade-in-up">
            <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl font-black">
              {previousShop.shop_name?.substring(0, 2) || '🏪'}
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-2">Welcome Back!</h2>
            <p className="text-gray-500 mb-8 max-w-md mx-auto">
              We noticed you previously registered a shop named <strong className="text-gray-900">"{previousShop.shop_name}"</strong>. What would you like to do?
            </p>
            
            {error && (
              <div className="mb-6 p-4 rounded-lg bg-red-50 text-red-600 text-sm font-bold border border-red-100">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <button 
                onClick={handleRestoreOldShop}
                disabled={isSubmitting}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? 'Restoring...' : `♻️ Reactivate "${previousShop.shop_name}"`}
              </button>
              
              <div className="relative py-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                <div className="relative flex justify-center"><span className="bg-white px-4 text-xs font-bold text-gray-400 uppercase tracking-widest">OR</span></div>
              </div>

              <button 
                onClick={handleStartFresh}
                disabled={isSubmitting}
                className="w-full py-4 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold rounded-xl transition disabled:opacity-50"
              >
                🧨 Delete Old Shop & Start a New Business
              </button>
            </div>
          </div>
        ) : (
          /* THE STANDARD REGISTRATION FORM (Only shows if starting fresh or first time) */
          <div className="animate-fade-in-up">
            <div>
              <h2 className="text-3xl font-black text-gray-900">
                Register Your Business
              </h2>
              <p className="mt-2 text-gray-500">
                Set up your official shop profile to sell products and services directly to SRM students.
              </p>
            </div>

            {error && (
              <div className="mt-6 p-4 rounded-lg bg-red-50 text-red-600 text-sm font-bold border border-red-100">
                {error}
              </div>
            )}

            <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
              
              <div>
                <label htmlFor="shop_name" className="block text-sm font-bold text-gray-700">Official Shop Name</label>
                <input
                  id="shop_name" name="shop_name" type="text" required
                  value={formData.shop_name} onChange={handleChange}
                  placeholder="e.g., TechFix SRM or Campus Cafe"
                  className="mt-2 block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-bold text-gray-700">Business Description</label>
                <textarea
                  id="description" name="description" rows={3} required
                  value={formData.description} onChange={handleChange}
                  placeholder="What do you sell or what services do you provide?"
                  className="mt-2 block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                />
              </div>

              <div>
                <label htmlFor="location" className="block text-sm font-bold text-gray-700">Campus Location</label>
                <input
                  id="location" name="location" type="text" required
                  value={formData.location} onChange={handleChange}
                  placeholder="e.g., Main Canteen, Block A"
                  className="mt-2 block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="contact_number" className="block text-sm font-bold text-gray-700">Public Phone / WhatsApp</label>
                  <input
                    id="contact_number" name="contact_number" type="tel" required
                    value={formData.contact_number} onChange={handleChange}
                    placeholder="+91..."
                    className="mt-2 block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                  />
                </div>

                <div>
                  <label htmlFor="contact_email" className="block text-sm font-bold text-gray-700">Business Email</label>
                  <input
                    id="contact_email" name="contact_email" type="email" required
                    value={formData.contact_email} onChange={handleChange}
                    placeholder="shop@example.com"
                    className="mt-2 block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-sm text-base font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                {isSubmitting ? 'Submitting Application...' : 'Submit Shop Application'}
              </button>

            </form>
          </div>
        )}
      </div>
    </div>
  );
}