'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/firebase'; // 🚨 Required to get the token dynamically

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000' || 'http://localhost:8000';

/**
 * 🚨 THE TIMEBOMB DEFUSER
 * This wrapper automatically handles expired tokens by intercepting 401 errors,
 * forcing a silent token refresh, and retrying the request instantly.
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}) {
  // 1. Get the current token 
  let token = await auth.currentUser?.getIdToken();

  if (!token) {
    throw new Error("Not authenticated. Please log in.");
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers,
  };

  // 2. Make the initial request
  let response = await fetch(url, { ...options, headers });

  // 3. CAUGHT THE TIMEBOMB: The backend rejected our token!
  if (response.status === 401) {
    console.warn("⏳ Token expired! Forcing a background refresh...");
    
    // Force Firebase to generate a brand new token
    token = await auth.currentUser?.getIdToken(true);
    
    // Retry the exact same request with the fresh token
    const retryHeaders = {
      ...headers,
      'Authorization': `Bearer ${token}`,
    };
    
    response = await fetch(url, { ...options, headers: retryHeaders });
  }

  return response;
}

export interface SyncResponse {
  profile: {
    uid: string;
    role: 'guest' | 'student' | 'shop' | 'admin' | 'shop_verified' | 'banned';
    email: string;
    name?: string;
    status?: string;
  };
  next_step: 'dashboard' | 'verify_srm_email' | 'apply_for_shop' | 'shop_pending_approval';
}

export async function syncUserWithBackend(
  selectedRole: 'guest' | 'student' | 'shop' = 'guest'
): Promise<SyncResponse> { 
  try {
    const response = await authenticatedFetch(`${API_URL}/api/users/sync`, {
      method: 'POST',
      body: JSON.stringify({ selected_role: selectedRole }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error("FastAPI Sync Error:", errorData);
      throw new Error((errorData && errorData.detail) || 'Failed to sync user with backend');
    }

    return await response.json(); 
  } catch (error) {
    console.error('Backend Sync Network Error:', error);
    throw error;
  }
}

export async function sendStudentOtp(email: string) {
  try {
    const response = await authenticatedFetch(`${API_URL}/api/users/send-otp`, {
      method: 'POST',
      body: JSON.stringify({ srm_email: email }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Failed to send OTP');
    }

    return await response.json();
  } catch (error) {
    console.error('Send OTP Error:', error);
    throw error;
  }
}

export async function verifyStudentOtp(email: string, otpCode: string) {
  try {
    const response = await authenticatedFetch(`${API_URL}/api/users/verify-otp`, {
      method: 'POST',
      body: JSON.stringify({ srm_email: email, otp_code: otpCode }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Invalid OTP');
    }

    return await response.json(); 
  } catch (error) {
    console.error('Verify OTP Error:', error);
    throw error;
  }
}

// ==========================================
// PRODUCTS API
// ==========================================

export interface Product {
  id: string | number;
  title: string;
  description: string;
  price: number;
  type?: string;      
  category?: string;  
  image_url?: string;
  seller_id: string;
  seller_name?: string;
  created_at: string;
}

export interface PaginatedProducts {
  data: Product[];
  next_cursor: string | null;
  count: number;
}

export async function getLiveProducts(
  limit: number = 15, 
  cursor: string = '', 
  category: string = ''
): Promise<PaginatedProducts> {
  try {
    const baseUrl = `${API_URL}/api/products/live`;
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(cursor && { cursor }),
      ...(category && { category }),
    });

    const response = await authenticatedFetch(`${baseUrl}?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store' 
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.detail 
        ? (typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail)) 
        : `Backend error: ${response.status}`;
      throw new Error(errorMessage);
    }

    const rawData = await response.json(); 

    let normalizedData: Product[] = [];
    let nextCursor: string | null = rawData.next_cursor || null;

    if (Array.isArray(rawData)) {
      normalizedData = rawData;
    } else if (rawData && Array.isArray(rawData.data)) {
      normalizedData = rawData.data;
    } else if (rawData && Array.isArray(rawData.items)) {
      normalizedData = rawData.items;
    }

    return {
      data: normalizedData as Product[],
      next_cursor: nextCursor,
      count: rawData.count || normalizedData.length
    };

  } catch (error) {
    console.error('Fetch Products Error:', error);
    throw error;
  }
}

export interface CreateProductPayload {
  title: string;
  description: string;
  price: number;
  type: string;     
  category: string; 
  image_url?: string; 
}

export async function createProduct(productData: CreateProductPayload) {
  try {
    const response = await authenticatedFetch(`${API_URL}/api/products/create`, {
      method: 'POST',
      body: JSON.stringify(productData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        (errorData && typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData?.detail)) || 
        'Failed to create product'
      );
    }

    return await response.json(); 
  } catch (error) {
    console.error('Create Product Error:', error);
    throw error;
  }
}

// ==========================================
// REQUESTS (ISO) API
// ==========================================

export async function fetchLiveRequests(category: string = '', cursor: string = '') {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (cursor) params.append('cursor', cursor);

  const queryString = params.toString() ? `?${params.toString()}` : '';
  
  const response = await authenticatedFetch(`${API_URL}/api/requests/live${queryString}`, { 
    method: 'GET',
    cache: 'no-store' 
  });
  
  if (!response.ok) throw new Error('Failed to fetch requests feed');
  return response.json();
}

export async function createRequest(requestData: any) {
  const response = await authenticatedFetch(`${API_URL}/api/requests/create`, {
    method: 'POST',
    body: JSON.stringify({ ...requestData, type: 'request' }),
  });
  
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    
    // 🚨 THE TRANSLATOR: Unpacks FastAPI array errors into readable text
    let errorMsg = data?.detail;
    if (Array.isArray(data?.detail)) {
      errorMsg = data.detail.map((e: any) => `${e.loc[e.loc.length-1]}: ${e.msg}`).join(', ');
    }
    
    throw new Error(errorMsg || 'Failed to post request');
  }
  return response.json();
}

// ==========================================
// CHAT & BIDDING API
// ==========================================

export interface ChatRoom {
  id: string | number;
  product_id: string | number;
  buyer_id: string;
  seller_id: string;
  [key: string]: any; 
}

export interface ChatMessage {
  id: string | number;
  sender_id: string;
  text : string;
  is_bid: boolean;
  bid_amount?: number;
  status?: string; 
  created_at: string;
  timestamp?: string;
  bid_status?: string;
}

export interface InboxData {
  pools: never[];
  buying: any[];
  selling: any[];
  support: any[];
}

export async function initiateChat(
  listingId: string | number,
  ownerId: string,
  initialMessage: string
): Promise<ChatRoom> {
  const response = await authenticatedFetch(`${API_URL}/api/chat/initiate`, {
    method: 'POST',
    body: JSON.stringify({ 
      listing_id: listingId,            
      owner_id: ownerId,            
      initial_message: initialMessage,
      // 🚨 THE FIREWALL FIX: Explicitly tell the backend NOT to return support tickets
      is_ticket: false 
    }), 
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      (errorData && errorData.detail) ? JSON.stringify(errorData.detail) : 'Failed to initiate chat'
    );
  }
  return await response.json();
}

export async function getInbox(): Promise<InboxData> {
  const response = await authenticatedFetch(`${API_URL}/api/chat/inbox`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Failed to load inbox');

  const data = await response.json();
  return {
    buying: data.buying || [],
    selling: data.selling || [],
    support: data.support || [],
    pools: data.pools || []
  };
}

export async function sendMessage(
  roomId: string | number, 
  senderId: string,       
  text: string,           
  isBid: boolean = false, 
  bidAmount?: number
): Promise<ChatMessage> {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ 
      sender_id: senderId, 
      text: text,          
      is_bid: isBid, 
      bid_amount: bidAmount || null 
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      (errorData && errorData.detail) ? JSON.stringify(errorData.detail) : 'Failed to send message'
    );
  }
  return await response.json();
}

export async function acceptBid(roomId: string | number, messageId: string | number) {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/messages/${messageId}/accept`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      (errorData && errorData.detail) 
        ? (typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail)) 
        : 'Failed to accept bid'
    );
  }
  return await response.json();
}

// 🚨 NEW: Revert a collapsed deal (Seller Only)
export const revertDeal = async (roomId: string) => {
  const res = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/revert`, { 
    method: 'POST' 
  });
  if (!res.ok) throw new Error("Failed to revert the deal.");
  return res.json();
};

// 🚨 NEW: Save missing contact info globally & to the chat room
export const saveChatContactInfo = async (
  roomId: string, 
  payload: { phone?: string; upi_id?: string; save_as_default?: boolean }
) => {
  const res = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/contact`, {
    method: 'POST', 
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Failed to save contact info.");
  return res.json();
};

export async function getChatMessages(roomId: string | number): Promise<{ room: any, messages: ChatMessage[] }> {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/messages`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) return { room: null, messages: [] }; 

  const data = await response.json().catch(() => null);
  if (!data) return { room: null, messages: [] };

  let messages: ChatMessage[] = [];
  let room: any = data.room || data; 

  if (data.messages && Array.isArray(data.messages)) messages = data.messages;
  else if (data.data && Array.isArray(data.data)) messages = data.data;
  else if (Array.isArray(data)) messages = data;

  return { room, messages };
}


// ==========================================
// SHOPS API
// ==========================================

export interface CatalogItem {
  id: string;
  title?: string;
  name?: string;
  description: string;
  price: number;
  category?: string;
  image_url?: string;
  in_stock?: boolean;
  is_available?: boolean;
}

export interface Shop {
  id: string;
  owner_id: string;
  owner_email?: string;
  status?: string;
  shop_name?: string; 
  name?: string; 
  description?: string;
  tagline?: string;
  location?: string;
  block?: string;
  contact_number?: string; 
  is_verified: boolean;
  is_open?: boolean;
  live_notice?: { text: string; is_active: boolean };
  catalog?: CatalogItem[];
  created_at: string;
}

// 1. Get All Verified Shops (Public)
export async function getLiveShops(): Promise<Shop[]> {
  const response = await authenticatedFetch(`${API_URL}/api/shops/live`, {
    method: 'GET',
    cache: 'no-store', 
  });

  if (!response.ok) throw new Error('Failed to load shops');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

// 2. Get a Specific Shop's Catalog (Public)
export async function getShopCatalog(shopId: string): Promise<CatalogItem[]> {
  const response = await authenticatedFetch(`${API_URL}/api/shops/${shopId}`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Failed to load catalog');
  const data = await response.json();
  return data.data?.catalog || [];
}

// 3. Create Shop Profile
export async function createShopProfile(shopData: any, overwrite: boolean = false) {
  const response = await authenticatedFetch(`${API_URL}/api/shops/create?overwrite=${overwrite}`, {
    method: 'POST',
    body: JSON.stringify(shopData)
  });

  const data = await response.json();
  
  if (!response.ok) {
    let errorMsg = data.detail;
    if (Array.isArray(data.detail)) {
      errorMsg = data.detail.map((e: any) => `${e.loc[e.loc.length-1]}: ${e.msg}`).join(', ');
    }
    throw new Error(errorMsg || "Failed to create shop");
  }
  return data; 
}

// 4. Update Shop Profile
export async function updateShopProfile(shopId: string, updateData: any) {
  const response = await authenticatedFetch(`${API_URL}/api/shops/${shopId}/profile`, {
    method: 'PUT',
    body: JSON.stringify(updateData)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to update shop profile");
  }
  return await response.json();
}

// 5. Restore Old Shop
export async function restoreShopProfile() {
  const response = await authenticatedFetch(`${API_URL}/api/shops/restore`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    let errorMsg = error.detail;
    if (Array.isArray(error.detail)) {
      errorMsg = error.detail.map((e: any) => `${e.loc[e.loc.length-1]}: ${e.msg}`).join(', ');
    }
    throw new Error(errorMsg || 'Failed to restore shop');
  }
  return await response.json();
}

// 6. Check My Shop Status
export async function checkMyShop() {
  const response = await authenticatedFetch(`${API_URL}/api/shops/me`, {
    method: 'GET',
  });
  if (!response.ok) return { has_shop: false };
  return await response.json();
}

// --- CATALOG MANAGEMENT ---
export async function addCatalogItem(itemData: any): Promise<CatalogItem> {
  const response = await authenticatedFetch(`${API_URL}/api/shops/catalog/add`, {
    method: 'POST',
    body: JSON.stringify(itemData),
  });

  if (!response.ok) throw new Error('Failed to add catalog item');
  return await response.json();
}

export async function updateCatalogItem(itemId: string, payload: any): Promise<CatalogItem> {
  const response = await authenticatedFetch(`${API_URL}/api/shops/catalog/${itemId}`, {
    method: 'PUT', 
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to update catalog item');
  }
  return await response.json();
}

export async function deleteCatalogItem(itemId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_URL}/api/shops/catalog/${itemId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to delete catalog item');
  }
}

// --- ADVANCED SHOP FEATURES ---
export async function updateShopStatus(isOpen: boolean) {
  const response = await authenticatedFetch(`${API_URL}/api/shops/status`, {
    method: 'PUT',
    body: JSON.stringify({ is_open: isOpen })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to update shop status");
  }
  return await response.json();
}

export async function updateShopNotice(text: string, isActive: boolean) {
  const response = await authenticatedFetch(`${API_URL}/api/shops/notice`, {
    method: 'PUT',
    body: JSON.stringify({ text, is_active: isActive })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to update live notice");
  }
  return await response.json();
}

export async function triggerFlashDeal(dealData: { item_name: string, original_price: number, deal_price: number, duration_hours: number }) {
  const response = await authenticatedFetch(`${API_URL}/api/shops/flash-deal`, {
    method: 'POST',
    body: JSON.stringify(dealData)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to trigger flash deal");
  }
  return await response.json();
}

// ==========================================
// ADMIN API
// ==========================================

export async function getPendingShops(): Promise<Shop[]> {
  const response = await authenticatedFetch(`${API_URL}/api/admin/shops/pending`, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load pending shops');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

export async function verifyShop(shopId: string): Promise<any> {
  const response = await authenticatedFetch(`${API_URL}/api/admin/shops/${shopId}/verify`, { method: 'PUT' });
  if (!response.ok) throw new Error('Failed to verify shop');
  return await response.json();
}

export async function rejectShop(shopId: string, reason: string): Promise<any> {
  const response = await authenticatedFetch(`${API_URL}/api/admin/shops/${shopId}/reject`, {
    method: 'PUT', body: JSON.stringify({ reason }), 
  });
  if (!response.ok) throw new Error('Failed to reject shop');
  return await response.json();
}

export async function searchUserByEmail(email: string) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/users/search?email=${encodeURIComponent(email)}`, { method: 'GET' });
  if (!response.ok) throw new Error('User not found');
  return await response.json();
}

export async function setUserRole(uid: string, role: string) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/users/${uid}/role`, {
    method: 'PUT', body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error('Failed to update user role');
  return await response.json();
}

export async function getAllUsers() {
  const response = await authenticatedFetch(`${API_URL}/api/admin/users`, { method: 'GET' });
  if (!response.ok) throw new Error('Failed to load users');
  const data = await response.json();
  return data.data || [];
}

export async function warnUser(targetUid: string, subject: string, message: string) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/warn/${targetUid}`, {
    method: 'POST', body: JSON.stringify({ subject, message }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to send warning');
  }
  return await response.json();
}

export async function moderateUser(
  uid: string, 
  action: 'warn' | 'ban' | 'restore' | 'nuke', 
  reason: string,
  roomId: string
) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/users/${uid}/moderate`, {
    method: 'POST', body: JSON.stringify({ action, reason, room_id: roomId })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to ${action} user`);
  }
  return await response.json();
}

export async function getAdminListings(limit: number = 20, cursor: string = '', status: string = '', reportedOnly: boolean = false) {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (cursor) params.append('cursor', cursor);
  if (status) params.append('status', status);
  if (reportedOnly) params.append('reported_only', 'true');

  const response = await authenticatedFetch(`${API_URL}/api/admin/listings?${params.toString()}`, { method: 'GET' });
  
  if (!response.ok) {
    const errData = await response.json().catch(() => null);
    throw new Error(errData?.detail || 'Failed to fetch admin listings.');
  }
  return await response.json();
}

// ==========================================
// TRUST & SAFETY API
// ==========================================

export async function reportListing(listingId: string, reason: string, details: string = "") {
  const response = await authenticatedFetch(`${API_URL}/api/admin/listings/${listingId}/report`, {
    method: 'POST', body: JSON.stringify({ reason, details }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to submit report');
  }
  return await response.json();
}

export async function moderateListing(
  listingId: string, 
  action: 'warn' | 'hide' | 'delete' | 'restore', 
  reason: string ,
  shopId?: string
) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/listings/${listingId}/moderate`, {
    method: 'POST', body: JSON.stringify({ action, reason , shop_id: shopId }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to execute moderation action');
  }
  return await response.json();
}

export async function reportShopItem(shopId: string, itemId: string, payload: { reason: string; details?: string }) {
  const response = await authenticatedFetch(`${API_URL}/api/shops/${shopId}/catalog/${itemId}/report`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to report shop item");
  }
  return await response.json();
}

// ==========================================
// 🚨 THE FIX: PAGINATED SUPPORT TICKETS 
// ==========================================

export async function createSupportTicket(payload: { subject: string, message?: string, description?: string , reported_uid?: string}) {
  const finalMessage = payload.message || payload.description || "No message provided.";

  if (payload.reported_uid) {
    const response = await authenticatedFetch(`${API_URL}/api/chat/support/ticket`, {
      method: 'POST', 
      body: JSON.stringify({ 
        subject: payload.subject, 
        message: finalMessage, 
        reported_uid: payload.reported_uid 
      })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to submit report');
    }
    return await response.json();
  }

  const response = await authenticatedFetch(`${API_URL}/api/support/create`, {
    method: 'POST', 
    body: JSON.stringify({ 
      subject: payload.subject, 
      description: finalMessage, 
      reference_id: "system_support", 
      reference_type: "general" 
    })
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to create support ticket');
  }
  return await response.json();
}

// 🚨 THE FIX: Added Cursor parameter
export async function getMyTickets(cursor: string = '') {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor);
  const queryString = params.toString() ? `?${params.toString()}` : '';

  const response = await authenticatedFetch(`${API_URL}/api/support/my-tickets${queryString}`, { method: 'GET' });
  if (!response.ok) throw new Error('Failed to load tickets');
  
  // Return raw object so `res.next_cursor` is accessible in the UI
  return await response.json();
}

// 🚨 THE FIX: Added Cursor parameter
export async function getAllSupportTickets(cursor: string = '') {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor);
  const queryString = params.toString() ? `?${params.toString()}` : '';

  const response = await authenticatedFetch(`${API_URL}/api/admin/tickets${queryString}`, { method: 'GET' });
  if (!response.ok) throw new Error("Failed to fetch support tickets");
  
  // Return raw object so `res.next_cursor` is accessible in the UI
  return await response.json(); 
}

export async function replyToTicket(ticketId: string, status: string, admin_response: string) {
  const response = await authenticatedFetch(`${API_URL}/api/support/admin/${ticketId}/reply`, {
    method: 'POST', body: JSON.stringify({ status, admin_response }),
  });
  if (!response.ok) throw new Error('Failed to reply to ticket');
  return await response.json();
}

export async function resolveSupportTicket(ticketId: string | number) {
  const response = await authenticatedFetch(`${API_URL}/api/support/admin/${ticketId}/resolve`, { method: 'PUT' });
  if (!response.ok) throw new Error('Failed to resolve ticket');
  return await response.json();
}

// ==========================================
// DASHBOARDS & UTILS
// ==========================================

export async function getStudentDashboard() {
  const response = await authenticatedFetch(`${API_URL}/api/users/dashboard/student`, { method: 'GET' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to load dashboard');
  }
  return await response.json();
}

export async function getGuestDashboard() {
  const response = await authenticatedFetch(`${API_URL}/api/dashboard/guest`, { method: 'GET' });
  if (!response.ok) throw new Error('Failed to fetch guest dashboard');
  return await response.json();
}

export async function toggleListingVisibility(listingId: string, isActive: boolean) {
  const response = await authenticatedFetch(`${API_URL}/api/products/${listingId}/toggle-visibility`, {
    method: 'PUT',
    body: JSON.stringify({ is_active: isActive })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || "Failed to toggle visibility");
  }
  return await response.json();
}

export async function deleteMyListing(listingId: string) {
  const response = await authenticatedFetch(`${API_URL}/api/products/${listingId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete listing');
  return await response.json();
}

export async function updateMyListing(listingId: string, updateData: any) {
  const response = await authenticatedFetch(`${API_URL}/api/products/${listingId}`, {
    method: 'PUT', body: JSON.stringify(updateData),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to update listing');
  }
  return await response.json();
}

export async function deleteChatMessages(roomId: string | number, messageIds: string[]) {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/messages/bulk-delete`, {
    method: 'POST', body: JSON.stringify({ message_ids: messageIds }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to delete messages');
  }
  return await response.json();
}

export async function hideChatRoom(roomId: string | number) {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/hide`, { method: 'PUT' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to hide chat');
  }
  return await response.json();
}

export async function updateStudentContact(payload: { phone?: string, upi_id?: string }) {
  const response = await authenticatedFetch(`${API_URL}/api/users/profile/contact`, {
    method: 'PUT', body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to update contact settings');
  }
  return await response.json();
}

// ==========================================
// GROUP ORDERS (CART POOLING) APIs
// ==========================================

export const getActiveGroupOrders = async () => {
  const res = await authenticatedFetch(`${API_URL}/api/pools`, { method: 'GET' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to fetch active group orders");
  }
  return res.json(); 
};

// Brand New Paginated Historical Pools Route
export const getPastPools = async (cursor: string = '') => {
  const params = new URLSearchParams();
  if (cursor) params.append('cursor', cursor);
  const queryString = params.toString() ? `?${params.toString()}` : '';

  const res = await authenticatedFetch(`${API_URL}/api/pools/past${queryString}`, { method: 'GET' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to fetch past pools");
  }
  return res.json();
};

export const createGroupOrder = async (orderData: { 
  app_name: string, 
  pickup_location: string, 
  contact_number: string, 
  expires_in_minutes: number, 
  upi_id: string,
  cart_link?: string ,
  special_instructions?: string
}) => {
  const res = await authenticatedFetch(`${API_URL}/api/pools`, {
    method: 'POST', body: JSON.stringify(orderData)
  });
  if (!res.ok) throw new Error("Failed to create group order");
  return res.json();
};

export const joinGroupOrder = async (
  poolId: string, 
  payload: { 
    contact_number: string, 
    block: string, 
    cart_link?: string,
    items: { item_name: string, quantity: number, estimated_price: number }[] 
  }
) => {
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/join`, {
    method: 'POST', body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to join the group order");
  }
  return res.json();
};

// 🚨 THE FIX: Upgraded to accept etaMinutes for the Live Countdown
export const updateGroupOrderStatus = async (
  poolId: string, 
  status: 'open' | 'locked' | 'delivered' | 'cancelled' | 'settled', 
  deliveryFee: number = 0,
  etaMinutes: number = 0
) => {
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/status`, {
    method: 'PUT', body: JSON.stringify({ status, delivery_fee: deliveryFee, eta_minutes: etaMinutes })
  });
  if (!res.ok) throw new Error("Failed to update order status");
  return res.json();
};

export const kickParticipant = async (poolId: string, userId: string) => {
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/participants/${userId}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to kick participant");
  }
  return res.json();
};    

export const settleGroupOrder = async (poolId: string) => {
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/settle`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to settle order");
  }
  return res.json();
};

export const updateParticipantPrice = async (poolId: string, userId: string, newPrice: number) => {
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/participants/${userId}/price`, {
    method: 'PUT', body: JSON.stringify({ new_price: newPrice })
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to update participant price");
  }
  return res.json();
};

export const updateParticipantCart = async (
  poolId: string, 
  payload: { 
    contact_number: string, 
    block: string, 
    cart_link?: string,
    items: { item_name: string, quantity: number, estimated_price: number }[] 
  }
) => {
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/participants/me`, {
    method: 'PUT', body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to update your cart");
  }
  return res.json();
};

// 🚨 THE FIX: Replaced broadcastTrackingLink with updateHostInstructions
export const updateHostInstructions = async (poolId: string, instructions: string) => {
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/instructions`, {
    method: 'PUT', 
    body: JSON.stringify({ instructions })
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to update host instructions");
  }
  return res.json();
};

// Add this to @/lib/api.ts
export async function fetchActivePools() {
  // Note: Adjust '/api/group_orders' if you mounted the router at a different path (like '/api/pools')
  const response = await authenticatedFetch(`${API_URL}/api/pools`, {
    method: 'GET',
    cache: 'no-store' 
  });

  if (!response.ok) throw new Error('Failed to load active pools');
  return await response.json();
}