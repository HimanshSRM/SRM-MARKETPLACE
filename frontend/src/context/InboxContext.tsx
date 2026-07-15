// context/InboxContext.tsx
'use client';

import React, { createContext, useContext, ReactNode } from 'react';
// 🚨 Import the custom hook you already built
import { useRealtimeInbox } from '@/lib/useRealtimeInbox'; 

// Define exactly what the rest of the app expects to get from the Inbox
interface InboxContextType {
  buying: any[];
  selling: any[];
  support: any[];
  pools: any[];
  isLoading: boolean;
}

// Create the actual context container
const InboxContext = createContext<InboxContextType | undefined>(undefined);

export const InboxProvider = ({ children }: { children: ReactNode }) => {
  // 🚨 This is the magic. 
  // Because this provider wraps the whole app, this hook runs exactly ONCE.
  // It stays alive quietly in the background, syncing Firebase for free.
  const inboxData = useRealtimeInbox();

  return (
    <InboxContext.Provider value={inboxData}>
      {children}
    </InboxContext.Provider>
  );
};

// 🚨 The simple tool you use in your pages to grab the data instantly
export const useGlobalInbox = () => {
  const context = useContext(InboxContext);
  if (context === undefined) {
    throw new Error('useGlobalInbox must be used within an InboxProvider');
  }
  return context;
};