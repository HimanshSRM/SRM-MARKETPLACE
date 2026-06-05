from fastapi import APIRouter, Depends, HTTPException, Request, Query
from google.cloud import firestore
from pydantic import BaseModel
from typing import Optional

from app.core.firebase import db
from app.core.security import get_transacting_user, get_current_user, get_active_user 
from app.models.chat import (
    ChatInitiate, 
    BidStatus,
    BulkDeletePayload,
    TicketCreate ,
    ChatContactUpdate
)

router = APIRouter()

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
    buyer_name = user.get("name") or user.get("email", "Buyer").split("@")[0]

    if sender_id == data.owner_id:
        raise HTTPException(status_code=400, detail="You cannot message yourself.")

    try:
        owner_doc = db.collection("users").document(data.owner_id).get()
        if not owner_doc.exists:
            raise HTTPException(status_code=404, detail="The owner of this listing no longer exists.")
            
        owner_data = owner_doc.to_dict()
        owner_role = owner_data.get("role", "student")
        
        seller_name = owner_data.get("name") or owner_data.get("email", "Seller").split("@")[0]
        
        if owner_role == "shop_verified" and data.bid_amount is not None:
            raise HTTPException(status_code=400, detail="Verified Shops have fixed prices. Bidding is disabled.")

        # 🚨 THE FIX: Smart Title Fetching for Subcollections
        listing_title = "Marketplace Item"
        
        if owner_role == "shop_verified":
            # It's a shop item, look inside the catalog!
            catalog_doc = db.collection("shops").document(data.owner_id).collection("catalog").document(data.listing_id).get()
            if catalog_doc.exists:
                listing_title = catalog_doc.to_dict().get("name", "Shop Item")
        else:
            # It's a normal student item
            listing_doc = db.collection("listings").document(data.listing_id).get()
            if listing_doc.exists:
                l_data = listing_doc.to_dict()
                listing_title = l_data.get("title") or l_data.get("item_name") or "Marketplace Item"

        existing_rooms = db.collection("chat_rooms")\
            .where("buyer_id", "==", sender_id)\
            .where("listing_id", "==", data.listing_id)\
            .where("is_ticket", "==", False)\
            .limit(1).get()
            
        if existing_rooms:
            room_id = existing_rooms[0].id
            room_ref = db.collection("chat_rooms").document(room_id)
        else:
            room_ref = db.collection("chat_rooms").document()
            room_id = room_ref.id
            room_ref.set({
                "listing_id": data.listing_id,
                "listing_title": listing_title, 
                "buyer_id": sender_id,
                "buyer_name": buyer_name,       
                "seller_id": data.owner_id,
                "seller_name": seller_name,     
                "shop_id": data.owner_id if owner_role == "shop_verified" else None, 
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
async def get_user_inbox(
    limit: int = Query(35, le=50), # ✅ PERFECT 35 ITEM LIMIT
    user: dict = Depends(get_current_user)
): 
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        email = user.get("email", "")
        
        # 🚨 THE QUOTA SAVER: Capped streams mapped to updated_at
        raw_buying = list(db.collection("chat_rooms").where("buyer_id", "==", uid)
            .order_by("updated_at", direction=firestore.Query.DESCENDING)
            .limit(limit).stream())
            
        raw_selling = list(db.collection("chat_rooms").where("seller_id", "==", uid)
            .order_by("updated_at", direction=firestore.Query.DESCENDING)
            .limit(limit).stream())
            
        raw_group = list(db.collection("chat_rooms").where("participants", "array_contains", uid)
            .order_by("updated_at", direction=firestore.Query.DESCENDING)
            .limit(limit).stream())
        
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
            
            # 🚨 AUTO-HEALER STEP 1: Grab UIDs for legacy tickets missing names
            if data.get("reported_uid") and not data.get("reported_name"):
                needed_user_ids.add(data.get("reported_uid"))

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
                    user_cache[doc.id] = d.get("name") or d.get("email", "").split("@")[0]

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
                
            # 🚨 AUTO-HEALER STEP 2: Dynamically patch the Inbox UI for old tickets
            if room.get("reported_uid") and not room.get("reported_name"):
                real_name = user_cache.get(room.get("reported_uid"))
                if real_name:
                    room["reported_name"] = real_name
                    if "Chat Participant" in room.get("subject", ""):
                        room["subject"] = f"🚨 USER REPORT: {real_name}"
                        
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
            admin_tickets_query = db.collection("chat_rooms").where("seller_id", "==", "ADMIN_TEAM")\
                .limit(limit).stream()
                
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
async def get_chat_history(
    room_id: str, 
    limit: int = Query(50, le=100), # ✅ SAFEGUARD LIMIT FOR MASSIVE CHATS
    user: dict = Depends(get_current_user)
):
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
        
        # 🚨 THE AUTO-HEALER STEP 3: Permanently fix the database if it finds a corrupted legacy ticket
        if room_data.get("is_ticket") and room_data.get("reported_uid") and not room_data.get("reported_name"):
            reported_user_doc = db.collection("users").document(room_data["reported_uid"]).get()
            if reported_user_doc.exists:
                ru_data = reported_user_doc.to_dict()
                real_name = ru_data.get("name") or ru_data.get("email", "").split("@")[0] or "Unknown User"
                
                room_data["reported_name"] = real_name
                if "Chat Participant" in room_data.get("subject", ""):
                    clean_subject = f"🚨 USER REPORT: {real_name}"
                    room_data["subject"] = clean_subject
                    
                    room_ref.update({
                        "reported_name": real_name,
                        "subject": clean_subject
                    })
                    
                    legacy_tickets = db.collection("tickets").where("chat_room_id", "==", room_id).stream()
                    for t in legacy_tickets:
                        t.reference.update({"subject": clean_subject})
        
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

        # 🚨 OPTIMIZATION: Grabs only the 50 most recent messages instead of potentially thousands
        messages_query = room_ref.collection("messages")\
            .order_by("timestamp", direction=firestore.Query.DESCENDING)\
            .limit(limit).stream()
        
        messages = []
        for doc in messages_query:
            msg = {"id": doc.id, **doc.to_dict()}
            if "timestamp" in msg and msg["timestamp"]:
                msg["timestamp"] = str(msg["timestamp"])
            if "created_at" in msg and msg["created_at"]:
                msg["created_at"] = str(msg["created_at"])
            messages.append(msg)

        # Re-sort to chronological order for the frontend
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

        # 🚨 THE RE-OPEN TICKET UPGRADE
        is_resolved = room_data.get("status") == "resolved"
        if room_data.get("is_ticket") and is_resolved and not is_admin_support:
            room_ref.update({"status": "open"})
            tickets = db.collection("tickets").where("chat_room_id", "==", room_id).stream()
            for t in tickets:
                t.reference.update({"status": "open"})

        is_banned = (role == "banned" or status == "banned")
        if is_banned:
            if room_data.get("seller_id") != "ADMIN_TEAM":
                raise HTTPException(status_code=403, detail="Suspended accounts can only reply in official Admin Support threads.")
            
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
                    
                    room_ref.update({
                        "last_message": auto_reply_text,
                        "last_sender_id": seller_id,
                        "updated_at": firestore.SERVER_TIMESTAMP,
                        "hidden_by": []
                    })
                    
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
        room_ref.update({"status": "sold"}) 
        
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
# 8. CREATE USER REPORT TICKET (DEDICATED MODERATION ROUTE)
# ==========================================
@router.post("/support/ticket", tags=["Chat & Support"])
async def create_user_report_ticket(
    payload: TicketCreate, 
    user: dict = Depends(get_current_user) 
):
    """STRICTLY handles User Reporting & Moderation."""
    try:
        uid = user.get("uid")
        buyer_name = user.get("name") or user.get("email", "User").split("@")[0]
        
        reported_uid = getattr(payload, "reported_uid", None)
        message_content = getattr(payload, "message", getattr(payload, "description", "No details provided."))
        
        if not reported_uid:
            raise HTTPException(status_code=400, detail="Missing reported_uid. General Support must use the dedicated support route.")

        reported_name = "Unknown User"
        target_ref = db.collection("users").document(reported_uid)
        target_doc = target_ref.get()
        
        if target_doc.exists:
            t_data = target_doc.to_dict()
            reported_name = t_data.get("name") or t_data.get("email", "").split("@")[0] or "Unknown User"
            reported_by = t_data.get("reported_by", [])
            
            # 🚨 ESCALATION: User reporting the same person twice
            if uid in reported_by:
                user_tickets = db.collection("chat_rooms").where("buyer_id", "==", uid).where("is_ticket", "==", True).stream()
                
                for t in user_tickets:
                    if t.to_dict().get("reported_uid") == reported_uid:
                        t.reference.update({
                            "status": "open",
                            "updated_at": firestore.SERVER_TIMESTAMP,
                            "last_message": f"🚨 ESCALATED: Reporter added new info.",
                            "severity": "high"
                        })
                        
                        t.reference.collection("messages").add({
                            "sender_id": "ADMIN_SYSTEM",
                            "text": f"📥 The Reporter escalated this ticket with additional context:\n\n{message_content}",
                            "is_system_message": True,
                            "timestamp": firestore.SERVER_TIMESTAMP
                        })
                        
                        admin_tickets = db.collection("tickets").where("chat_room_id", "==", t.id).limit(1).stream()
                        for at in admin_tickets:
                            at.reference.update({
                                "status": "open",
                                "updated_at": firestore.SERVER_TIMESTAMP
                            })
                            
                        raise HTTPException(status_code=400, detail="You have already reported this user. We have escalated your previous report to the top of the Admin queue.")
                
                raise HTTPException(status_code=400, detail="You have already reported this user.")
            
            reported_by.append(uid)
            target_ref.update({
                "reported_by": reported_by,
                "report_count": len(reported_by)
            })

        final_subject = f"🚨 USER REPORT: {reported_name}"

        room_data = {
            "is_ticket": True,
            "buyer_id": uid, 
            "buyer_name": buyer_name,     
            "seller_id": "ADMIN_TEAM",
            "seller_name": "Admin Team",  
            "subject": final_subject,
            "last_message": message_content,
            "status": "open",
            "severity": "high", 
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "last_sender_id": uid,
            "reported_uid": reported_uid,
            "reported_name": reported_name,
            "listing_id": "USER_MODERATION"
        }

        ticket_ref = db.collection("chat_rooms").document()
        ticket_ref.set(room_data)
        
        ticket_ref.collection("messages").add({
            "sender_id": uid,
            "text": message_content,
            "is_bid": False,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP
        })
        
        admin_ticket_ref = db.collection("tickets").document()
        admin_ticket_ref.set({
            "id": admin_ticket_ref.id,
            "owner_id": uid,
            "user_email": user.get("email"), 
            "subject": final_subject,
            "description": message_content, 
            "reference_id": "USER_MODERATION",
            "reference_type": "user_report", 
            "status": "open",
            "chat_room_id": ticket_ref.id,
            "created_at": firestore.SERVER_TIMESTAMP
        })
        
        return {
            "message": "User reported successfully.", 
            "ticket_id": admin_ticket_ref.id, 
            "chat_room_id": ticket_ref.id
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

        room_ref.update({"status": "active", "updated_at": firestore.SERVER_TIMESTAMP})

        if room.get("listing_id"):
            db.collection("listings").document(room["listing_id"]).update({
                "status": "active", 
                "buyer_id": None
            })

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
async def update_chat_contact(room_id: str, payload: ChatContactUpdate, current_user: dict = Depends(get_current_user)):
    """Saves contact info to the active chat room, and updates the global profile IF save_as_default is True."""
    try:
        uid = current_user["uid"]
        room_ref = db.collection("chat_rooms").document(room_id)
        room = room_ref.get().to_dict()

        user_updates = {}
        room_updates = {}

        if payload.phone:
            if room.get("buyer_id") == uid: room_updates["buyer_phone"] = payload.phone
            if room.get("seller_id") == uid: room_updates["seller_phone"] = payload.phone
            if payload.save_as_default: 
                user_updates["phone"] = payload.phone

        if payload.upi_id:
            if room.get("seller_id") == uid: room_updates["seller_upi"] = payload.upi_id
            if payload.save_as_default: 
                user_updates["upi_id"] = payload.upi_id

        # ✅ Cleanly fixed the syntax error here
        if user_updates and payload.save_as_default:
            db.collection("users").document(uid).update(user_updates) 

        if room_updates:
            room_ref.update(room_updates)

        return {"message": "Contact info saved!", "saved_as_default": payload.save_as_default}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))