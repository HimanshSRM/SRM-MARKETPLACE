'use client';

import React, { useState, useEffect } from 'react';
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
  
  // --- 🚨 NEW: APP SETTINGS STATE ---
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission>('default');

  // --- DEVICE & PWA DETECTION LOGIC ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 1. Check if iOS
      const iosRegex = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      setIsIOS(iosRegex);

      // 2. Check if already installed (Standalone mode)
      const checkIsInstalled = () => {
        if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
          setIsInstalled(true);
        }
      };
      checkIsInstalled();

      // 3. Catch the native install prompt (Android/Chrome only)
      const handleBeforeInstallPrompt = (e: any) => {
        e.preventDefault();
        setInstallPromptEvent(e);
      };
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

      // 4. Check current notification permission
      if ('Notification' in window) {
        setNotificationStatus(Notification.permission);
      }

      return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }
  }, []);

  // --- HANDLERS ---
  const handleToggleNotifications = async () => {
    if (!('Notification' in window)) {
      alert("This browser does not support desktop notifications.");
      return;
    }

    // iOS Strict Rule: Must be installed as PWA first
    if (isIOS && !isInstalled) {
      alert("Apple requires you to Install the app to your Home Screen before enabling notifications. Please follow the install instructions below first!");
      return;
    }

    if (notificationStatus === 'granted') {
      alert("Notifications are active! To turn them off, click the lock icon next to your URL bar and change site settings.");
    } else {
      const permission = await Notification.requestPermission();
      setNotificationStatus(permission);
      if (permission === 'granted') alert("Notifications Enabled! 🎉");
    }
  };

  const handleInstallClick = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    if (outcome === 'accepted') {
      setInstallPromptEvent(null);
      setIsInstalled(true);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsMobileMenuOpen(false); 
      router.push('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  if (pathname === '/login') return null;
  const isInboxActive = pathname?.startsWith('/chat') || false;
  const closeMenu = () => setIsMobileMenuOpen(false);
  const isAuthLoading = profile === undefined;

  return (
    <>
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        
        {/* BANNED USER WARNING BANNER */}
        {profile?.role === 'banned' && (
          <div className="bg-red-600 text-white text-center py-2 px-4 text-xs sm:text-sm font-bold shadow-inner">
            ⚠️ Your account has been suspended. You are in read-only mode and cannot post, message, or buy items.
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 sm:px-8">
          <div className="flex justify-between items-center h-16">
            
            {/* 1. Brand / Logo */}
            <Link href="/" onClick={closeMenu} className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-xl">S</div>
              <span className="font-bold text-xl tracking-tight text-gray-900 hidden sm:block">SRM Market</span>
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
                  <span className="items-center px-3 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold rounded-full border border-yellow-200">Role: Guest</span>
                  <Link href="/guest" className="px-4 py-2 bg-gray-100 text-gray-900 text-sm font-bold rounded-xl hover:bg-gray-200 transition shadow-sm">Dashboard</Link>
                  <button onClick={() => setIsVerifyModalOpen(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition shadow-sm">Verify ID</button>
                  <button onClick={handleLogout} className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition">Log out</button>
                </>
              ) : (
                <>
                  {/* INBOX BUTTON & RED DOT */}
                  <Link href="/chat" className={`relative p-2 flex items-center justify-center rounded-full transition-all group ${isInboxActive ? 'bg-blue-50' : 'hover:bg-gray-100'}`} title="Inbox">
                    <svg className={`w-6 h-6 transition-colors ${isInboxActive ? 'text-blue-600' : 'text-gray-600 group-hover:text-blue-600'}`} fill={isInboxActive ? "currentColor" : "none"} viewBox="0 0 24 24" stroke={isInboxActive ? "none" : "currentColor"}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    {unreadCount > 0 && (
                      <span className="absolute top-0 right-0 -mr-1 -mt-1 w-5 h-5 bg-red-600 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-md z-10 animate-pulse">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </Link>

                  <Link href="/shops" className="px-3 py-2 text-sm font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">🏢 Shops</Link>
                  <Link href="/create-product" className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition shadow-sm">+ Post</Link>

                  {/* PROFILE GROUP WITH NEW SETTINGS BUTTON */}
                  <div className="flex items-center gap-2 border-l border-gray-200 pl-4 ml-2">
                    
                    {/* 🚨 NEW: App Settings Button */}
                    <button 
                      onClick={() => setIsSettingsModalOpen(true)}
                      className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition" 
                      title="App Settings"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </button>

                    <Link 
                      href={profile.role === 'admin' ? '/admin' : profile.role === 'shop_verified' ? '/shops/dashboard' : '/profile'} 
                      className="flex items-center gap-2 px-2 py-1 pr-4 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 rounded-full transition shadow-sm group"
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

            {/* 3. MOBILE CONTROLS */}
            <div className="flex items-center gap-2 md:hidden">
              {!isAuthLoading && profile && profile.role !== 'guest' && (
                <div className="flex items-center gap-4 mr-1 pr-3 border-r border-gray-200">
                  <Link href="/shops" className="text-gray-500 hover:text-gray-900 transition flex items-center"><span className="text-[22px]">🏢</span></Link>
                  <Link href="/chat" className={`relative flex items-center transition-colors ${isInboxActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}>
                    <svg className="w-[26px] h-[26px]" fill={isInboxActive ? "currentColor" : "none"} viewBox="0 0 24 24" stroke={isInboxActive ? "none" : "currentColor"}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                    {unreadCount > 0 && <span className="absolute top-0 right-0 -mr-1.5 -mt-1.5 w-[18px] h-[18px] bg-red-600 text-white text-[9px] font-black flex items-center justify-center rounded-full border-2 border-white shadow-sm z-10 animate-pulse">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                  </Link>
                </div>
              )}
              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-1 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition">
                {isMobileMenuOpen ? <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg> : <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>}
              </button>
            </div>
          </div>
        </div>

        {/* 4. MOBILE DROPDOWN MENU */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 shadow-lg absolute w-full animate-fade-in-up pb-6 px-4 pt-2">
            {isAuthLoading ? (
               <div className="flex justify-center py-4"><div className="w-6 h-6 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin"></div></div>
            ) : !profile ? (
              <Link href="/login" onClick={closeMenu} className="block text-center px-4 py-3 bg-gray-900 text-white rounded-xl text-base font-bold shadow-sm">Log In</Link>
            ) : profile.role === 'guest' ? (
              <div className="flex flex-col gap-2 mt-2">
                <span className="inline-block self-start px-3 py-1 mb-2 bg-yellow-100 text-yellow-800 text-xs font-bold rounded-full border border-yellow-200">Role: Guest</span>
                <Link href="/guest" onClick={closeMenu} className="block px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">Dashboard</Link>
                <Link href="/support" onClick={closeMenu} className="block px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">🎧 Support</Link>
                <button onClick={() => { setIsVerifyModalOpen(true); closeMenu(); }} className="w-full text-left px-4 py-3 bg-blue-600 text-white rounded-xl text-base font-bold shadow-sm">Verify ID</button>
                <button onClick={handleLogout} className="w-full text-left px-4 py-3 mt-4 bg-red-50 text-red-600 rounded-xl text-base font-bold">Log out</button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 mt-2">
                <Link href="/chat" onClick={closeMenu} className="flex justify-between items-center px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">
                  Inbox {unreadCount > 0 && <span className="bg-red-600 text-white text-xs font-black px-2 py-1 rounded-full">{unreadCount} New</span>}
                </Link>
                <Link href="/shops" onClick={closeMenu} className="block px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">🏢 Shops Directory</Link>
                <Link href="/support" onClick={closeMenu} className="block px-4 py-3 bg-gray-50 rounded-xl text-base font-bold text-gray-900">🎧 Support</Link>
                <Link href="/create-product" onClick={closeMenu} className="block px-4 py-3 bg-blue-600 text-white rounded-xl text-base font-bold text-center shadow-sm">+ Post New Item</Link>
                
                {/* 🚨 NEW: Mobile Settings Button */}
                <button onClick={() => { setIsSettingsModalOpen(true); closeMenu(); }} className="w-full text-left px-4 py-3 mt-2 flex items-center gap-3 bg-gray-50 hover:bg-gray-100 rounded-xl text-base font-bold text-gray-900 transition">
                  <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  App Settings
                </button>

                <Link href={profile.role === 'admin' ? '/admin' : profile.role === 'shop_verified' ? '/shops/dashboard' : '/profile'} onClick={closeMenu} className="block px-4 py-3 mt-2 border border-gray-200 rounded-xl text-base font-bold text-gray-900 text-center">
                  {profile.role === 'admin' ? 'Admin Panel' : profile.role === 'shop_verified' ? 'Shop Dashboard' : 'My Profile'}
                </Link>
                <button onClick={handleLogout} className="w-full text-left px-4 py-3 mt-4 bg-red-50 text-red-600 rounded-xl text-base font-bold text-center">Log Out</button>
              </div>
            )}
          </div>
        )}
      </nav>

      {/* ==========================================
          🚨 NEW: APP SETTINGS MODAL 
          ========================================== */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl relative animate-fade-in-up">
            <button onClick={() => setIsSettingsModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <h3 className="text-xl font-black text-gray-900 mb-6 flex items-center gap-2">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              App Settings
            </h3>

            <div className="space-y-6">
              
              {/* NOTIFICATION TOGGLE */}
              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <p className="font-bold text-gray-900 text-sm">Push Notifications</p>
                  <p className="text-xs text-gray-500 mt-0.5">Get alerts for messages & flash deals.</p>
                </div>
                <button onClick={handleToggleNotifications} className={`relative h-7 w-12 rounded-full transition-colors shrink-0 ${notificationStatus === 'granted' ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-1 inline-block h-5 w-5 rounded-full bg-white transition-transform shadow-sm ${notificationStatus === 'granted' ? 'translate-x-6 left-0' : 'translate-x-1 left-0'}`} />
                </button>
              </div>

              {/* DYNAMIC APP INSTALL SECTION */}
              <div className="pt-4 border-t border-gray-100">
                {isInstalled ? (
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-100">
                    <span className="text-xl">✅</span>
                    <div>
                      <p className="text-sm font-bold text-green-800">App is Installed</p>
                      <p className="text-xs text-green-600 font-medium">Running in optimal mode.</p>
                    </div>
                  </div>
                ) : isIOS ? (
                  // iOS Safari Specific Instructions
                  <div className="p-4 bg-orange-50 rounded-2xl border border-orange-100">
                    <p className="text-xs font-black text-orange-600 uppercase tracking-widest mb-2 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      iOS / iPhone Guide
                    </p>
                    <p className="text-sm text-orange-800 font-medium leading-relaxed">
                      To install this app and enable notifications, tap the <strong className="font-black text-orange-900 bg-orange-100 px-1 rounded">Share 📤</strong> button at the bottom of your screen, then scroll down and select <strong className="font-black text-orange-900 bg-orange-100 px-1 rounded">Add to Home Screen ➕</strong>.
                    </p>
                  </div>
                ) : installPromptEvent ? (
                  // Android / Chrome Auto-Prompt
                  <button onClick={handleInstallClick} className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 text-white hover:bg-black font-bold text-sm rounded-xl transition shadow-md">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Install App to Home Screen
                  </button>
                ) : (
                  // Fallback if browser blocks it but isn't iOS
                  <p className="text-xs text-gray-500 text-center font-medium">Your browser currently does not support automatic installation.</p>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* THE VERIFICATION MODAL */}
      {isVerifyModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative">
            <button onClick={() => setIsVerifyModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h3 className="text-2xl font-black text-gray-900 mb-2">Verify Your Account</h3>
            <p className="text-gray-500 mb-6 text-sm">Choose your account type to get full access to the SRM Marketplace.</p>

            <div className="space-y-4">
              <button onClick={() => { setIsVerifyModalOpen(false); router.push('/verify-student'); }} className="w-full p-4 border-2 border-gray-100 hover:border-blue-600 rounded-2xl flex items-center gap-4 transition-all group text-left bg-gray-50 hover:bg-white shadow-sm">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors text-xl">🎓</div>
                <div>
                  <h4 className="font-bold text-gray-900 group-hover:text-blue-700 transition-colors">I am a Student</h4>
                  <p className="text-xs text-gray-500 mt-0.5">Automated verify with your .edu.in email</p>
                </div>
              </button>

              <button onClick={() => { setIsVerifyModalOpen(false); router.push('/shops/register'); }} className="w-full p-4 border-2 border-gray-100 hover:border-green-600 rounded-2xl flex items-center gap-4 transition-all group text-left bg-gray-50 hover:bg-white shadow-sm">
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