'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface GuestBlockerModalProps {
  onClose: () => void;
}

export default function GuestBlockerModal({ onClose }: GuestBlockerModalProps) {
  const router = useRouter();

  // Production Standard: Prevent background scrolling when modal is active
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden relative">
        
        {/* Header */}
        <div className="p-6 text-center border-b border-gray-100">
          <h2 className="text-2xl font-bold text-gray-900">Join the Community</h2>
          <p className="text-sm text-gray-500 mt-2">
            You need to verify your account to post, chat, or buy on campus.
          </p>
        </div>

        {/* Options */}
        <div className="p-6 space-y-4">
          <button 
            onClick={() => {
              onClose();
              router.push('/verify-student');
            }}
            className="w-full flex items-center justify-between p-4 border-2 border-blue-100 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all text-left group"
          >
            <div>
              <h3 className="font-semibold text-gray-900 group-hover:text-blue-700">I am a Student</h3>
              <p className="text-xs text-gray-500 mt-1">Verify with your SRM email address</p>
            </div>
            <span className="text-blue-500 text-xl group-hover:translate-x-1 transition-transform">→</span>
          </button>

          <button 
             onClick={() => {
              onClose();
              router.push('/shop-application');
            }}
            className="w-full flex items-center justify-between p-4 border-2 border-purple-100 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all text-left group"
          >
            <div>
              <h3 className="font-semibold text-gray-900 group-hover:text-purple-700">I am a Campus Shop</h3>
              <p className="text-xs text-gray-500 mt-1">Apply to sell goods and services</p>
            </div>
            <span className="text-purple-500 text-xl group-hover:translate-x-1 transition-transform">→</span>
          </button>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 text-center">
          <button 
            onClick={onClose}
            className="text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
          >
            Maybe later, just browsing
          </button>
        </div>
      </div>
    </div>
  );
}