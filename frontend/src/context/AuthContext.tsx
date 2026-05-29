'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import GuestBlockerModal from '@/components/GuestBlockerModal';
// 🚨 THE FIX: Swapped onAuthStateChanged for onIdTokenChanged
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase'; 
import { syncUserWithBackend } from '@/lib/api'; 

export type UserRole = 'guest' | 'student' | 'shop' | 'admin' | null | 'shop_verified' | 'banned';

export interface UserProfile {
  uid: string;
  role: UserRole;
  email?: string;
  name?: string;
  status?: string;
  phone?: string;
  upi_id?: string;
}

interface AuthContextType {
  profile: UserProfile | null;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  withRoleCheck: (action: () => void) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showGuestBlocker, setShowGuestBlocker] = useState(false);

  useEffect(() => {
    console.log("Setting up Firebase listener...");
    
    // 🚨 THE FIX: onIdTokenChanged automatically fires when a token is refreshed in the background!
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        console.log("Firebase found a saved user session! Fetching backend data...");
        
        document.cookie = "client_auth_sync=true; path=/; max-age=86400; SameSite=Strict";

        try {
          // 🚨 THE FIX: No need to grab the token manually! api.ts handles it automatically now.
          // Ask your FastAPI backend for this user's real role
          const data = await syncUserWithBackend();
          
          if (data && data.profile) {
            // 🚨 READ-ONLY BAN: Let them stay logged in, but lock their role to 'banned'
            if (data.profile.role === 'banned' || data.profile.status === 'banned') {
              console.log("User is banned. Entering read-only mode.");
              setProfile({ ...data.profile, role: 'banned' });
            } else {
              // Save the REAL profile into your global state if they aren't banned
              setProfile(data.profile);
            }
          } else {
            // Fallback if the API returns a success but missing profile data
            setProfile({ uid: firebaseUser.uid, role: 'guest', email: firebaseUser.email || undefined });
          }

        } catch (error) {
          console.error("🚨 CRITICAL BACKEND SYNC ERROR:", error);
          // If Firebase says they are logged in, keep them logged in locally as a guest.
          // This prevents the violent redirect to /login on page reloads if the API glitches.
          setProfile({ uid: firebaseUser.uid, role: 'guest', email: firebaseUser.email || undefined }); 
        }
        
      } else {
        console.log("No user session found.");
        document.cookie = "client_auth_sync=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict";
        setProfile(null);
      }
      
      // Stop the loading spinner ONLY after everything is resolved
      setIsLoading(false);
    });

    // Cleanup the listener when the component unmounts
    return () => unsubscribe();
  }, []);

  // The Interceptor: Now blocks both 'guest' and 'banned' users
  const withRoleCheck = (action: () => void) => {
    console.log("Interceptor checking role:", profile?.role); 
    
    if (!profile || profile.role === 'guest' || profile.role === 'banned') {
      console.log("Blocking action! User is Guest or Banned."); 
      setShowGuestBlocker(true);
    } else {
      console.log("User verified, proceeding!"); 
      action();
    }
  };

  return (
    <AuthContext.Provider value={{ profile, setProfile, isLoading, setIsLoading, withRoleCheck }}>
      {children}
      
      {/* The Blocker Modal sits at the root level, ready to pop up */}
      {showGuestBlocker && (
        <GuestBlockerModal onClose={() => setShowGuestBlocker(false)} />
      )}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};