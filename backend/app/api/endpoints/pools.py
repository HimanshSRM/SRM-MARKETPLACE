from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from pydantic import BaseModel, HttpUrl
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import uuid

from app.core.security import get_current_user
from app.core.firebase import db, firestore
from google.cloud.firestore import ArrayUnion, ArrayRemove

router = APIRouter()

# ==========================================
# HYBRID SCHEMAS
# ==========================================
class PoolCreate(BaseModel):
    app_name: str
    pickup_location: str
    contact_number: str
    expires_in_minutes: int
    upi_id: str                 # 🚨 REQUIRED for automatic split payments
    cart_link: str = ""         # 🚨 NEW: Optional Master Cart Link

class PoolItem(BaseModel):
    item_name: str
    quantity: int
    estimated_price: float

class PoolJoin(BaseModel):
    contact_number: str
    block: str = ""
    cart_link: str = ""         # 🚨 NEW: The Link-First approach
    items: List[PoolItem] = []  # Fallback for manual typed items

class PoolStatusUpdate(BaseModel):
    status: str 
    delivery_fee: float = 0.0   # Delivery fee to split among participants

class ParticipantPriceUpdate(BaseModel):
    new_price: float

# 🚨 NEW: Schema for Live Tracking
class TrackingLinkUpdate(BaseModel):
    tracking_url: str


# ==========================================
# GET FEEDS (Active & Past)
# ==========================================
@router.get("/")
async def get_active_pools(current_user: dict = Depends(get_current_user)):
    """Fetches Open public pools AND any pool (Locked/Delivered) the user is involved in."""
    try:
        uid = current_user["uid"]
        active_pools = {}
        now = datetime.now(timezone.utc)
        
        # 1. Get ALL Open Pools (For the Discover Feed)
        open_pools = db.collection("group_orders").where("status", "==", "open").stream()
        for p in open_pools:
            pool_data = p.to_dict()
            pool_data["id"] = p.id
            
            # Check expiration locally
            expires_at = datetime.fromisoformat(pool_data["expires_at"].replace("Z", "+00:00"))
            if expires_at < now:
                db.collection("group_orders").document(p.id).update({"status": "locked"})
                pool_data["status"] = "locked" 
            
            active_pools[p.id] = pool_data
            
        # 2. Get Locked/Delivered Pools where I am the HOST
        hosted_pools = db.collection("group_orders").where("host_id", "==", uid).where("status", "in", ["locked", "delivered"]).stream()
        for p in hosted_pools:
            pool_data = p.to_dict()
            pool_data["id"] = p.id
            active_pools[p.id] = pool_data
            
        # 3. Get Locked/Delivered Pools where I am a JOINER
        joined_pools = db.collection("group_orders").where("participant_ids", "array_contains", uid).where("status", "in", ["locked", "delivered"]).stream()
        for p in joined_pools:
            pool_data = p.to_dict()
            pool_data["id"] = p.id
            active_pools[p.id] = pool_data
            
        return list(active_pools.values())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/past", tags=["Group Orders"])
async def get_past_pools(
    limit: int = Query(15, le=30),
    cursor: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """Safely paginates a user's delivered, settled, and cancelled order history."""
    try:
        uid = current_user["uid"]
        
        query = db.collection("group_orders")\
            .where("participant_ids", "array_contains", uid)\
            .where("status", "in", ["delivered", "settled", "cancelled"])\
            .order_by("created_at", direction=firestore.Query.DESCENDING)

        if cursor:
            cursor_doc = db.collection("group_orders").document(cursor).get()
            if cursor_doc.exists:
                query = query.start_after(cursor_doc)

        docs = query.limit(limit).stream()
        
        results = []
        last_doc_id = None
        
        for doc in docs:
            pool_data = doc.to_dict()
            pool_data["id"] = doc.id
            results.append(pool_data)
            last_doc_id = doc.id
            
        return {
            "data": results,
            "next_cursor": last_doc_id if len(results) == limit else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# CREATE & JOIN
# ==========================================
@router.post("/")
async def create_group_order(pool_data: PoolCreate, current_user: dict = Depends(get_current_user)):
    try:
        pool_id = f"pool_{uuid.uuid4().hex[:12]}"
        chat_room_id = f"room_{uuid.uuid4().hex[:12]}"
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=pool_data.expires_in_minutes)
        user_name = current_user.get("name", current_user.get("email", "Campus Member").split("@")[0])

        # Initialize the Group Chat
        chat_data = {
            "type": "group_order", 
            "pool_id": pool_id, 
            "app_name": pool_data.app_name,
            "participants": [current_user["uid"]], 
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(), 
            "last_message": "Group order chat created.",
            "upi_id": pool_data.upi_id,
            "host_name": user_name,
            "pickup_location": pool_data.pickup_location,
            "cart_link": pool_data.cart_link
        }
        db.collection("chat_rooms").document(chat_room_id).set(chat_data)

        # Initialize the Pool
        new_pool = {
            "host_id": current_user["uid"], "host_name": user_name, "app_name": pool_data.app_name,
            "pickup_location": pool_data.pickup_location, "contact_number": pool_data.contact_number,
            "upi_id": pool_data.upi_id,            
            "cart_link": pool_data.cart_link,      
            "delivery_fee": 0.0,                   
            "status": "open", "expires_at": expires_at.isoformat(), "chat_room_id": chat_room_id,
            "participants": [], 
            "participant_ids": [current_user["uid"]], 
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        db.collection("group_orders").document(pool_id).set(new_pool)
        new_pool["id"] = pool_id
        return new_pool
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{pool_id}/join")
async def join_group_order(
    pool_id: str, 
    payload: PoolJoin, 
    request: Request, 
    current_user: dict = Depends(get_current_user)
):
    try:
        pool_ref = db.collection("group_orders").document(pool_id)
        pool_doc = pool_ref.get()
        if not pool_doc.exists: raise HTTPException(status_code=404, detail="Order not found.")
            
        pool = pool_doc.to_dict()
        if pool["status"] != "open": raise HTTPException(status_code=400, detail="Order is locked.")

        user_name = current_user.get("name", current_user.get("email", "Campus Member").split("@")[0])
        total_price = sum(item.estimated_price * item.quantity for item in payload.items)

        new_participant = {
            "user_id": current_user["uid"], 
            "user_name": user_name, 
            "contact_number": payload.contact_number,
            "block": payload.block,
            "cart_link": payload.cart_link, 
            "items": [item.model_dump() for item in payload.items], 
            "total_estimated_price": total_price,
            "added_at": datetime.now(timezone.utc).isoformat()
        }

        # Update Pool Data
        pool_ref.update({
            "participants": ArrayUnion([new_participant]),
            "participant_ids": ArrayUnion([current_user["uid"]])
        })
        
        # Add to Chat Room & Send System Message
        chat_ref = db.collection("chat_rooms").document(pool["chat_room_id"])
        chat_ref.update({"participants": ArrayUnion([current_user["uid"]])})
        
        added_text = ""
        if payload.cart_link:
            added_text = f"Added a Shared Cart Link: {payload.cart_link}"
        else:
            items_str = ", ".join([f"{i.quantity}x {i.item_name}" for i in payload.items])
            added_text = f"Added manually: {items_str} (Est. ₹{total_price})"

        msg = f"👋 {user_name} joined from {payload.block}!\n{added_text}"
        chat_ref.collection("messages").add({
            "sender_id": "system", "sender_name": "Cart Pool Bot", "text": msg, 
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        chat_ref.update({"last_message": msg, "updated_at": datetime.now(timezone.utc).isoformat()})

        if pool.get("host_id") and pool["host_id"] != current_user["uid"]:
            await request.app.state.redis.enqueue_job(
                'process_push_notification',
                pool["host_id"], 
                f"🛒 Someone joined your {pool['app_name']} pool!", 
                f"{user_name} just added items to your order list.", 
                f"/chat/{pool['chat_room_id']}" 
            )

        return {"message": "Joined successfully!"}
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


@router.put("/{pool_id}/participants/me", tags=["Group Orders"])
async def update_my_cart(
    pool_id: str,
    payload: PoolJoin,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """Allows a joiner to edit their cart link or manual items before the order is locked."""
    try:
        pool_ref = db.collection("group_orders").document(pool_id)
        pool_doc = pool_ref.get()
        if not pool_doc.exists: 
            raise HTTPException(status_code=404, detail="Order not found.")

        pool = pool_doc.to_dict()
        if pool["status"] != "open": 
            raise HTTPException(status_code=400, detail="Cannot edit. Order is already locked.")

        uid = current_user["uid"]
        participants = pool.get("participants", [])

        # Find the user's specific entry in the array
        participant_index = next((i for i, p in enumerate(participants) if p["user_id"] == uid), None)
        if participant_index is None:
            raise HTTPException(status_code=404, detail="You are not in this order.")

        user_name = participants[participant_index]["user_name"]
        total_price = sum(item.estimated_price * item.quantity for item in payload.items)

        # Update their specific data
        participants[participant_index].update({
            "contact_number": payload.contact_number,
            "block": payload.block,
            "cart_link": payload.cart_link,
            "items": [item.model_dump() for item in payload.items],
            "total_estimated_price": total_price
        })

        pool_ref.update({
            "participants": participants,
            "updated_at": firestore.SERVER_TIMESTAMP
        })

        # Send an automated chat message about the update
        chat_ref = db.collection("chat_rooms").document(pool["chat_room_id"])
        added_text = f"Updated to Shared Cart Link: {payload.cart_link}" if payload.cart_link else f"Updated manual items (Est. ₹{total_price})"
        msg = f"🔄 {user_name} updated their cart!\n{added_text}"
        
        chat_ref.collection("messages").add({
            "sender_id": "system", "sender_name": "Cart Pool Bot", "text": msg, 
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        chat_ref.update({"last_message": msg, "updated_at": datetime.now(timezone.utc).isoformat()})

        return {"message": "Cart updated successfully!"}

    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# STATUS & MODIFICATIONS (Host Only)
# ==========================================
@router.put("/{pool_id}/status")
async def update_pool_status(
    pool_id: str, 
    payload: PoolStatusUpdate, 
    request: Request, 
    current_user: dict = Depends(get_current_user)
):
    try:
        pool_ref = db.collection("group_orders").document(pool_id)
        pool_doc = pool_ref.get()
        if not pool_doc.exists: raise HTTPException(status_code=404, detail="Order not found.")
        pool = pool_doc.to_dict()
        
        if pool["host_id"] != current_user["uid"]:
            raise HTTPException(status_code=403, detail="Only the Host can update status.")

        update_data = {
            "status": payload.status,
            "delivery_fee": payload.delivery_fee
        }
        
        # Send Automated Bot Message
        chat_ref = db.collection("chat_rooms").document(pool["chat_room_id"])
        system_text = ""
        push_title = ""
        push_body = ""
        
        if payload.status == "locked": 
            fee_text = f" (Delivery Fee: ₹{payload.delivery_fee})" if payload.delivery_fee > 0 else ""
            system_text = f"🔒 Order Locked! The Host is placing the order now.{fee_text}"
            push_title = f"🔒 {pool['app_name']} Pool Locked!"
            push_body = f"The host is checking out your cart items now.{fee_text}"
            
        elif payload.status == "delivered": 
            system_text = f"🛎️ ORDER ARRIVED! Meet at {pool['pickup_location']}."
            push_title = f"🛎️ {pool['app_name']} Order Has Arrived!"
            push_body = f"Please collect your items immediately from {pool['pickup_location']}."
            
        elif payload.status == "cancelled": 
            system_text = "❌ The Host has cancelled this group order."
            push_title = f"❌ {pool['app_name']} Pool Cancelled"
            push_body = "The host has closed this pool. Your item requests have been cancelled."
            # THE SELF-DESTRUCT TIMER (24 Hours from now)
            delete_at = datetime.now(timezone.utc) + timedelta(hours=24)
            update_data["delete_at"] = delete_at    

        # Write updates to database
        pool_ref.update(update_data)    

        if system_text:
            chat_ref.collection("messages").add({
                "sender_id": "system", "sender_name": "Cart Pool Bot", "text": system_text, 
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            chat_ref.update({"last_message": system_text, "updated_at": datetime.now(timezone.utc).isoformat()})

        # 🚨 TRIGGER REDIS ALERTS TO ALL JOINERS IN THE BACKGROUND
        participant_ids = pool.get("participant_ids", [])
        if participant_ids and push_title:
            for uid in participant_ids:
                if uid != current_user["uid"]: # Don't notify the host themselves
                    await request.app.state.redis.enqueue_job(
                        'process_push_notification',
                        uid,
                        push_title,
                        push_body,
                        f"/chat/{pool['chat_room_id']}"
                    )

        return {"status": payload.status}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


# 🚨 NEW: The LIVE TRACKING Update Route
@router.put("/{pool_id}/tracking", tags=["Group Orders"])
async def update_pool_tracking(
    pool_id: str, 
    payload: TrackingLinkUpdate, 
    current_user: dict = Depends(get_current_user)
):
    """Allows the Host to optionally share a live tracking link."""
    try:
        pool_ref = db.collection("group_orders").document(pool_id)
        pool_doc = pool_ref.get()
        if not pool_doc.exists: 
            raise HTTPException(status_code=404, detail="Order not found.")
        
        pool = pool_doc.to_dict()

        if pool["host_id"] != current_user["uid"]:
            raise HTTPException(status_code=403, detail="Only the Host can update the tracking link.")

        # Update the database
        pool_ref.update({
            "tracking_url": payload.tracking_url,
            "updated_at": firestore.SERVER_TIMESTAMP
        })

        # Drop a notification in the group chat
        chat_ref = db.collection("chat_rooms").document(pool["chat_room_id"])
        msg = "📍 The Host has added a live tracking link for the delivery! Check your pool dashboard."
        
        chat_ref.collection("messages").add({
            "sender_id": "system", 
            "sender_name": "Cart Pool Bot", 
            "text": msg,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        chat_ref.update({"last_message": msg, "updated_at": datetime.now(timezone.utc).isoformat()})

        return {"message": "Tracking link broadcasted!"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{pool_id}/participants/{user_id}/price")
async def update_participant_price(
    pool_id: str,
    user_id: str,
    payload: ParticipantPriceUpdate,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """Allows the Host to securely override a joiner's total cart value based on the final app checkout."""
    try:
        pool_ref = db.collection("group_orders").document(pool_id)
        pool_doc = pool_ref.get()
        if not pool_doc.exists:
            raise HTTPException(status_code=404, detail="Order not found.")

        pool = pool_doc.to_dict()

        # Security: Only the Host can edit prices
        if pool.get("host_id") != current_user["uid"]:
            raise HTTPException(status_code=403, detail="Only the Host can edit participant prices.")

        # Find the specific participant
        participants = pool.get("participants", [])
        target_participant = next((p for p in participants if p["user_id"] == user_id), None)

        if not target_participant:
            raise HTTPException(status_code=404, detail="Participant not found in this order.")

        # Save old price for transparency logging
        old_price = target_participant.get("total_estimated_price", 0)
        target_participant["total_estimated_price"] = payload.new_price

        # Push back the modified array
        pool_ref.update({
            "participants": participants,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })

        # Send Transparency Audit Message to the Group Chat
        chat_ref = db.collection("chat_rooms").document(pool["chat_room_id"])
        msg = f"🤖 Note: The Host updated {target_participant['user_name']}'s total from ₹{old_price} to ₹{payload.new_price} based on the final checkout."
        
        chat_ref.collection("messages").add({
            "sender_id": "system",
            "sender_name": "Cart Pool Bot",
            "text": msg,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        chat_ref.update({
            "last_message": msg, 
            "updated_at": datetime.now(timezone.utc).isoformat()
        })

        return {"message": "Participant price updated successfully.", "new_price": payload.new_price}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{pool_id}/participants/{user_id}")
async def kick_participant(
    pool_id: str, 
    user_id: str, 
    request: Request, 
    current_user: dict = Depends(get_current_user)
):
    """Allows the Host to remove a user from an open group order."""
    try:
        pool_ref = db.collection("group_orders").document(pool_id)
        pool_doc = pool_ref.get()
        if not pool_doc.exists: 
            raise HTTPException(status_code=404, detail="Order not found.")
        
        pool = pool_doc.to_dict()
        
        # Security: Only the Host can kick people
        if pool["host_id"] != current_user["uid"]:
            raise HTTPException(status_code=403, detail="Only the Host can remove participants.")
            
        # Security: Cannot kick after the order is locked
        if pool["status"] != "open":
            raise HTTPException(status_code=400, detail="Cannot remove users after the order is locked.")

        participants = pool.get("participants", [])
        participant_ids = pool.get("participant_ids", [])

        kicked_user = next((p for p in participants if p["user_id"] == user_id), None)
        if not kicked_user:
            raise HTTPException(status_code=404, detail="User is not in this order.")

        updated_participants = [p for p in participants if p["user_id"] != user_id]
        updated_participant_ids = [uid for uid in participant_ids if uid != user_id]

        pool_ref.update({
            "participants": updated_participants,
            "participant_ids": updated_participant_ids
        })

        chat_ref = db.collection("chat_rooms").document(pool["chat_room_id"])
        chat_ref.update({"participants": ArrayRemove([user_id])})

        msg = f"🚫 {kicked_user['user_name']} was removed from the order."
        chat_ref.collection("messages").add({
            "sender_id": "system", 
            "sender_name": "Cart Pool Bot", 
            "text": msg, 
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        chat_ref.update({"last_message": msg, "updated_at": datetime.now(timezone.utc).isoformat()})

        # 🚨 TRIGGER REDIS BACKGROUND ALERT TO THE KICKED USER
        await request.app.state.redis.enqueue_job(
            'process_push_notification',
            user_id,
            f"🚫 Removed from {pool['app_name']} Pool",
            "The host has removed you from the active cart order list.",
            "/inbox"
        )

        return {"message": f"Successfully removed {kicked_user['user_name']}"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{pool_id}/settle")
async def settle_group_order(
    pool_id: str, 
    request: Request, 
    current_user: dict = Depends(get_current_user)
):
    """Closes the order and archives it."""
    try:
        pool_ref = db.collection("group_orders").document(pool_id)
        pool_doc = pool_ref.get()
        if not pool_doc.exists: raise HTTPException(status_code=404, detail="Order not found.")
        pool = pool_doc.to_dict()

        if pool["host_id"] != current_user["uid"]:
            raise HTTPException(status_code=403, detail="Only the Host can settle the order.")

        if pool["status"] != "delivered":
            raise HTTPException(status_code=400, detail="Order must be marked as 'Delivered' before settling.")

        pool_ref.update({
            "status": "settled", 
            "settled_at": datetime.now(timezone.utc).isoformat()
        })

        chat_ref = db.collection("chat_rooms").document(pool["chat_room_id"])
        msg = "✅ This order has been settled and closed by the Host."

        chat_ref.collection("messages").add({
            "sender_id": "system", "sender_name": "Cart Pool Bot", "text": msg,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        chat_ref.update({"last_message": msg, "updated_at": datetime.now(timezone.utc).isoformat()})

        participant_ids = pool.get("participant_ids", [])
        if participant_ids:
            for uid in participant_ids:
                if uid != current_user["uid"]: 
                    await request.app.state.redis.enqueue_job(
                        'process_push_notification',
                        uid,
                        f"✅ {pool['app_name']} Pool Settled",
                        "The host has officially closed the order. Thanks for pooling!",
                        "/inbox"
                    )

        return {"message": "Order settled successfully."}
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))