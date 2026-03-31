'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { sendStudentOtp, verifyStudentOtp } from '@/lib/api';

export default function VerifyStudentPage() {
  const router = useRouter();
  const { profile, setProfile } = useAuth();
  
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic frontend validation for SRM email
    if (!email.endsWith('@srmist.edu.in')) {
      setError('Please use a valid @srmist.edu.in email address.');
      return;
    }

    try {
      setIsLoading(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Authentication lost. Please log in again.');

      await sendStudentOtp(token, email);
      setStep(2); // Move to OTP step
    } catch (err: any) {
      setError(err.message || 'Could not send OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (otp.length < 4) {
      setError('Please enter a valid OTP.');
      return;
    }

    try {
      setIsLoading(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Authentication lost. Please log in again.');

      // Call the verification endpoint
      await verifyStudentOtp(token, email, otp);

      // Upgrade the local context state immediately
      if (profile) {
        setProfile({ ...profile, role: 'student' });
      }

      // Success! Route them to the live marketplace feed
      router.push('/');
      
    } catch (err: any) {
      setError(err.message || 'Invalid OTP. Please check and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Student Verification</h2>
          <p className="text-sm text-gray-500 mt-2">
            {step === 1 
              ? "Link your SRM email to unlock buying and selling."
              : `We sent a code to ${email}`}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-50 text-red-600 text-sm text-center">
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleSendOtp} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                SRM Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                placeholder="ab1234@srmist.edu.in"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                value={email}
                onChange={(e) => setEmail(e.target.value.toLowerCase())}
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !email}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Sending...' : 'Send Verification Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <div>
              <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">
                Enter OTP
              </label>
              <input
                id="otp"
                type="text"
                required
                maxLength={6}
                placeholder="123456"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-center tracking-widest text-lg font-semibold"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} // Only allow numbers
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || otp.length < 4}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Verifying...' : 'Verify & Continue'}
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="w-full text-sm text-gray-500 hover:text-gray-800 mt-4"
              disabled={isLoading}
            >
              Change email address
            </button>
          </form>
        )}
      </div>
    </div>
  );
}