'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  User
} from 'firebase/auth';
import { auth, googleProvider, githubProvider } from '@/lib/firebase';
import { syncUserWithBackend } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const { profile, isLoading: isAuthLoading, setProfile } = useAuth();
  
  // UI State
  const [isSignUp, setIsSignUp] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 🚨 SMART REDIRECT: If already logged in, send them away!
  useEffect(() => {
    if (!isAuthLoading && profile && profile.role !== 'guest') {
      router.replace('/'); 
    }
  }, [profile, isAuthLoading, router]);

  // --- CORE SYNC & ROUTING LOGIC ---
  // We reuse this exact flow whether they use Google, GitHub, or Email
  const handleBackendSyncAndRoute = async (user: User) => {
    // 1. Get the secure ID token
    const token = await user.getIdToken();

    // 2. Sync with FastAPI Backend
    const data = await syncUserWithBackend(token);
    
    // 3. Update global state
    setProfile(data.profile);

    // 4. Route based on backend instruction (Progressive Onboarding)
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
  };

  // --- OAUTH HANDLERS ---
  const handleGoogleLogin = async () => {
    try {
      setIsAuthenticating(true);
      setError(null);
      const userCredential = await signInWithPopup(auth, googleProvider);
      await handleBackendSyncAndRoute(userCredential.user);
    } catch (err: any) {
      console.error(err);
      setError('Failed to sign in with Google.');
      setIsAuthenticating(false);
    }
  };

  const handleGithubLogin = async () => {
    try {
      setIsAuthenticating(true);
      setError(null);
      const userCredential = await signInWithPopup(auth, githubProvider);
      await handleBackendSyncAndRoute(userCredential.user);
    } catch (err: any) {
      console.error(err);
      setError('Failed to sign in with GitHub.');
      setIsAuthenticating(false);
    }
  };

  // --- EMAIL & PASSWORD HANDLER ---
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    try {
      setIsAuthenticating(true);
      setError(null);

      let userCredential;
      if (isSignUp) {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      }
      
      await handleBackendSyncAndRoute(userCredential.user);
    } catch (err: any) {
      console.error(err);
      // Clean, user-friendly Firebase error messages
      if (err.code === 'auth/email-already-in-use') setError("An account with this email already exists.");
      else if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') setError("Invalid email or password.");
      else if (err.code === 'auth/weak-password') setError("Password should be at least 6 characters.");
      else setError("Authentication failed. Please try again.");
      
      setIsAuthenticating(false);
    }
  };

  // 🚨 FLICKER FIX: Wait for Firebase to check local storage before showing the login box
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-gray-500">Checking secure session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8 relative">
      
      <Link href="/" className="absolute top-6 left-6 text-gray-500 hover:text-gray-900 font-bold text-sm transition flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        Back to Market
      </Link>

      <div className="max-w-md w-full bg-white p-8 sm:p-10 rounded-3xl shadow-xl border border-gray-100">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-2xl mx-auto mb-4 shadow-sm">
            S
          </div>
          <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">
            {isSignUp ? 'Join SRM Market' : 'Welcome Back'}
          </h2>
          <p className="mt-2 text-sm text-gray-500 font-medium">
            {isSignUp ? 'Create an account to start buying and selling.' : 'Log in to manage your campus deals.'}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-3 rounded-xl bg-red-50 text-red-600 text-sm font-bold text-center border border-red-100 animate-fade-in-up">
            {error}
          </div>
        )}

        {/* OAuth Buttons */}
        <div className="space-y-3 mb-6">
          <button
            onClick={handleGoogleLogin}
            disabled={isAuthenticating}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 border border-gray-200 rounded-xl shadow-sm bg-white text-sm font-bold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          <button 
            onClick={handleGithubLogin} disabled={isAuthenticating}
            className="w-full flex items-center justify-center gap-3 p-3.5 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition font-bold disabled:opacity-50 shadow-sm"
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
            Continue with GitHub
          </button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="h-px bg-gray-200 flex-1"></div>
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">or</span>
          <div className="h-px bg-gray-200 flex-1"></div>
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">Email Address</label>
            <input 
              type="email" required placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-sm font-medium transition"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">Password</label>
            <input 
              type="password" required placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none text-sm font-medium transition"
            />
          </div>

          <button 
            type="submit" disabled={isAuthenticating}
            className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-sm disabled:opacity-50 mt-2"
          >
            {isAuthenticating ? 'Authenticating...' : (isSignUp ? 'Create Account' : 'Log In')}
          </button>
        </form>

        {/* Toggle Sign Up / Log In */}
        <div className="mt-8 text-center border-t border-gray-100 pt-6">
          <p className="text-sm text-gray-500 font-medium">
            {isSignUp ? "Already have an account?" : "Don't have an account yet?"}
            <button 
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
              className="ml-2 text-blue-600 font-bold hover:text-blue-700 focus:outline-none transition-colors"
            >
              {isSignUp ? 'Log in' : 'Sign up'}
            </button>
          </p>
        </div>

      </div>
    </div>
  );
}