'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import GuestBlockerModal from '@/components/GuestBlockerModal';

// Define the roles matching your backend
export type UserRole = 'guest' | 'student' | 'shop' | 'admin' | null |'shop_verified';

export interface UserProfile {
  uid: string;
  role: UserRole;
  email?: string;
  name?: string;
}

interface AuthContextType {
  profile: UserProfile | null;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  // Added the missing withRoleCheck definition!
  withRoleCheck: (action: () => void) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showGuestBlocker, setShowGuestBlocker] = useState(false);

 
  // The Interceptor: Checks role before executing a protected action
  const withRoleCheck = (action: () => void) => {
    console.log("Interceptor checking role:", profile?.role); // ADD THIS
    
    if (!profile || profile.role === 'guest') {
      console.log("Blocking user, showing modal!"); // ADD THIS
      setShowGuestBlocker(true);
    } else {
      console.log("User verified, proceeding!"); // ADD THIS
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

// Custom hook to easily grab the user anywhere in the app
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};