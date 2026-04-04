const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000' || 'http://localhost:8000' ;

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
  token: string, 
  selectedRole: 'guest' | 'student' | 'shop' = 'guest'
): Promise<SyncResponse> { // 🚨 Added explicit return type
  try {
    const response = await fetch(`${API_URL}/api/users/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`, 
      },
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

export async function sendStudentOtp(token: string, email: string) {
  try {
    const response = await fetch(`${API_URL}/api/users/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
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

export async function verifyStudentOtp(token: string, email: string, otpCode: string) {
  try {
    const response = await fetch(`${API_URL}/api/users/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
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

export async function createShopProfile(token: string, shopData: any, overwrite: boolean = false) {
  // 🚨 Notice it hits /api/shops/create to match your FastAPI backend!
  const response = await fetch(`${API_URL}/api/shops/create?overwrite=${overwrite}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
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
  token: string, 
  limit: number = 15, 
  cursor: string = '', 
  category: string = ''
): Promise<PaginatedProducts> {
  try {
    // 2. Build the URL dynamically with query params
    const baseUrl = `${API_URL}/api/products/live`;
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(cursor && { cursor }),
      ...(category && { category }),
    });

    const response = await fetch(`${baseUrl}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`, 
      },
      cache: 'no-store' 
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.detail || `Backend error: ${response.status}`);
    }

    const rawData = await response.json(); 

    // 3. 🛡️ API LAYER NORMALIZATION
    // We want to ensure we return the standardized PaginatedProducts object
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

export async function createProduct(token: string, productData: CreateProductPayload) {
  try {
    const response = await fetch(`${API_URL}/api/products/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`, 
      },
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
  buying: any[];
  selling: any[];
  support: any[];
}

// 1. Initiate Bid Chat (Updated to match FastAPI schema)
export async function initiateChat(
  token: string, 
  listingId: string | number,
  ownerId: string,
  initialMessage: string
): Promise<ChatRoom> {
  const response = await fetch(`${API_URL}/api/chat/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
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
export async function getInbox(token: string): Promise<InboxData> {
  const response = await fetch(`${API_URL}/api/chat/inbox`, {
    method: 'GET',
    headers: { 
      'Authorization': `Bearer ${token}` 
    },
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
    support: data.support || []
  };
}

// 3. Send Message / Bid
// Inside src/lib/api.ts

export async function sendMessage(
  token: string, 
  roomId: string | number, 
  senderId: string,       // 🚨 NEW: FastAPI requires the sender's ID
  text: string,           // 🚨 CHANGED: Renamed from 'content' to 'text'
  isBid: boolean = false, 
  bidAmount?: number
): Promise<ChatMessage> {
  const response = await fetch(`${API_URL}/api/chat/${roomId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ 
      sender_id: senderId, // 🚨 Sending what FastAPI asked for
      text: text,          // 🚨 Sending what FastAPI asked for
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
export async function acceptBid(token: string, roomId: string | number, messageId: string | number) {
  const response = await fetch(`${API_URL}/api/chat/${roomId}/messages/${messageId}/accept`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    // 🛠️ NEW: Catch exact backend errors (e.g., "Bid already accepted" or 422s)
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

export async function getChatMessages(token: string, roomId: string | number): Promise<{ room: any, messages: ChatMessage[] }> {
  const response = await fetch(`${API_URL}/api/chat/${roomId}/messages`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
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
  let room: any = data.room || data; // Fallback depending on your exact FastAPI JSON shape

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
  
  // 🚨 Add these two new fields from the backend
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
export async function getLiveShops(token: string): Promise<Shop[]> {
  const response = await fetch(`${API_URL}/api/shops/live`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    cache: 'no-store', // Always get fresh data
  });

  if (!response.ok) throw new Error('Failed to load shops');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

// 2. Get a Specific Shop's Catalog (Public)
export async function getShopCatalog(token: string, shopId: string): Promise<CatalogItem[]> {
  const response = await fetch(`${API_URL}/api/shops/${shopId}/catalog`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Failed to load catalog');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}



// 4. Add an Item to Shop Catalog (Private)
export async function addCatalogItem(token: string, itemData: any): Promise<CatalogItem> {
  const response = await fetch(`${API_URL}/api/shops/catalog/add`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(itemData),
  });

  if (!response.ok) throw new Error('Failed to add catalog item');
  return await response.json();
}

export async function updateCatalogItem(token: string, itemId: string, payload: any): Promise<CatalogItem> {
  const response = await fetch(`${API_URL}/api/shops/catalog/${itemId}`, {
    method: 'PUT', // Using PUT for updates
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to update catalog item');
  }
  
  return await response.json();
}

// Delete a catalog item
export async function deleteCatalogItem(token: string, itemId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/shops/catalog/${itemId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to delete catalog item');
  }
}

export async function updateShopProfile(
  token: string, 
  shopId: string, 
  updateData: { shop_name?: string; description?: string; phone_number?: string; location?: string }
) {
  const response = await fetch(`${API_URL}/api/shops/${shopId}/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
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
export async function getPendingShops(token: string): Promise<Shop[]> {
  const response = await fetch(`${API_URL}/api/admin/shops/pending`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Failed to load pending shops');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

// 2. Verify Shop
export async function verifyShop(token: string, shopId: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/admin/shops/${shopId}/verify`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) throw new Error('Failed to verify shop');
  return await response.json();
}

// 3. Reject Shop
export async function rejectShop(token: string, shopId: string, reason: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/admin/shops/${shopId}/reject`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }), // Matches your RejectRequest schema!
  });

  if (!response.ok) throw new Error('Failed to reject shop');
  return await response.json();
}


// --- USERS ---
export async function searchUserByEmail(token: string, email: string) {
  const response = await fetch(`${API_URL}/api/admin/users/search?email=${encodeURIComponent(email)}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('User not found');
  return await response.json();
}

export async function setUserRole(token: string, uid: string, role: string) {
  const response = await fetch(`${API_URL}/api/admin/users/${uid}/role`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error('Failed to update user role');
  return await response.json();
}

export async function checkMyShop(token: string) {
  const response = await fetch(`${API_URL}/api/shops/me`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) return { has_shop: false };
  return await response.json();
}



// ==========================================
// 🚨 TRUST & SAFETY API
// ==========================================

// 1. Student Action: Report an inappropriate listing
export async function reportListing(token: string, listingId: string, reason: string, details: string = "") {
  // 🚨 ADDED /admin to the URL path here
  const response = await fetch(`${API_URL}/api/admin/listings/${listingId}/report`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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
  token: string, 
  listingId: string, 
  action: 'warn' | 'hide' | 'delete' | 'restore', 
  reason: string ,
  shopId?: string
) {
  // 🚨 ADDED /admin to the URL path here
  const response = await fetch(`${API_URL}/api/admin/listings/${listingId}/moderate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, reason , shop_id: shopId }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to execute moderation action');
  }
  return await response.json();
}


// 3. Student Action: Report a Shop Catalog Item
export async function reportShopItem(token: string, shopId: string, itemId: string, reason: string, details: string = "") {
  const response = await fetch(`${API_URL}/api/shops/${shopId}/catalog/${itemId}/report`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason, details }),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to submit shop report');
  }
  return await response.json();
}



// --- SUPPORT TICKETS ---
// 🚨 THE NEW UNIFIED TICKETS ROUTE
export async function getAllSupportTickets(token: string) {
  const response = await fetch(`${API_URL}/api/admin/tickets`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error("Failed to fetch support tickets");
  }
  
  const result = await response.json();
  // Safely return the array whether it's wrapped in { data: [...] } or just [...]
  return Array.isArray(result) ? result : result.data || []; 
}

// (You can leave this here just in case any older parts of your app still use it)
export async function replyToTicket(token: string, ticketId: string, status: string, admin_response: string) {
  const response = await fetch(`${API_URL}/api/support/admin/${ticketId}/reply`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status, admin_response }),
  });
  if (!response.ok) throw new Error('Failed to reply to ticket');
  return await response.json();
}

// Generic Warning Tool (No specific listing)
export async function warnUser(token: string, targetUid: string, subject: string, message: string) {
  const response = await fetch(`${API_URL}/api/admin/warn/${targetUid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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

export async function createSupportTicket(token: string, payload: { subject: string, message?: string, description?: string }) {
  
  // Safely map 'description' to 'message' just in case an older page uses the old format
  const finalMessage = payload.message || payload.description || "No message provided.";

  const response = await fetch(`${API_URL}/api/chat/support/ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
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

export async function getMyTickets(token: string) {
  const response = await fetch(`${API_URL}/api/support/my-tickets`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to load tickets');
  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

export async function resolveSupportTicket(token: string, ticketId: string | number) {
  const response = await fetch(`${API_URL}/api/support/admin/${ticketId}/resolve`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to resolve ticket');
  return await response.json();
}


export async function getAllUsers(token: string) {
  const response = await fetch(`${API_URL}/api/admin/users`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('Failed to load users');
  const data = await response.json();
  return data.data || [];
}



// ==========================================
// 🎓 STUDENT DASHBOARD & PROFILE
// ==========================================

export async function getStudentDashboard(token: string) {
  const response = await fetch(`${API_URL}/api/users/dashboard/student`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to load dashboard');
  }
  return await response.json();
}

export async function deleteMyListing(token: string, listingId: string) {
  const response = await fetch(`${API_URL}/api/products/${listingId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  
  if (!response.ok) {
    throw new Error('Failed to delete listing');
  }
  return await response.json();
}


export async function updateMyListing(token: string, listingId: string, updateData: any) {
  const response = await fetch(`${API_URL}/api/products/${listingId}`, {
    method: 'PUT',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData),
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to update listing');
  }
  return await response.json();

}



//Guest Dashboard 

export async function getGuestDashboard(token: string) {
  const response = await fetch(`${API_URL}/api/dashboard/guest`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch guest dashboard');
  }
  return await response.json();
}


// Add to src/lib/api.ts

export async function moderateUser(
  token: string, 
  uid: string, 
  action: 'warn' | 'ban' | 'restore' | 'nuke', 
  reason: string,
  roomId: string
) {
  const response = await fetch(`${API_URL}/api/admin/users/${uid}/moderate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ action, reason, room_id: roomId })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || `Failed to ${action} user`);
  }
  return await response.json();
}



// Delete multiple messages from a chat room
export async function deleteChatMessages(token: string, roomId: string | number, messageIds: string[]) {
  const response = await fetch(`${API_URL}/api/chat/${roomId}/messages/bulk-delete`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message_ids: messageIds }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to delete messages');
  }
  return await response.json();
}


export async function hideChatRoom(token: string, roomId: string | number) {
  const response = await fetch(`${API_URL}/api/chat/${roomId}/hide`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || 'Failed to hide chat');
  }
  return await response.json();
}


// 🚨 NEW: Safely restore a shop without deleting the catalog
export async function restoreShopProfile(token: string) {
  const response = await fetch(`${API_URL}/api/shops/restore`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to restore shop');
  }
  return await response.json();
}

