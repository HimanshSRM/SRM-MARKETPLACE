'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { getGuestDashboard } from '@/lib/api';
import Link from 'next/link';

export default function GuestDashboardPage() {
  const { profile, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 🚨 0. WAIT FOR FIREBASE FIRST
    if (isAuthLoading) return;

    // 1. If not logged in, send to login
    if (!profile) {
      router.push('/login');
      return;
    }

    // 2. If they are a student, send them to their real profile
    if (profile.role === 'student') {
      router.push('/profile');
      return;
    }

    // 3. If they are a verified shop, send them to the shop dashboard
    if (profile.role === 'shop' || profile.role === 'shop_verified') {
      router.push('/shop');
      return;
    }

    // 4. Fetch Guest Data
    const loadDashboard = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        
        const data = await getGuestDashboard(token);
        setDashboardData(data);
      } catch (error) {
        console.error("Failed to load guest dashboard:", error);
      } finally {
        setIsLoading(false);
      }
    };

    if (profile.role === 'guest') {
      loadDashboard();
    }
  }, [profile, router, isAuthLoading]); // 🚨 Added isAuthLoading here

  if (profile === undefined || isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-bold text-gray-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
          <div className="w-20 h-20 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-4xl font-black shadow-inner">
            {profile?.email?.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Guest Account</h1>
            <p className="text-gray-500 font-medium mt-1">{profile?.email}</p>
            <div className="mt-3 inline-block px-3 py-1 bg-gray-100 text-gray-600 text-[10px] font-black uppercase tracking-wider rounded-lg border border-gray-200">
              Unverified User
            </div>
          </div>
        </div>

        {/* Info & Call to Action */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-blue-600 p-6 text-white">
            <h2 className="text-xl font-bold">Want to sell on the SRM Campus Market?</h2>
            <p className="text-blue-100 mt-2 text-sm">
              {dashboardData?.message || "Guest accounts can browse, but cannot post items."}
            </p>
          </div>
          
          <div className="p-6 md:p-8 space-y-6">
            
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xl shrink-0">🎓</div>
              <div>
                <h3 className="font-bold text-gray-900">Are you an SRM Student?</h3>
                <p className="text-sm text-gray-500 mt-1">If you want to sell second-hand items, log out and sign back in using your official <strong className="text-gray-700">@srmist.edu.in</strong> email address. Your account will be upgraded automatically.</p>
              </div>
            </div>

            <hr className="border-gray-100" />

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xl shrink-0">🏪</div>
              <div>
                <h3 className="font-bold text-gray-900">Are you a Local Business?</h3>
                <p className="text-sm text-gray-500 mt-1">If you own a shop or restaurant near campus and want to sell to students, you can apply for a Verified Shop account.</p>
                
                {/* 🚨 This button will eventually link to your Shop Application Form */}
                <button className="mt-4 px-5 py-2.5 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition shadow-sm">
                  Apply for a Shop Account →
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Browsing Call to Action */}
        <div className="text-center pt-4">
          <Link href="/" className="text-blue-600 font-bold hover:underline">
            ← Back to Browsing the Marketplace
          </Link>
        </div>

      </div>
    </div>
  );
}