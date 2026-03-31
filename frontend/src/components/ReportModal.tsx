'use client';

import React, { useState } from 'react';
import { auth } from '@/lib/firebase';
import { reportListing, reportShopItem } from '@/lib/api'; // 🚨 IMPORTED BOTH
import toast from 'react-hot-toast';

interface ReportModalProps {
  listingId: string;
  listingTitle: string;
  shopId?: string; // 🚨 Optional shopId added
  onClose: () => void;
}

export default function ReportModal({ listingId, listingTitle, shopId, onClose }: ReportModalProps) {
  const [reason, setReason] = useState('suspicious');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        toast.error("You must be logged in to report.");
        return;
      }

      // 🚨 THE SMART LOGIC: Choose the right API
      if (shopId) {
        await reportShopItem(token, shopId, listingId, reason, details);
      } else {
        await reportListing(token, listingId, reason, details);
      }
      
      toast.success("Report submitted. Our team is reviewing it.", { icon: '🚩' });
      onClose();
    } catch (error: any) {
      toast.error(error.message || "Failed to submit report.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative">
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <h3 className="text-2xl font-black text-gray-900 mb-1 flex items-center gap-2">
          <span className="text-red-500">🚩</span> Report {shopId ? 'Shop Item' : 'Listing'}
        </h3>
        <p className="text-gray-500 mb-6 text-sm font-medium line-clamp-1">"{listingTitle}"</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Reason for reporting</label>
            <select 
              value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-medium text-gray-700 focus:ring-2 focus:ring-red-500"
            >
              <option value="suspicious">Looks like a scam / suspicious</option>
              <option value="inappropriate">Inappropriate or offensive content</option>
              <option value="fake">Fake item or misleading description</option>
              <option value="spam">Spam or duplicate listing</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Additional Details (Optional)</label>
            <textarea 
              rows={3} placeholder="Please provide any extra context..."
              value={details} onChange={(e) => setDetails(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm focus:ring-2 focus:ring-red-500"
            />
          </div>

          <button 
            type="submit" disabled={isSubmitting}
            className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </form>
      </div>
    </div>
  );
}