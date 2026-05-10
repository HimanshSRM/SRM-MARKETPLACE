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

// Add 'guest' to the accepted types and set it as the default
// 🚨 Add this interface to keep TypeScript happy across the app
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

// ... existing functions ...

export interface ShopApplicationData {
  shop_name: string;
  description: string;
  location: string;
  contact_number: string;
  contact_email: string;
}

export async function createShopProfile(shopData: any, overwrite: boolean = false) {
  const response = await authenticatedFetch(`${API_URL}/api/shops/create?overwrite=${overwrite}`, {
    method: 'POST',
    body: JSON.stringify(shopData)
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Failed to create shop");
  
  // Will return { status: 'exists', shop_data: {...} } if an old shop is found!
  return data; 
}


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

// 1. Define the Response Shape so TypeScript is happy
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
      
      // 🚨 Formats FastAPI 422 Array errors into readable text instead of [object Object]
      const errorMessage = errorData?.detail 
        ? (typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail)) 
        : `Backend error: ${response.status}`;
        
      throw new Error(errorMessage);
    }

    const rawData = await response.json(); 

    // 3. 🛡️ API LAYER NORMALIZATION
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
  image_url?: string; // Optional for now until we hook up cloud storage
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
// CHAT & BIDDING API
// ==========================================

export interface ChatRoom {
  id: string | number;
  product_id: string | number;
  buyer_id: string;
  seller_id: string;
  // Your backend might return more fields like 'product_title' or 'last_message'
  [key: string]: any; 
}

export interface ChatMessage {
  id: string | number;
  sender_id: string;
  text : string;
  is_bid: boolean;
  bid_amount?: number;
  status?: string; // 'pending', 'accepted', 'rejected'
  created_at: string;
  timestamp?: string;
}

export interface InboxData {
  pools: never[];
  buying: any[];
  selling: any[];
  support: any[];
}

// 1. Initiate Bid Chat
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
      initial_message: initialMessage 
    }), 
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error("🚨 FastAPI 422 Details:", JSON.stringify(errorData, null, 2));
    throw new Error(
      (errorData && errorData.detail) ? JSON.stringify(errorData.detail) : 'Failed to initiate chat'
    );
  }
  
  return await response.json();
}

// 2. Get User Inbox
export async function getInbox(): Promise<InboxData> {
  const response = await authenticatedFetch(`${API_URL}/api/chat/inbox`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error("🚨 Inbox Fetch Error:", errorData);
    throw new Error('Failed to load inbox');
  }

  const data = await response.json();
  
  // 🚨 SAFE FALLBACK: Ensures your frontend never crashes even if the backend is missing a list
  return {
    buying: data.buying || [],
    selling: data.selling || [],
    support: data.support || [],
    pools: data.pools || []
  };
}

// 3. Send Message / Bid
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
    console.error("🚨 FastAPI 422 Details (sendMessage):", JSON.stringify(errorData, null, 2));
    throw new Error(
      (errorData && errorData.detail) ? JSON.stringify(errorData.detail) : 'Failed to send message'
    );
  }
  return await response.json();
}

// 4. Accept Bid
export async function acceptBid(roomId: string | number, messageId: string | number) {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/messages/${messageId}/accept`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error("🚨 FastAPI Error (acceptBid):", JSON.stringify(errorData, null, 2));
    throw new Error(
      (errorData && errorData.detail) 
        ? (typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail)) 
        : 'Failed to accept bid'
    );
  }
  return await response.json();
}

// 5. Get Messages for a specific Room
export async function getChatMessages(roomId: string | number): Promise<{ room: any, messages: ChatMessage[] }> {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/messages`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    console.error(`🚨 FastAPI Error (getChatMessages) for Room ${roomId}`);
    return { room: null, messages: [] }; 
  }

  const data = await response.json().catch(() => null);
  if (!data) return { room: null, messages: [] };

  // Safely extract messages AND the room metadata
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

export interface Shop {
  id: string;
  owner_id: string;
  owner_email?: string;
  status?: string;
  shop_name?: string; 
  name?: string; 
  description: string;
  location?: string;
  contact_number?: string; 
  contact_email?: string;
  contact_info?: string; 
  is_verified: boolean;
  created_at: string;
}

export interface CatalogItem {
  id: string;
  shop_id: string;
  title: string;
  description: string;
  price: number;
  image_url?: string;
  in_stock: boolean;
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
  const response = await authenticatedFetch(`${API_URL}/api/shops/${shopId}/catalog`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Failed to load catalog');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

// 4. Add an Item to Shop Catalog (Private)
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

// Delete a catalog item
export async function deleteCatalogItem(itemId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_URL}/api/shops/catalog/${itemId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to delete catalog item');
  }
}

export async function updateShopProfile(
  shopId: string, 
  updateData: { shop_name?: string; description?: string; phone_number?: string; location?: string }
) {
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



// ==========================================
// ADMIN API
// ==========================================

// 1. Get Pending Shops
export async function getPendingShops(): Promise<Shop[]> {
  const response = await authenticatedFetch(`${API_URL}/api/admin/shops/pending`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Failed to load pending shops');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

// 2. Verify Shop
export async function verifyShop(shopId: string): Promise<any> {
  const response = await authenticatedFetch(`${API_URL}/api/admin/shops/${shopId}/verify`, {
    method: 'PUT',
  });

  if (!response.ok) throw new Error('Failed to verify shop');
  return await response.json();
}

// 3. Reject Shop
export async function rejectShop(shopId: string, reason: string): Promise<any> {
  const response = await authenticatedFetch(`${API_URL}/api/admin/shops/${shopId}/reject`, {
    method: 'PUT',
    body: JSON.stringify({ reason }), 
  });

  if (!response.ok) throw new Error('Failed to reject shop');
  return await response.json();
}


// --- USERS ---
export async function searchUserByEmail(email: string) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/users/search?email=${encodeURIComponent(email)}`, {
    method: 'GET',
  });
  if (!response.ok) throw new Error('User not found');
  return await response.json();
}

export async function setUserRole(uid: string, role: string) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/users/${uid}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error('Failed to update user role');
  return await response.json();
}

export async function checkMyShop() {
  const response = await authenticatedFetch(`${API_URL}/api/shops/me`, {
    method: 'GET',
  });
  if (!response.ok) return { has_shop: false };
  return await response.json();
}


// ==========================================
// 🚨 TRUST & SAFETY API
// ==========================================

// 1. Student Action: Report an inappropriate listing
export async function reportListing(listingId: string, reason: string, details: string = "") {
  const response = await authenticatedFetch(`${API_URL}/api/admin/listings/${listingId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, details }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to submit report');
  }
  return await response.json();
}

// 2. Admin Action: 3-Tier Moderation (Warn, Hide, Delete)
export async function moderateListing(
  listingId: string, 
  action: 'warn' | 'hide' | 'delete' | 'restore', 
  reason: string ,
  shopId?: string
) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/listings/${listingId}/moderate`, {
    method: 'POST',
    body: JSON.stringify({ action, reason , shop_id: shopId }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to execute moderation action');
  }
  return await response.json();
}


// 3. Student Action: Report a Shop Catalog Item
export async function reportShopItem(shopId: string, itemId: string, reason: string, details: string = "") {
  const response = await authenticatedFetch(`${API_URL}/api/shops/${shopId}/catalog/${itemId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, details }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to submit shop report');
  }
  return await response.json();
}



// --- SUPPORT TICKETS ---
export async function getAllSupportTickets() {
  const response = await authenticatedFetch(`${API_URL}/api/admin/tickets`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error("Failed to fetch support tickets");
  }
  
  const result = await response.json();
  return Array.isArray(result) ? result : result.data || []; 
}

export async function replyToTicket(ticketId: string, status: string, admin_response: string) {
  const response = await authenticatedFetch(`${API_URL}/api/support/admin/${ticketId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ status, admin_response }),
  });
  if (!response.ok) throw new Error('Failed to reply to ticket');
  return await response.json();
}

// Generic Warning Tool (No specific listing)
export async function warnUser(targetUid: string, subject: string, message: string) {
  const response = await authenticatedFetch(`${API_URL}/api/admin/warn/${targetUid}`, {
    method: 'POST',
    body: JSON.stringify({ subject, message }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to send warning');
  }
  return await response.json();
}


// ==========================================
// SUPPORT API (USER FACING)
// ==========================================

export async function createSupportTicket(payload: { subject: string, message?: string, description?: string }) {
  const finalMessage = payload.message || payload.description || "No message provided.";

  const response = await authenticatedFetch(`${API_URL}/api/chat/support/ticket`, {
    method: 'POST',
    body: JSON.stringify({ 
      subject: payload.subject, 
      message: finalMessage 
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to create support ticket');
  }
  return await response.json();
}

export async function getMyTickets() {
  const response = await authenticatedFetch(`${API_URL}/api/support/my-tickets`, {
    method: 'GET',
  });
  if (!response.ok) throw new Error('Failed to load tickets');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

export async function resolveSupportTicket(ticketId: string | number) {
  const response = await authenticatedFetch(`${API_URL}/api/support/admin/${ticketId}/resolve`, {
    method: 'PUT',
  });
  if (!response.ok) throw new Error('Failed to resolve ticket');
  return await response.json();
}


export async function getAllUsers() {
  const response = await authenticatedFetch(`${API_URL}/api/admin/users`, {
    method: 'GET',
  });
  if (!response.ok) throw new Error('Failed to load users');
  const data = await response.json();
  return data.data || [];
}



// ==========================================
// 🎓 STUDENT DASHBOARD & PROFILE
// ==========================================

export async function getStudentDashboard() {
  const response = await authenticatedFetch(`${API_URL}/api/users/dashboard/student`, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to load dashboard');
  }
  return await response.json();
}

export async function deleteMyListing(listingId: string) {
  const response = await authenticatedFetch(`${API_URL}/api/products/${listingId}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    throw new Error('Failed to delete listing');
  }
  return await response.json();
}


export async function updateMyListing(listingId: string, updateData: any) {
  const response = await authenticatedFetch(`${API_URL}/api/products/${listingId}`, {
    method: 'PUT',
    body: JSON.stringify(updateData),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to update listing');
  }
  return await response.json();
}



//Guest Dashboard 

export async function getGuestDashboard() {
  const response = await authenticatedFetch(`${API_URL}/api/dashboard/guest`, {
    method: 'GET',
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch guest dashboard');
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
    method: 'POST',
    body: JSON.stringify({ action, reason, room_id: roomId })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to ${action} user`);
  }
  return await response.json();
}



// Delete multiple messages from a chat room
export async function deleteChatMessages(roomId: string | number, messageIds: string[]) {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/messages/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ message_ids: messageIds }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to delete messages');
  }
  return await response.json();
}


export async function hideChatRoom(roomId: string | number) {
  const response = await authenticatedFetch(`${API_URL}/api/chat/${roomId}/hide`, {
    method: 'PUT',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to hide chat');
  }
  return await response.json();
}


// 🚨 NEW: Safely restore a shop without deleting the catalog
export async function restoreShopProfile() {
  const response = await authenticatedFetch(`${API_URL}/api/shops/restore`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to restore shop');
  }
  return await response.json();
}


// ==========================================
// GROUP ORDERS (CART POOLING) APIs
// ==========================================

export const getActiveGroupOrders = async () => {
  // 🚨 ADDED TRAILING SLASH: /api/pools/
  const res = await authenticatedFetch(`${API_URL}/api/pools/`, {
    method: 'GET',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to fetch active group orders");
  }
  return res.json(); 
};

export const createGroupOrder = async (orderData: { app_name: string, pickup_location: string, contact_number: string, expires_in_minutes: number, upi_id: string }) => {
  // 🚨 ADDED TRAILING SLASH: /api/pools/
  const res = await authenticatedFetch(`${API_URL}/api/pools/`, {
    method: 'POST',
    body: JSON.stringify(orderData)
  });
  if (!res.ok) throw new Error("Failed to create group order");
  return res.json();
};

export const joinGroupOrder = async (
  poolId: string, 
  payload: { contact_number: string, block: string, items: { item_name: string, quantity: number, estimated_price: number }[] }
) => {
  // 🚨 ADDED TRAILING SLASH
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/join/`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to join the group order");
  }
  return res.json();
};

export const updateGroupOrderStatus = async (poolId: string, status: 'locked' | 'delivered' | 'cancelled', deliveryFee: number = 0) => {
  // 🚨 ADDED TRAILING SLASH
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/status/`, {
    method: 'PUT',
    body: JSON.stringify({ status, delivery_fee: deliveryFee })
  });
  if (!res.ok) throw new Error("Failed to update order status");
  return res.json();
};

export const kickParticipant = async (poolId: string, userId: string) => {
  // 🚨 ADDED TRAILING SLASH
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/participants/${userId}/`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to kick participant");
  }
  return res.json();
};    

export const settleGroupOrder = async (poolId: string) => {
  // 🚨 ADDED TRAILING SLASH
  const res = await authenticatedFetch(`${API_URL}/api/pools/${poolId}/settle/`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to settle order");
  }
  return res.json();
};