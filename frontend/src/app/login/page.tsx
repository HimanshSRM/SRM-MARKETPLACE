'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { syncUserWithBackend } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const router = useRouter();
  const { profile, isLoading: isAuthLoading, setProfile } = useAuth();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🚨 1. SMART REDIRECT: If they are already logged in, send them away from the login page!
  useEffect(() => {
    if (!isAuthLoading && profile && profile.role !== 'guest') {
      router.replace('/'); 
    }
  }, [profile, isAuthLoading, router]);

  const handleGoogleLogin = async () => {
    try {
      setIsAuthenticating(true);
      setError(null);

      // 1. Authenticate with Firebase
      const userCredential = await signInWithPopup(auth, googleProvider);
      const user = userCredential.user;

      // 2. Get the secure ID token
      const token = await user.getIdToken();

      // 3. Sync with FastAPI Backend
      const data = await syncUserWithBackend(token);
      
      // 4. Update global state
      setProfile(data.profile);

      // 5. Route based on backend instruction (Progressive Onboarding)
      switch (data.next_step) {
        case 'dashboard':
          router.push('/'); // Live feed
          break;
        case 'verify_srm_email':
          router.push('/verify-student');
          break;
        case 'apply_for_shop':
          router.push('/shop-application');
          break;
        case 'shop_pending_approval':
          router.push('/waiting-room');
          break;
        default:
          router.push('/'); // Fallback to guest view
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during sign in. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // 🚨 2. FLICKER FIX: Wait for Firebase to check local storage before showing the login box
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-gray-500">Checking secure session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-2xl shadow-sm border border-gray-100">
        
        {/* Header */}
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Campus Marketplace
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Sign in to buy, sell, and connect.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm text-center">
            {error}
          </div>
        )}

        {/* Auth Buttons */}
        <div className="mt-8 space-y-4">
          <button
            onClick={handleGoogleLogin}
            disabled={isAuthenticating}
            className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isAuthenticating ? (
              <span className="animate-pulse">Syncing profile...</span>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {/* Phone Auth Placeholder - Phone auth requires reCAPTCHA setup */}
          <button
            disabled={isAuthenticating}
            className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            📱 Continue with Phone (Coming Soon)
          </button>
        </div>
      </div>
    </div>
  );
}