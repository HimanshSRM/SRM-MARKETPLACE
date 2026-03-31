from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore

from app.core.firebase import db
from app.core.security import get_transacting_user, get_current_user # 🛡️ Upgraded to block Guests
from app.models.chat import (
    ChatInitiate, 
    MessageCreate, 
    InboxResponse, 
    BidStatus,
    BulkDeletePayload,
    TicketCreate
)

router = APIRouter()

# ==========================================
# 1. INITIATE CHAT
# ==========================================
@router.post("/initiate", tags=["Chat & Bidding"])
async def initiate_chat(data: ChatInitiate, user: dict = Depends(get_transacting_user)):
    sender_id = user.get("uid")
    if sender_id == data.owner_id:
        raise HTTPException(status_code=400, detail="You cannot message yourself.")

    try:
        owner_doc = db.collection("users").document(data.owner_id).get()
        if not owner_doc.exists:
            raise HTTPException(status_code=404, detail="The owner of this listing no longer exists.")
            
        owner_data = owner_doc.to_dict()
        owner_role = owner_data.get("role", "student")
        
        if owner_role == "shop_verified" and data.bid_amount is not None:
            raise HTTPException(status_code=400, detail="Verified Shops have fixed prices. Bidding is disabled.")

        existing_rooms = db.collection("chat_rooms")\
            .where("buyer_id", "==", sender_id)\
            .where("listing_id", "==", data.listing_id)\
            .limit(1).get()
            
        if existing_rooms:
            room_id = existing_rooms[0].id
            room_ref = db.collection("chat_rooms").document(room_id)
        else:
            room_ref = db.collection("chat_rooms").document()
            room_id = room_ref.id
            room_ref.set({
                "listing_id": data.listing_id,
                "buyer_id": sender_id,
                "seller_id": data.owner_id,
                "last_message": data.initial_message,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "is_ticket": False
            })
        
        message_data = {
            "sender_id": sender_id,
            "text": data.initial_message,
            "is_bid": data.bid_amount is not None,
            "bid_amount": data.bid_amount,
            "bid_status": BidStatus.PENDING.value if data.bid_amount is not None else None,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP
        }
        room_ref.collection("messages").add(message_data)
        
        room_ref.update({
            "last_message": data.initial_message,
            "last_sender_id": sender_id,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        return {"message": "Message sent successfully!", "room_id": room_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 2. GET USER INBOX
# ==========================================
@router.get("/inbox", tags=["Chat & Bidding"])
async def get_user_inbox(user: dict = Depends(get_current_user)): 
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        email = user.get("email", "")
        
        buying_query = db.collection("chat_rooms").where("buyer_id", "==", uid).stream()
        selling_query = db.collection("chat_rooms").where("seller_id", "==", uid).stream()
        
        buying_chats = []
        support_tickets = []
        selling_chats = []
        
        for doc in buying_query:
            room = {"id": doc.id, "room_id": doc.id, **doc.to_dict()}
            if uid in room.get("hidden_by", []): continue
            if "updated_at" in room and room["updated_at"]: room["updated_at"] = str(room["updated_at"])
            
            if room.get("is_ticket") in [True, "true", "True"]:
                support_tickets.append(room)
            else:
                buying_chats.append(room)
                
        for doc in selling_query:
            room = {"id": doc.id, "room_id": doc.id, **doc.to_dict()}
            if uid in room.get("hidden_by", []): continue
            if room.get("is_ticket") in [True, "true", "True"]: continue 
            if "updated_at" in room and room["updated_at"]: room["updated_at"] = str(room["updated_at"])
            selling_chats.append(room)

        if role == "admin" or email == "himanshyadav202@gmail.com":
            admin_tickets_query = db.collection("chat_rooms").where("seller_id", "==", "ADMIN_TEAM").stream()
            for doc in admin_tickets_query:
                room = {"id": doc.id, "room_id": doc.id, **doc.to_dict()}
                if "updated_at" in room and room["updated_at"]: room["updated_at"] = str(room["updated_at"])
                if not any(t.get("id") == room["id"] for t in support_tickets):
                    support_tickets.append(room)
        
        buying_chats.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        selling_chats.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        support_tickets.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        
        return {"buying": buying_chats, "selling": selling_chats, "support": support_tickets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 3. GET CHAT HISTORY 
# ==========================================
@router.get("/{room_id}/messages", tags=["Chat & Bidding"])
async def get_chat_history(room_id: str, user: dict = Depends(get_current_user)):
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        email = user.get("email", "") # 🚨 Get Email for Admin Fallback
        
        room_ref = db.collection("chat_rooms").document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            raise HTTPException(status_code=404, detail="Chat room not found")
            
        room_data = room_doc.to_dict()
        room_data["id"] = room_doc.id
        
        if "updated_at" in room_data and room_data["updated_at"]:
            room_data["updated_at"] = str(room_data["updated_at"])
        if "created_at" in room_data and room_data["created_at"]:
            room_data["created_at"] = str(room_data["created_at"])

        # 🚨 THE FIX: Allow access if role is admin OR if the email matches!
        is_buyer = room_data.get("buyer_id") == uid
        is_seller = room_data.get("seller_id") == uid
        is_admin_support = room_data.get("seller_id") == "ADMIN_TEAM" and (role == "admin" or email == "himanshyadav202@gmail.com")
        
        if not (is_buyer or is_seller or is_admin_support):
            raise HTTPException(status_code=403, detail="Access denied. You are not in this chat.")

        # 🚨 Safe fetch without order_by to prevent Firebase Missing Index crashes
        messages_query = room_ref.collection("messages").stream()
        
        messages = []
        for doc in messages_query:
            msg = {"id": doc.id, **doc.to_dict()}
            if "timestamp" in msg and msg["timestamp"]:
                msg["timestamp"] = str(msg["timestamp"])
            if "created_at" in msg and msg["created_at"]:
                msg["created_at"] = str(msg["created_at"])
            messages.append(msg)

        # Sort safely in Python
        messages.sort(key=lambda x: str(x.get("created_at") or x.get("timestamp") or ""))

        return {
            "room": room_data,
            "messages": messages
        }

    except HTTPException:
        raise
    except Exception as e:
        print("Error fetching messages:", e)
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 4. SEND MESSAGE
# ==========================================
@router.post("/{room_id}/messages", tags=["Chat & Bidding"])
async def send_message(room_id: str, req: dict, user: dict = Depends(get_current_user)):
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        email = user.get("email", "") # 🚨 Get Email for Admin Fallback
        
        room_ref = db.collection("chat_rooms").document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            raise HTTPException(status_code=404, detail="Chat room not found")
            
        room_data = room_doc.to_dict()
        
        # 🚨 THE FIX: Allow access if role is admin OR if the email matches!
        is_buyer = room_data.get("buyer_id") == uid
        is_seller = room_data.get("seller_id") == uid
        is_admin_support = room_data.get("seller_id") == "ADMIN_TEAM" and (role == "admin" or email == "himanshyadav202@gmail.com")
        
        if not (is_buyer or is_seller or is_admin_support):
            raise HTTPException(status_code=403, detail="403: Access denied. You are not in this chat.")

        msg_ref = room_ref.collection("messages").document()
        msg_data = {
            "id": msg_ref.id,
            "sender_id": uid,
            "text": req.get("text", req.get("content", "")),
            "is_bid": req.get("is_bid", False),
            "bid_amount": req.get("bid_amount"),
            "created_at": firestore.SERVER_TIMESTAMP,
            "timestamp": firestore.SERVER_TIMESTAMP
        }
        msg_ref.set(msg_data)
        
        room_ref.update({
            "last_message": msg_data["text"],
            "last_sender_id": uid,
            "updated_at": firestore.SERVER_TIMESTAMP
        })

        if room_data.get("is_ticket"):
            tickets = db.collection("tickets").where("chat_room_id", "==", room_id).stream()
            for t in tickets:
                update_data = {"updated_at": firestore.SERVER_TIMESTAMP}
                # Sync Admin Response using the fallback check
                if is_admin_support:
                    update_data["admin_response"] = msg_data["text"]
                t.reference.update(update_data)

        msg_data["created_at"] = "Just now"
        msg_data["timestamp"] = "Just now"
        return msg_data

    except HTTPException:
        raise
    except Exception as e:
        print("Send message error:", e)
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 5. ACCEPT BID
# ==========================================
@router.post("/{room_id}/messages/{message_id}/accept", tags=["Chat & Bidding"])
async def accept_bid(room_id: str, message_id: str, user: dict = Depends(get_transacting_user)):
    try:
        uid = user.get("uid")
        room_ref = db.collection("chat_rooms").document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            raise HTTPException(status_code=404, detail="Chat room not found.")
        
        room_data = room_doc.to_dict()
        
        if room_data.get("seller_id") != uid:
            raise HTTPException(status_code=403, detail="Security Error: Only the seller can accept a bid.")
            
        listing_id = room_data.get("listing_id")
        listing_ref = db.collection("listings").document(listing_id)
        
        if not listing_ref.get().exists:
            raise HTTPException(status_code=404, detail="Listing not found.")
            
        listing_ref.update({"status": "sold"})
        
        message_ref = room_ref.collection("messages").document(message_id)
        message_ref.update({"bid_status": BidStatus.ACCEPTED.value})
        
        return {"message": "Bid accepted! The item is now marked as sold.", "listing_id": listing_id}
        
    except HTTPException:
        raise 
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

# ==========================================
# 6. BULK DELETE MESSAGES
# ==========================================
@router.post("/{room_id}/messages/bulk-delete", tags=["Chat & Bidding"])
async def delete_messages(room_id: str, payload: BulkDeletePayload, user: dict = Depends(get_current_user)):
    """Allows a user to delete multiple messages at once. Secures against deleting other people's messages."""
    uid = user.get("uid")
    role = user.get("role", "guest")

    try:
        room_ref = db.collection("chat_rooms").document(room_id)
        if not room_ref.get().exists:
            raise HTTPException(status_code=404, detail="Chat room not found")

        batch = db.batch()
        deleted_count = 0

        # Loop through the requested IDs and verify ownership before deleting
        for msg_id in payload.message_ids:
            msg_ref = room_ref.collection("messages").document(msg_id)
            msg_doc = msg_ref.get()

            if msg_doc.exists:
                msg_data = msg_doc.to_dict()
                # 🚨 SECURITY: They can only delete it if they sent it (unless they are an admin)
                if msg_data.get("sender_id") == uid or role == "admin":
                    batch.delete(msg_ref)
                    deleted_count += 1

        # Execute all deletions at the exact same time
        if deleted_count > 0:
            batch.commit()

        return {"message": f"Successfully deleted {deleted_count} messages.", "deleted_ids": payload.message_ids}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

# ==========================================
# 7. HIDE CHAT FROM INBOX (SOFT DELETE)
# ==========================================
@router.put("/{room_id}/hide", tags=["Chat & Bidding"])
async def hide_chat_room(room_id: str, user: dict = Depends(get_current_user)):
    """Soft-deletes a chat room by hiding it from the specific user's inbox."""
    try:
        uid = user.get("uid")
        room_ref = db.collection("chat_rooms").document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            raise HTTPException(status_code=404, detail="Chat room not found")

        room_data = room_doc.to_dict()
        hidden_by = room_data.get("hidden_by", [])
        
        if uid not in hidden_by:
            hidden_by.append(uid)
            room_ref.update({"hidden_by": hidden_by})

        return {"message": "Chat removed from inbox"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))    
    



@router.post("/support/ticket", tags=["Chat & Support"])
async def create_support_ticket(payload: TicketCreate, user: dict = Depends(get_current_user)):
    """Allows any user to open a general support ticket with the Admin Team."""
    try:
        uid = user.get("uid")
        
        # 1. Create the Chat Room
        ticket_ref = db.collection("chat_rooms").document()
        ticket_ref.set({
            "is_ticket": True,
            "buyer_id": uid, # The user asking for help
            "seller_id": "ADMIN_TEAM", # Routes straight to your Admin Inbox
            "subject": f"📩 SUPPORT: {payload.subject}",
            "last_message": payload.message,
            "status": "open",
            "severity": "low", # Admins can escalate this later if needed
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "last_sender_id": uid
        })
        
        # 2. Add their initial message
        ticket_ref.collection("messages").add({
            "sender_id": uid,
            "text": payload.message,
            "is_bid": False,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP
        })
        
        return {
            "message": "Support ticket created successfully.", 
            "ticket_id": ticket_ref.id
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))    