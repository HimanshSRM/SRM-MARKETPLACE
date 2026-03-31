'use client';

import React, { useState } from 'react';
import { auth } from '@/lib/firebase';
import { updateMyListing } from '@/lib/api';
import toast from 'react-hot-toast';

interface EditListingModalProps {
  listing: any;
  onClose: () => void;
  onSuccess: (updatedListing: any) => void;
}

export default function EditListingModal({ listing, onClose, onSuccess }: EditListingModalProps) {
  const [title, setTitle] = useState(listing.title || '');
  const [price, setPrice] = useState(listing.price || '');
  const [description, setDescription] = useState(listing.description || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const updatedData = {
        title,
        price: parseFloat(price),
        description,
      };

      await updateMyListing(token, listing.id, updatedData);
      
      toast.success("Listing updated successfully!");
      // Merge the new data with the old listing so the UI updates instantly
      onSuccess({ ...listing, ...updatedData, status: 'active' }); 
      onClose();
    } catch (error: any) {
      toast.error(error.message || "Failed to update listing.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-900 rounded-full transition">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <h3 className="text-2xl font-black text-gray-900 mb-6 flex items-center gap-2">
          ✏️ Edit Listing
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Title</label>
            <input 
              required type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Price (₹)</label>
            <input 
              required type="number" value={price} onChange={(e) => setPrice(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Description</label>
            <textarea 
              required rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-sm disabled:opacity-50">
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}