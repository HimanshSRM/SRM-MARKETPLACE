import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { NotificationProvider } from '@/context/NotificationContext';
import Navbar from '@/components/Navbar'; 

// 🚨 IMPORTED THE PERMISSION BANNER HERE
import NotificationPrompt from '@/components/NotificationPrompt'; 

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SRM Marketplace',
  description: 'Campus marketplace for SRM students',
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
          
          {/* 🚨 NotificationProvider wraps EVERYTHING so alerts work globally */}
          <NotificationProvider> 
            
            <Navbar /> {/* Navbar is inside so it can hear the unread count! */}
            
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