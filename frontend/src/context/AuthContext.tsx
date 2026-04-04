'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import GuestBlockerModal from '@/components/GuestBlockerModal';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase'; 
import { syncUserWithBackend } from '@/lib/api'; 

export type UserRole = 'guest' | 'student' | 'shop' | 'admin' | null | 'shop_verified' | 'banned';

export interface UserProfile {
  uid: string;
  role: UserRole;
  email?: string;
  name?: string;
  status?: string;
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
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        console.log("Firebase found a saved user session! Fetching backend data...");
        
        try {
          // 1. Get the secure token from Firebase
          const token = await firebaseUser.getIdToken();
          
          // 2. Ask your FastAPI backend for this user's real role
          const data = await syncUserWithBackend(token);
          
          if (data && data.profile) {
            // 🚨 READ-ONLY BAN: Let them stay logged in, but lock their role to 'banned'
            if (data.profile.role === 'banned' || data.profile.status === 'banned') {
              console.log("User is banned. Entering read-only mode.");
              setProfile({ ...data.profile, role: 'banned' });
            } else {
              // 3. Save the REAL profile into your global state if they aren't banned
              setProfile(data.profile);
            }
          } else {
            // Fallback if the API returns a success but missing profile data
            setProfile({ uid: firebaseUser.uid, role: 'guest', email: firebaseUser.email || undefined });
          }

        } catch (error) {
          console.error("🚨 CRITICAL BACKEND SYNC ERROR:", error);
          // 🚨 THE FIX: Do NOT setProfile(null) here! 
          // If Firebase says they are logged in, keep them logged in locally as a guest.
          // This prevents the violent redirect to /login on page reloads if the API glitches.
          setProfile({ uid: firebaseUser.uid, role: 'guest', email: firebaseUser.email || undefined }); 
        }
        
      } else {
        console.log("No user session found.");
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