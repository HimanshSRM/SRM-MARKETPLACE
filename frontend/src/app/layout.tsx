// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
// @ts-ignore: allow side-effect CSS import in Next.js app directory
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { NotificationProvider } from '@/context/NotificationContext';
// 🚨 Import the new Inbox Provider
import { InboxProvider } from '@/context/InboxContext'; 
import Navbar from '@/components/Navbar'; 
import NotificationPrompt from '@/components/NotificationPrompt'; 
import ActivePoolTracker from '@/components/ActivePoolTracker'; 
import { Toaster } from 'react-hot-toast'; 

const inter = Inter({ subsets: ['latin'] });

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'SRM Marketplace | Buy, Sell & Cart Pool on Campus',
  description: 'The official student marketplace for SRM Institute of Science and Technology. Buy used books, sell electronics, find tech repairs, and split delivery fees with Cart Pooling.',
  keywords: ['SRMIST', 'SRM Marketplace', 'SRM University', 'buy used books SRM', 'cart pool SRM', 'student marketplace'],
  manifest: '/manifest.json', 
  appleWebApp: {              
    capable: true,
    statusBarStyle: 'default',
    title: 'SRM Market',
  },
  openGraph: {
    title: 'SRM Marketplace',
    description: 'The premier student marketplace for the SRM campus.',
    url: 'https://srm-marketplace-webapp.vercel.app', 
    siteName: 'SRM Marketplace',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <NotificationProvider> 
            {/* 🚨 Wrap the app in the InboxProvider */}
            <InboxProvider>
              <Toaster position="top-center" />
              <Navbar /> 
              
              <main>
                {children}
              </main>
              
              <NotificationPrompt />
              
              <ActivePoolTracker /> 
              
            </InboxProvider>
          </NotificationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}