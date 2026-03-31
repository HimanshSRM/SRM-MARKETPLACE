import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import Navbar from '@/components/Navbar'; // 🚨 IMPORT NAVBAR HERE
import { NotificationProvider } from '@/context/NotificationContext';

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
          
          <NotificationProvider> {/* 🚨 NotificationProvider wraps EVERYTHING */}
            
            <Navbar /> {/* 🚨 Navbar is now INSIDE, so it can hear the unread count! */}
            
            <main>
              {children}
            </main>
            
          </NotificationProvider>

        </AuthProvider>
      </body>
    </html>
  );
}