'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { useNotifications } from '@/context/NotificationContext';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth(); 
  const { unreadCount } = useNotifications();

  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); 

  if (pathname === '/login') return null;
  const isInboxActive = pathname?.startsWith('/chat') || false;

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsMobileMenuOpen(false); 
      router.push('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const closeMenu = () => setIsMobileMenuOpen(false);
  const isAuthLoading = profile === undefined;

  return (
    <>
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        
        {/* 🚨 BANNED USER WARNING BANNER */}
        {profile?.role === 'banned' && (
          <div className="bg-red-600 text-white text-center py-2 px-4 text-xs sm:text-sm font-bold shadow-inner">
            ⚠️ Your account has been suspended. You are in read-only mode and cannot post, message, or buy items.
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 sm:px-8">
          <div className="flex justify-between items-center h-16">
            
            {/* 1. Brand / Logo */}
            <Link href="/" onClick={closeMenu} className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-xl">
                S
              </div>
              <span className="font-bold text-xl tracking-tight text-gray-900 hidden sm:block">
                SRM Market
              </span>
            </Link>

            {/* 2. DESKTOP CONTROLS (Hidden on small screens) */}
            <div className="hidden md:flex items-center gap-4 lg:gap-6">
              
              {!isAuthLoading && profile && (
                <Link href="/support" className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">
                  🎧 Support
                </Link>
              )}

              {isAuthLoading ? (
                <div className="w-20 h-10 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin"></div>
                </div>
              ) : !profile ? (
                <Link href="/login" className="px-5 py-2 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 transition shadow-sm">
                  Log In
                </Link>
              ) : profile.role === 'guest' ? (
                <>
                  <span className="items-center px-3 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold rounded-full border border-yellow-200">
                    Role: Guest
                  </span>
                  
                  <Link href="/guest" className="px-4 py-2 bg-gray-100 text-gray-900 text-sm font-bold rounded-xl hover:bg-gray-200 transition shadow-sm">
                    Dashboard
                  </Link>

                  <button onClick={() => setIsVerifyModalOpen(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition shadow-sm">
                    Verify ID
                  </button>

                  <button onClick={handleLogout} className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition">
                    Log out
                  </button>
                </>
              ) : (
                <>
                  {/* INBOX BUTTON & RED DOT */}
                  <Link 
                    href="/chat" 
                    className={`relative p-2 flex items-center justify-center rounded-full transition-all group ${isInboxActive ? 'bg-blue-50' : 'hover:bg-gray-100'}`} 
                    title="Inbox"
                  >
                    <svg className={`w-6 h-6 transition-colors ${isInboxActive ? 'text-blue-600' : 'text-gray-600 group-hover:text-blue-600'}`} fill={isInboxActive ? "currentColor" : "none"} viewBox="0 0 24 24" stroke={isInboxActive ? "none" : "currentColor"}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    
                    {unreadCount > 0 && (
                      <span className="absolute top-0 right-0 -mr-1 -mt-1 w-5 h-5 bg-red-600 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-md z-10 animate-pulse">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Link>

                  {/* Directory & Post Links */}
                  <Link href="/shops" className="px-3 py-2 text-sm font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">
                   🏢 Shops
                  </Link>
                  
                  <Link href="/create-product" className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition shadow-sm">
                    + Post
                  </Link>

                  {/* PROFILE BUTTON */}
                  <div className="flex items-center gap-2 border-l border-gray-200 pl-4 ml-2">
                    <Link 
                      href={profile.role === 'admin' ? '/admin' : profile.role === 'shop_verified' ? '/shops/dashboard' : '/profile'} 
                      className="flex items-center gap-2 px-2 py-1 pr-4 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 rounded-full transition shadow-sm group"
                      title="My Dashboard"
                    >
                      <div className="w-8 h-8 bg-gray-900 group-hover:bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-black transition-colors">
                        {profile.email?.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs font-bold text-gray-700 hidden lg:block group-hover:text-blue-700 transition-colors">
                        {profile.role === 'admin' ? 'Admin Panel' : profile.role === 'shop_verified' ? 'Shop Dashboard' : 'My Profile'}
                      </span>
                    </Link>

                    <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition" title="Log Out">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 3. MOBILE CONTROLS (Visible only on small screens) */}
            <div className="flex items-center gap-2 md:hidden">
              
              {/* 🚨 NEW: Mobile Quick Links (Inbox & Shops) */}
              {!isAuthLoading && profile && profile.role !== 'guest' && (
                <div className="flex items-center gap-4 mr-1 pr-3 border-r border-gray-200">
                  {/* Mobile Shops Link */}
                  <Link href="/shops" className="text-gray-500 hover:text-gray-900 transition flex items-center" title="Shops Directory">
                    <span className="text-[22px]">🏢</span>
                  </Link>

                  {/* Mobile Inbox Link */}
                  <Link href="/chat" className={`relative flex items-center transition-colors ${isInboxActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'}`} title="Inbox">
                    <svg className="w-[26px] h-[26px]" fill={isInboxActive ? "currentColor" : "none"} viewBox="0 0 24 24" stroke={isInboxActive ? "none" : "currentColor"}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    {unreadCount > 0 && (
                      <span className="absolute top-0 right-0 -mr-1.5 -mt-1.5 w-[18px] h-[18px] bg-red-600 text-white text-[9px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-sm z-10 animate-pulse">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Link>
                </div>
              )}

              {/* Hamburger Toggle */}
              <button 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-1 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none transition"
              >
                {isMobileMenuOpen ? (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                ) : (
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                )}
              </button>
            </div>
            
          </div>
        </div>

        {/* 4. MOBILE DROPDOWN MENU */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 shadow-lg absolute w-full animate-fade-in-up pb-6 px-4 pt-2">
            
            {isAuthLoading ? (
               <div className="flex justify-center py-4">
                 <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin"></div>
               </div>
            ) : !profile ? (
              <Link href="/login" onClick={closeMenu} className="block text-center px-4 py-3 bg-gray-900 text-white rounded-xl text-base font-bold shadow-sm">
                Log In
              </Link>
            ) : profile.role === 'guest' ? (
              <div className="flex flex-col gap-2 mt-2">
                <span className="inline-block self-start px-3 py-1 mb-2 bg-yellow-100 text-yellow-800 text-xs font-bold rounded-full border border-yellow-200">
                  Role: Guest
                </span>
                <Link href="/guest" onClick={closeMenu} className="block px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">Dashboard</Link>
                <Link href="/support" onClick={closeMenu} className="block px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">🎧 Support</Link>
                <button onClick={() => { setIsVerifyModalOpen(true); closeMenu(); }} className="w-full text-left px-4 py-3 bg-blue-600 text-white rounded-xl text-base font-bold shadow-sm">Verify ID</button>
                <button onClick={handleLogout} className="w-full text-left px-4 py-3 mt-4 bg-red-50 text-red-600 rounded-xl text-base font-bold">Log out</button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 mt-2">
                
                {/* Notice I kept Inbox and Shops in the dropdown too, it helps reinforce navigation! */}
                <Link href="/chat" onClick={closeMenu} className="flex justify-between items-center px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">
                  Inbox
                  {unreadCount > 0 && (
                    <span className="bg-red-600 text-white text-xs font-black px-2 py-1 rounded-full">{unreadCount} New</span>
                  )}
                </Link>
                
                <Link href="/shops" onClick={closeMenu} className="block px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">🏢 Shops Directory</Link>
                <Link href="/support" onClick={closeMenu} className="block px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">🎧 Support</Link>
                <Link href="/create-product" onClick={closeMenu} className="block px-4 py-3 bg-blue-600 text-white rounded-xl text-base font-bold text-center shadow-sm">+ Post New Item</Link>
                
                <Link 
                  href={profile.role === 'admin' ? '/admin' : profile.role === 'shop_verified' ? '/shops/dashboard' : '/profile'} 
                  onClick={closeMenu} 
                  className="block px-4 py-3 mt-4 border border-gray-200 rounded-xl text-base font-bold text-gray-900 text-center"
                >
                  {profile.role === 'admin' ? 'Admin Panel' : profile.role === 'shop_verified' ? 'Shop Dashboard' : 'My Profile'}
                </Link>

                <button onClick={handleLogout} className="w-full text-left px-4 py-3 mt-4 bg-red-50 text-red-600 rounded-xl text-base font-bold text-center">Log Out</button>
              </div>
            )}
          </div>
        )}
      </nav>

      {/* THE VERIFICATION MODAL */}
      {isVerifyModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative">
            <button 
              onClick={() => setIsVerifyModalOpen(false)} 
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h3 className="text-2xl font-black text-gray-900 mb-2">Verify Your Account</h3>
            <p className="text-gray-500 mb-6 text-sm">Choose your account type to get full access to the SRM Marketplace.</p>

            <div className="space-y-4">
              <button 
                onClick={() => { setIsVerifyModalOpen(false); router.push('/verify-student'); }} 
                className="w-full p-4 border-2 border-gray-100 hover:border-blue-600 rounded-2xl flex items-center gap-4 transition-all group text-left bg-gray-50 hover:bg-white shadow-sm"
              >
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors text-xl">🎓</div>
                <div>
                  <h4 className="font-bold text-gray-900 group-hover:text-blue-700 transition-colors">I am a Student</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Automated verify with your .edu.in email</p>
                </div>
              </button>

              <button 
                onClick={() => { setIsVerifyModalOpen(false); router.push('/shops/register'); }} 
                className="w-full p-4 border-2 border-gray-100 hover:border-green-600 rounded-2xl flex items-center gap-4 transition-all group text-left bg-gray-50 hover:bg-white shadow-sm"
              >
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors text-xl">🏪</div>
                <div>
                  <h4 className="font-bold text-gray-900 group-hover:text-green-700 transition-colors">I am a Campus Shop</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Submit business details for Admin review</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}