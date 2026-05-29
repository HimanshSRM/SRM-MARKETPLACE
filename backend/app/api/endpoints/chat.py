from fastapi import APIRouter, Depends, HTTPException, Request
from google.cloud import firestore
from pydantic import BaseModel
from typing import Optional

from app.core.firebase import db
from app.core.security import get_transacting_user, get_current_user, get_active_user 
from app.models.chat import (
    ChatInitiate, 
    MessageCreate, 
    InboxResponse, 
    BidStatus,
    BulkDeletePayload,
    TicketCreate
)

router = APIRouter()

# 🚨 NEW SCHEMA: For saving Phone/UPI post-deal
class ContactUpdate(BaseModel):
    phone: Optional[str] = None
    upi_id: Optional[str] = None

# ==========================================
# 1. INITIATE CHAT (1-on-1 Marketplace)
# ==========================================
@router.post("/initiate", tags=["Chat & Bidding"])
async def initiate_chat(
    data: ChatInitiate, 
    request: Request, 
    user: dict = Depends(get_transacting_user)
):
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
                "shop_id": data.owner_id if owner_role == "shop_verified" else None, # 🚨 Added Shop ID metadata for frontend
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
        
        await request.app.state.redis.enqueue_job(
            'process_push_notification',
            data.owner_id,
            "💬 New Conversation Started",
            data.initial_message,
            f"/chat/{room_id}"
        )
        
        return {"message": "Message sent successfully!", "room_id": room_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 2. GET USER INBOX (Highly Optimized Bulk Fetch)
# ==========================================
@router.get("/inbox", tags=["Chat & Bidding"])
async def get_user_inbox(user: dict = Depends(get_current_user)): 
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        email = user.get("email", "")
        
        raw_buying = list(db.collection("chat_rooms").where("buyer_id", "==", uid).stream())
        raw_selling = list(db.collection("chat_rooms").where("seller_id", "==", uid).stream())
        raw_group = list(db.collection("chat_rooms").where("participants", "array_contains", uid).stream())
        
        needed_listing_ids = set()
        needed_user_ids = set()
        
        all_raw_docs = raw_buying + raw_selling + raw_group
        for doc in all_raw_docs:
            data = doc.to_dict()
            if not data.get("listing_title") and data.get("listing_id"):
                needed_listing_ids.add(data.get("listing_id"))
            if not data.get("buyer_name") and data.get("buyer_id"):
                needed_user_ids.add(data.get("buyer_id"))
            if not data.get("seller_name") and data.get("seller_id"):
                needed_user_ids.add(data.get("seller_id"))
            if data.get("type") == "group_order" and not data.get("host_name") and data.get("host_id"):
                needed_user_ids.add(data.get("host_id"))

        listing_cache = {}
        if needed_listing_ids:
            listing_refs = [db.collection("listings").document(l_id) for l_id in needed_listing_ids]
            for doc in db.get_all(listing_refs):
                if doc.exists:
                    d = doc.to_dict()
                    listing_cache[doc.id] = d.get("title") or d.get("item_name") or d.get("product_name")
        
        user_cache = {}
        if needed_user_ids:
            user_refs = [db.collection("users").document(u_id) for u_id in needed_user_ids]
            for doc in db.get_all(user_refs):
                if doc.exists:
                    d = doc.to_dict()
                    user_cache[doc.id] = d.get("name") or d.get("email")

        buying_chats, selling_chats, support_tickets, pool_chats = [], [], [], []
        
        def process_room(doc):
            room = {"id": doc.id, "room_id": doc.id, **doc.to_dict()}
            if uid in room.get("hidden_by", []): return None
            if "updated_at" in room and room["updated_at"]: 
                room["updated_at"] = str(room["updated_at"])
                
            if not room.get("listing_title") and room.get("listing_id"):
                room["listing_title"] = listing_cache.get(room.get("listing_id"))
            if not room.get("buyer_name") and room.get("buyer_id"):
                room["buyer_name"] = user_cache.get(room.get("buyer_id"))
            if not room.get("seller_name") and room.get("seller_id"):
                room["seller_name"] = user_cache.get(room.get("seller_id"))
            if room.get("type") == "group_order" and not room.get("host_name") and room.get("host_id"):
                room["host_name"] = user_cache.get(room.get("host_id"))
                
            return room

        for doc in raw_buying:
            room = process_room(doc)
            if room:
                if room.get("is_ticket") in [True, "true", "True"]: support_tickets.append(room)
                else: buying_chats.append(room)
                
        for doc in raw_selling:
            room = process_room(doc)
            if room and room.get("is_ticket") not in [True, "true", "True"]:
                selling_chats.append(room)

        for doc in raw_group:
            if any(r["id"] == doc.id for r in buying_chats) or any(r["id"] == doc.id for r in selling_chats):
                continue
            room = process_room(doc)
            if room and room.get("type") == "group_order":
                pool_chats.append(room)

        if role == "admin" or email == "himanshyadav202@gmail.com":
            admin_tickets_query = db.collection("chat_rooms").where("seller_id", "==", "ADMIN_TEAM").stream()
            for doc in admin_tickets_query:
                room = process_room(doc)
                if room and not any(t.get("id") == room["id"] for t in support_tickets):
                    support_tickets.append(room)
        
        buying_chats.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        selling_chats.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        support_tickets.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        pool_chats.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        
        return {
            "buying": buying_chats, 
            "selling": selling_chats, 
            "support": support_tickets,
            "pools": pool_chats 
        }
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
        email = user.get("email", "") 
        
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

        is_buyer = room_data.get("buyer_id") == uid
        is_seller = room_data.get("seller_id") == uid
        is_admin_support = room_data.get("seller_id") == "ADMIN_TEAM" and (role == "admin" or email == "himanshyadav202@gmail.com")
        is_participant = uid in room_data.get("participants", [])
        
        if not (is_buyer or is_seller or is_admin_support or is_participant):
            raise HTTPException(status_code=403, detail="Access denied. You are not in this chat.")

        messages_query = room_ref.collection("messages").stream()
        
        messages = []
        for doc in messages_query:
            msg = {"id": doc.id, **doc.to_dict()}
            if "timestamp" in msg and msg["timestamp"]:
                msg["timestamp"] = str(msg["timestamp"])
            if "created_at" in msg and msg["created_at"]:
                msg["created_at"] = str(msg["created_at"])
            messages.append(msg)

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
# 4. SEND MESSAGE & AUTO-REPLY INTERCEPTOR
# ==========================================
@router.post("/{room_id}/messages", tags=["Chat & Bidding"])
async def send_message(
    room_id: str, 
    req: dict, 
    request: Request, 
    user: dict = Depends(get_current_user)
):
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        status = user.get("status", "active")
        email = user.get("email", "")
        
        room_ref = db.collection("chat_rooms").document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            raise HTTPException(status_code=404, detail="Chat room not found")
            
        room_data = room_doc.to_dict()
        
        is_buyer = room_data.get("buyer_id") == uid
        is_seller = room_data.get("seller_id") == uid
        is_admin_support = room_data.get("seller_id") == "ADMIN_TEAM" and (role == "admin" or email == "himanshyadav202@gmail.com")
        is_participant = uid in room_data.get("participants", [])
        
        if not (is_buyer or is_seller or is_admin_support or is_participant):
            raise HTTPException(status_code=403, detail="403: Access denied. You are not in this chat.")

        is_banned = (role == "banned" or status == "banned")
        if is_banned:
            if room_data.get("seller_id") != "ADMIN_TEAM":
                raise HTTPException(status_code=403, detail="Suspended accounts can only reply in official Admin Support threads.")
            if room_data.get("status") == "resolved":
                raise HTTPException(status_code=403, detail="This support ticket has been closed by the Admin Team.")
            
        user_name = user.get("name", user.get("email", "Campus Member").split("@")[0])    

        msg_ref = room_ref.collection("messages").document()
        msg_text = req.get("text", req.get("content", ""))
        
        msg_data = {
            "id": msg_ref.id,
            "sender_id": uid,
            "sender_name": user_name,
            "text": msg_text,
            "is_bid": req.get("is_bid", False),
            "bid_amount": req.get("bid_amount"),
            "created_at": firestore.SERVER_TIMESTAMP,
            "timestamp": firestore.SERVER_TIMESTAMP
        }
        msg_ref.set(msg_data)
        
        # 🚨 THE FIX 1: Clear the hidden_by array to automatically unhide the chat
        room_ref.update({
            "last_message": msg_data["text"],
            "last_sender_id": uid,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "hidden_by": [] 
        })

        if room_data.get("is_ticket"):
            tickets = db.collection("tickets").where("chat_room_id", "==", room_id).stream()
            for t in tickets:
                update_data = {"updated_at": firestore.SERVER_TIMESTAMP}
                if is_admin_support:
                    update_data["admin_response"] = msg_data["text"]
                t.reference.update(update_data)

        # 🚨 THE AUTO-REPLY INTERCEPTOR LOGIC
        seller_id = room_data.get("seller_id")
        if is_buyer and seller_id and seller_id != "ADMIN_TEAM":
            shop_doc = db.collection("shops").document(seller_id).get()
            if shop_doc.exists:
                shop_data = shop_doc.to_dict()
                quick_replies = shop_data.get("quick_replies", [])
                
                # Check if user's text perfectly matches any configured trigger
                matched_reply = next((qr for qr in quick_replies if qr.get("trigger", "").strip().lower() == msg_text.strip().lower()), None)
                
                if matched_reply:
                    auto_msg_ref = room_ref.collection("messages").document()
                    auto_reply_text = matched_reply.get("response", "")
                    
                    auto_msg_data = {
                        "id": auto_msg_ref.id,
                        "sender_id": seller_id,
                        "sender_name": shop_data.get("shop_name", "Shop Auto-Reply"),
                        "text": auto_reply_text,
                        "is_bid": False,
                        "created_at": firestore.SERVER_TIMESTAMP,
                        "timestamp": firestore.SERVER_TIMESTAMP
                    }
                    auto_msg_ref.set(auto_msg_data)
                    
                    # 🚨 THE FIX 2: Clear the hidden_by array on Auto-Replies as well
                    room_ref.update({
                        "last_message": auto_reply_text,
                        "last_sender_id": seller_id,
                        "updated_at": firestore.SERVER_TIMESTAMP,
                        "hidden_by": []
                    })
                    
                    # Fire Push Notification back to the student instantly
                    await request.app.state.redis.enqueue_job(
                        'process_push_notification',
                        uid, 
                        f"💬 {shop_data.get('shop_name', 'Shop')}",
                        auto_reply_text,
                        f"/chat/{room_id}"
                    )

        target_uids = []
        if room_data.get("type") == "group_order":
            participant_ids = room_data.get("participants", [])
            target_uids.extend([p for p in participant_ids if p != uid])
        else:
            if is_buyer:
                target_id = room_data.get("seller_id")
                if target_id != "ADMIN_TEAM": 
                    target_uids.append(target_id)
            else:
                target_uids.append(room_data.get("buyer_id"))
                
        for target_id in target_uids:
            if target_id:
                title = f"💬 {user_name}" if room_data.get("type") == "group_order" else "💬 New Message"
                if is_admin_support:
                    title = "👨‍💻 Admin Support Reply"
                    
                await request.app.state.redis.enqueue_job(
                    'process_push_notification',
                    target_id,
                    title,
                    msg_text,
                    f"/chat/{room_id}"
                )

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
async def accept_bid(
    room_id: str, 
    message_id: str, 
    request: Request, 
    user: dict = Depends(get_transacting_user)
):
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
        room_ref.update({"status": "sold"}) # Keep room status in sync
        
        message_ref = room_ref.collection("messages").document(message_id)
        message_ref.update({"bid_status": BidStatus.ACCEPTED.value})
        
        buyer_id = room_data.get("buyer_id")
        if buyer_id:
            await request.app.state.redis.enqueue_job(
                'process_push_notification',
                buyer_id,
                "🎉 Bid Accepted!",
                "The seller accepted your bid! Open the chat to finalize details.",
                f"/chat/{room_id}"
            )
        
        return {"message": "Bid accepted! The item is now marked as sold.", "listing_id": listing_id}
        
    except HTTPException:
        raise 
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

# ==========================================
# 6. BULK DELETE MESSAGES
# ==========================================
@router.post("/{room_id}/messages/bulk-delete", tags=["Chat & Bidding"])
async def delete_messages(
    room_id: str, 
    payload: BulkDeletePayload, 
    user: dict = Depends(get_active_user) 
):
    uid = user.get("uid")
    role = user.get("role", "guest")

    try:
        room_ref = db.collection("chat_rooms").document(room_id)
        if not room_ref.get().exists:
            raise HTTPException(status_code=404, detail="Chat room not found")

        batch = db.batch()
        deleted_count = 0

        for msg_id in payload.message_ids:
            msg_ref = room_ref.collection("messages").document(msg_id)
            msg_doc = msg_ref.get()

            if msg_doc.exists:
                msg_data = msg_doc.to_dict()
                if msg_data.get("sender_id") == uid or role == "admin":
                    batch.delete(msg_ref)
                    deleted_count += 1

        if deleted_count > 0:
            batch.commit()

        return {"message": f"Successfully deleted {deleted_count} messages.", "deleted_ids": payload.message_ids}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

# ==========================================
# 7. HIDE CHAT FROM INBOX (SOFT DELETE)
# ==========================================
@router.put("/{room_id}/hide", tags=["Chat & Bidding"])
async def hide_chat_room(
    room_id: str, 
    user: dict = Depends(get_active_user) 
):
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
    

# ==========================================
# 8. CREATE SUPPORT TICKET
# ==========================================
@router.post("/support/ticket", tags=["Chat & Support"])
async def create_support_ticket(
    payload: TicketCreate, 
    user: dict = Depends(get_current_user) 
):
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        status = user.get("status", "active")
        
        is_banned = (role == "banned" or status == "banned")
        if is_banned:
            existing_tickets = db.collection("chat_rooms")\
                .where("buyer_id", "==", uid)\
                .where("seller_id", "==", "ADMIN_TEAM")\
                .where("status", "==", "open")\
                .limit(1).get()
                
            if existing_tickets:
                raise HTTPException(
                    status_code=403, 
                    detail="You already have an open appeal. Please reply in your existing active ticket."
                )

        ticket_ref = db.collection("chat_rooms").document()
        ticket_ref.set({
            "is_ticket": True,
            "buyer_id": uid, 
            "seller_id": "ADMIN_TEAM",
            "subject": f"📩 SUPPORT: {payload.subject}",
            "last_message": payload.message,
            "status": "open",
            "severity": "low", 
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "last_sender_id": uid
        })
        
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
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 9. REVERT DEAL (Seller Only)
# ==========================================
@router.post("/{room_id}/revert", tags=["Chat & Bidding"])
async def revert_deal(room_id: str, current_user: dict = Depends(get_current_user)):
    """Allows the seller to revert a collapsed deal."""
    try:
        room_ref = db.collection("chat_rooms").document(room_id)
        room = room_ref.get().to_dict()
        
        if not room or room.get("seller_id") != current_user["uid"]:
            raise HTTPException(status_code=403, detail="Only the seller can revert this deal.")

        # 1. Revert the Chat Room
        room_ref.update({"status": "active", "updated_at": firestore.SERVER_TIMESTAMP})

        # 2. Revert the Listing (if applicable)
        if room.get("listing_id"):
            db.collection("listings").document(room["listing_id"]).update({
                "status": "active", 
                "buyer_id": None
            })

        # 3. Drop a System Message
        msg = "🔄 The seller has reverted this deal. The item is back on the market."
        room_ref.collection("messages").add({
            "sender_id": "system", "sender_name": "System", "text": msg,
            "timestamp": firestore.SERVER_TIMESTAMP
        })
        
        return {"message": "Deal reverted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 10. SAVE CHAT CONTACT INFO (Global + Room)
# ==========================================
@router.post("/{room_id}/contact", tags=["Chat & Bidding"])
async def update_chat_contact(room_id: str, payload: ContactUpdate, current_user: dict = Depends(get_current_user)):
    """Saves missing contact info to the user's global profile AND the active chat room."""
    try:
        uid = current_user["uid"]
        room_ref = db.collection("chat_rooms").document(room_id)
        room = room_ref.get().to_dict()

        user_updates = {}
        room_updates = {}

        if payload.phone:
            user_updates["phone"] = payload.phone
            if room.get("buyer_id") == uid: room_updates["buyer_phone"] = payload.phone
            if room.get("seller_id") == uid: room_updates["seller_phone"] = payload.phone

        if payload.upi_id:
            user_updates["upi_id"] = payload.upi_id
            if room.get("seller_id") == uid: room_updates["seller_upi"] = payload.upi_id

        # Update global profile so they never have to type it again
        if user_updates:
            db.collection("users").document(uid).update(user_updates)

        # Update the chat room so the other person sees it instantly
        if room_updates:
            room_ref.update(room_updates)

        return {"message": "Contact info saved!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))