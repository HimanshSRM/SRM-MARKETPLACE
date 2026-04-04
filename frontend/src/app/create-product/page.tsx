'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth } from '@/lib/firebase';
import { createProduct, CreateProductPayload } from '@/lib/api';

const CATEGORY_MAP = {
  product: [
    { id: 'books', label: 'Books & Notes' },
    { id: 'electronics', label: 'Electronics' },
    { id: 'clothing', label: 'Clothing & Accessories' },
    { id: 'furniture', label: 'Furniture & Dorm' },
    { id: 'other', label: 'Other Product' }
  ],
  service: [
    { id: 'tutoring', label: 'Tutoring & Academic Help' },
    { id: 'tech', label: 'Tech & Freelance' },
    { id: 'labor', label: 'Moving & Errands' },
    { id: 'beauty', label: 'Beauty & Haircut' },
    { id: 'other', label: 'Other Service' }
  ],
  request: [
    { id: 'item_needed', label: 'Looking for an Item' },
    { id: 'service_needed', label: 'Looking for a Service' },
    { id: 'roommate', label: 'Roommate / Housing' },
    { id: 'other', label: 'Other Request' }
  ]
};

type ListingType = keyof typeof CATEGORY_MAP;

export default function CreateProductPage() {
  const router = useRouter();
  const { profile, isLoading: isAuthLoading } = useAuth();
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    type: 'product' as ListingType,
    category: 'books', 
  });

  // Redirect guests instantly
  useEffect(() => {
    if (profile?.role === 'guest') {
      router.replace('/'); 
    }
  }, [profile, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'type') {
      const newType = value as ListingType;
      setFormData({
        ...formData,
        type: newType,
        category: CATEGORY_MAP[newType][0].id
      });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Authentication lost. Please log in again.");

      const payload: CreateProductPayload = {
        title: formData.title,
        description: formData.description,
        price: parseFloat(formData.price),
        type: formData.type,         
        category: formData.category, 
      };

      await createProduct(token, payload);
      router.push('/'); 
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to post item. Please try again.");
      setIsSubmitting(false);
    }
  };

  // 🚨 1. Wait for Firebase to check the browser memory
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  // 🚨 2. Now it is safe to check if they are a guest or logged out
  if (!profile || profile.role === 'guest') {
    return null; 
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Post a Listing</h1>
            <p className="text-gray-500 mt-2">Sell an item, offer a service, or request something on campus.</p>
          </div>
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-900 font-medium">
            Cancel
          </button>
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
          {error && <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-6">
            
            <div>
              <label htmlFor="title" className="block text-sm font-semibold text-gray-900 mb-2">
                {formData.type === 'product' ? 'What are you selling?' : formData.type === 'service' ? 'What service are you offering?' : 'What are you looking for?'}
              </label>
              <input type="text" id="title" name="title" required placeholder={formData.type === 'product' ? "e.g., Used Engineering Textbook" : "e.g., Math Tutoring for Freshmen"} className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" value={formData.title} onChange={handleChange} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="type" className="block text-sm font-semibold text-gray-900 mb-2">Listing Type</label>
                <select id="type" name="type" required className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white" value={formData.type} onChange={handleChange}>
                  <option value="product">Physical Product</option>
                  <option value="service">Service (e.g., Tutoring)</option>
                  <option value="request">Looking to Buy</option>
                </select>
              </div>

              <div>
                <label htmlFor="category" className="block text-sm font-semibold text-gray-900 mb-2">Category</label>
                <select id="category" name="category" required className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white" value={formData.category} onChange={handleChange}>
                  {CATEGORY_MAP[formData.type].map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="price" className="block text-sm font-semibold text-gray-900 mb-2">
                {formData.type === 'request' ? 'Budget (₹)' : 'Price (₹)'}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">₹</span>
                <input type="number" id="price" name="price" required min="0" step="1" placeholder="0" className="w-full pl-8 pr-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" value={formData.price} onChange={handleChange} />
              </div>
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-semibold text-gray-900 mb-2">Description</label>
              <textarea id="description" name="description" required rows={4} placeholder="Describe the details, condition, and any other relevant info..." className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none" value={formData.description} onChange={handleChange} />
            </div>

            <div className="pt-4">
              <button type="submit" disabled={isSubmitting} className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold rounded-xl disabled:opacity-50 transition-colors shadow-sm">
                {isSubmitting ? 'Posting...' : 'Post to Live Feed'}
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  );
}