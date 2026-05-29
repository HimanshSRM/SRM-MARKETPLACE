import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { NotificationProvider } from '@/context/NotificationContext';
import Navbar from '@/components/Navbar'; 
import NotificationPrompt from '@/components/NotificationPrompt'; 
import { Toaster } from 'react-hot-toast'; // Highly recommended for clean toast notifications

const inter = Inter({ subsets: ['latin'] });

// 🚨 PWA UPGRADE: Next.js 14+ expects themeColor here instead of in metadata
export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

// 🚨 THE SEO & PWA UPGRADE: This is what Google and Mobile phones read!
export const metadata: Metadata = {
  title: 'SRM Marketplace | Buy, Sell & Cart Pool on Campus',
  description: 'The official student marketplace for SRM Institute of Science and Technology. Buy used books, sell electronics, find tech repairs, and split delivery fees with Cart Pooling.',
  keywords: ['SRMIST', 'SRM Marketplace', 'SRM University', 'buy used books SRM', 'cart pool SRM', 'student marketplace'],
  manifest: '/manifest.json', // 📱 Links your PWA manifest for Android/Chrome
  appleWebApp: {              // 🍎 Tells iPhones how to display the installed app
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
        {/* 🚨 AuthProvider wraps EVERYTHING so every component knows if the user is logged in */}
        <AuthProvider>
          
          {/* 🚨 NotificationProvider wraps EVERYTHING so alerts work globally */}
          <NotificationProvider> 
            
            {/* The Toaster component enables beautiful success/error popups globally */}
            <Toaster position="top-center" />

            {/* Navbar is inside the providers so it can read auth state and notification counts! */}
            <Navbar /> 
            
            <main>
              {children}
            </main>
            
            {/* 🚨 THE PERMISSION BANNER! It stays hidden unless the user hasn't granted permissions yet */}
            <NotificationPrompt />
            
          </NotificationProvider>

        </AuthProvider>
      </body>
    </html>
  );
}