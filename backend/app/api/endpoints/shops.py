from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from google.cloud import firestore

from app.core.firebase import db
from app.core.security import get_current_user, get_marketplace_user, get_active_user
from app.models.shop import ShopCreate, CatalogItemCreate, ShopProfileUpdate
from app.models.admin import ReportCreate
from app.models.shop import ShopStatusUpdate, ShopNoticeUpdate, FlashDealCreate, QuickReplyUpdate

router = APIRouter()

# ==========================================
# 1. PRIVATE ROUTES & DASHBOARD
# ==========================================

@router.get("/me", tags=["Shops - Private"])
async def check_my_shop_status(user: dict = Depends(get_current_user)):
    """Silently checks if the user already has a shop profile."""
    try:
        uid = user.get("uid")
        auth_email = user.get("email") 

        shop_doc = db.collection("shops").document(uid).get()
        if shop_doc.exists:
            return {"has_shop": True, "shop_data": shop_doc.to_dict()}

        if auth_email:
            email_query = db.collection("shops").where("owner_email", "==", auth_email).limit(1).stream()
            existing_shop = next(email_query, None)
            if existing_shop:
                return {"has_shop": True, "shop_data": existing_shop.to_dict()}

        return {"has_shop": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create", tags=["Shops - Private"])
async def create_shop_profile(shop_data: ShopCreate, overwrite: bool = False, user: dict = Depends(get_current_user)):
    """Creates a shop profile. Cleans up old subcollections if starting fresh."""
    try:
        uid = user.get("uid")
        auth_email = user.get("email") 
        shop_ref = db.collection("shops").document(uid)
        shop_doc = shop_ref.get()
        
        if shop_doc.exists:
            if not overwrite:
                return {"status": "exists", "shop_data": shop_doc.to_dict()}
            else:
                catalog_docs = shop_ref.collection("catalog").stream()
                batch = db.batch()
                deleted_count = 0
                
                for doc in catalog_docs:
                    batch.delete(doc.reference)
                    deleted_count += 1
                    
                if deleted_count > 0:
                    batch.commit()

        shop_dict = shop_data.model_dump()
        shop_dict.update({
            "owner_id": uid,
            "owner_email": auth_email,
            "status": "pending",
            "is_verified": False,
            "is_open": False,
            "quick_replies": [], 
            "live_notice": {"text": "", "is_active": False}, 
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        shop_ref.set(shop_dict)
        return {"status": "success", "message": "Shop application submitted!", "shop_id": uid}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restore", tags=["Shops - Private"])
async def restore_shop_profile(user: dict = Depends(get_current_user)):
    """Reactivates a rejected shop and sends it back to the admin for review."""
    try:
        uid = user.get("uid")
        shop_ref = db.collection("shops").document(uid)
        shop_doc = shop_ref.get()
        
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail="Shop not found.")
            
        shop_ref.update({
            "status": "pending",
            "is_verified": False,
            "rejection_reason": firestore.DELETE_FIELD,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        return {"message": "Shop application successfully resubmitted for review!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{shop_id}/profile", tags=["Shops - Private"])
async def update_shop_profile(shop_id: str, payload: ShopProfileUpdate, user: dict = Depends(get_active_user)):
    """Allows a verified shop owner to update their business details and alerts Admin if restricted."""
    uid = user.get("uid")
    
    if uid != shop_id and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Permission denied.")
        
    try:
        shop_ref = db.collection("shops").document(shop_id)
        shop_doc = shop_ref.get()
        
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail="Shop not found.")
            
        shop_data = shop_doc.to_dict()
        current_status = shop_data.get("status")
            
        update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
        if update_data:
            update_data["updated_at"] = firestore.SERVER_TIMESTAMP
            shop_ref.update(update_data)
            
        # 🚨 THE MODERATION LOOP: Alert Admin if editing a rejected or suspended shop profile
        if current_status in ["rejected", "suspended"]:
            # Query by buyer_id only, filter the rest in Python to prevent crash
            tickets = db.collection("chat_rooms").where("buyer_id", "==", uid).stream()
                
            latest_ticket = None
            latest_time = None
            
            for t in tickets:
                t_data = t.to_dict()
                if t_data.get("is_ticket") == True and t_data.get("seller_id") == "ADMIN_TEAM":
                    t_time = t_data.get("updated_at") or t_data.get("created_at")
                    if not latest_time or (t_time and t_time > latest_time):
                        latest_time = t_time
                        latest_ticket = t
                    
            if latest_ticket:
                room_ref = latest_ticket.reference
                
                # Pop the thread back into the Admin's "Needs Reply" inbox
                room_ref.update({
                    "status": "open",
                    "last_message": "🔄 Shop Owner updated their business profile for review.",
                    "updated_at": firestore.SERVER_TIMESTAMP,
                    "last_sender_id": uid 
                })
                
                # Drop an automated system alert inside the chat
                room_ref.collection("messages").add({
                    "sender_id": "ADMIN_SYSTEM",
                    "text": "🔄 **SYSTEM ALERT:** The shop owner has updated their business profile details.\n\nPlease review the changes. If the shop now complies with campus guidelines, you can approve/restore their access.",
                    "is_system_message": True,
                    "is_bid": False,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                    "created_at": firestore.SERVER_TIMESTAMP
                })

        return {"message": "Shop profile updated successfully!"}
        
    except HTTPException:
        raise
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 2. CATALOG MANAGEMENT (SUBCOLLECTION ARCHITECTURE)
# ==========================================

@router.post("/catalog/add", tags=["Shops - Private"])
async def add_catalog_item(item: CatalogItemCreate, user: dict = Depends(get_active_user)):
    try:
        if user.get("role") != "shop_verified":
            raise HTTPException(status_code=403, detail="Unauthorized.")

        uid = user.get("uid")
        item_dict = item.model_dump()
        
        catalog_ref = db.collection("shops").document(uid).collection("catalog").document()
        
        item_dict["id"] = catalog_ref.id
        item_dict["status"] = "active"
        item_dict["created_at"] = firestore.SERVER_TIMESTAMP
        item_dict["updated_at"] = firestore.SERVER_TIMESTAMP
        
        catalog_ref.set(item_dict)
        
        return {"message": "Item added!", "item_id": catalog_ref.id}
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/catalog/{item_id}", tags=["Shops - Private"])
async def delete_catalog_item(item_id: str, user: dict = Depends(get_active_user)):
    try:
        if user.get("role") != "shop_verified":
            raise HTTPException(status_code=403, detail="Unauthorized.")

        uid = user.get("uid")
        item_ref = db.collection("shops").document(uid).collection("catalog").document(item_id)
        
        if not item_ref.get().exists:
            raise HTTPException(status_code=404, detail="Item not found.")

        item_ref.delete()
        return {"message": "Item deleted."}
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/catalog/{item_id}", tags=["Shops - Private"])
async def update_catalog_item(
    item_id: str, 
    request: Request, 
    user: dict = Depends(get_active_user)
):
    """Updates a catalog item and alerts Admins if it was restricted."""
    try:
        # Suspended shops get downgraded to "guest", but they MUST be allowed to edit their own catalog.
        payload = await request.json()
        uid = user.get("uid")
        
        item_ref = db.collection("shops").document(uid).collection("catalog").document(item_id)
        item_doc = item_ref.get()
        
        if not item_doc.exists:
            raise HTTPException(status_code=404, detail="Item not found in catalog.")
            
        item_data = item_doc.to_dict()
        current_status = item_data.get("status", "active")
        
        safe_update_data = {
            k: v for k, v in payload.items() 
            if k in ["title", "name", "description", "price", "category", "image_url", "in_stock", "is_available"]
        }
        
        if current_status in ["suspended", "hidden"]:
            # If Admin hid it, the seller cannot force it back online
            safe_update_data.pop("is_available", None)
            safe_update_data.pop("status", None)
        
        db_payload = safe_update_data.copy()
        db_payload["updated_at"] = firestore.SERVER_TIMESTAMP
        
        if db_payload:
            item_ref.update(db_payload)
            
        # 🚨 THE MODERATION LOOP: Alert Admin if editing a restricted catalog item
        if current_status in ["suspended", "hidden"]:
            # Query by listing_id only, filter the rest in Python to prevent crash
            tickets = db.collection("chat_rooms").where("listing_id", "==", item_id).stream()

            for t in tickets:
                t_data = t.to_dict()
                if t_data.get("is_ticket") == True and t_data.get("seller_id") == "ADMIN_TEAM":
                    room_ref = t.reference
                    room_ref.update({
                        "status": "open",
                        "last_message": "🔄 Shop Owner updated the restricted item for review.",
                        "updated_at": firestore.SERVER_TIMESTAMP,
                        "last_sender_id": uid 
                    })
                    room_ref.collection("messages").add({
                        "sender_id": "ADMIN_SYSTEM",
                        "text": "🔄 **SYSTEM ALERT:** The shop owner has edited the details of this restricted catalog item.\n\nPlease review. If it now complies with the rules, use the Quick Restore button.",
                        "is_system_message": True,
                        "is_bid": False,
                        "timestamp": firestore.SERVER_TIMESTAMP,
                        "created_at": firestore.SERVER_TIMESTAMP
                    })
                    break # Stop looping once the admin ticket is found

        return {"message": "Item updated successfully!"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))   


# ==========================================
# 3. ADVANCED SHOP FEATURES (UX & Communication)
# ==========================================

@router.put("/status", tags=["Shops - Private"])
async def update_shop_status(payload: ShopStatusUpdate, user: dict = Depends(get_active_user)):
    try:
        if user.get("role") != "shop_verified": raise HTTPException(status_code=403, detail="Unauthorized.")
        db.collection("shops").document(user.get("uid")).update({"is_open": payload.is_open})
        return {"message": f"Shop is now {'Open' if payload.is_open else 'Closed'}"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


@router.put("/notice", tags=["Shops - Private"])
async def update_live_notice(payload: ShopNoticeUpdate, user: dict = Depends(get_active_user)):
    try:
        if user.get("role") != "shop_verified": raise HTTPException(status_code=403, detail="Unauthorized.")
        db.collection("shops").document(user.get("uid")).update({"live_notice": payload.model_dump()})
        return {"message": "Live notice updated!"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


@router.put("/quick-replies", tags=["Shops - Private"])
async def update_quick_replies(payload: QuickReplyUpdate, user: dict = Depends(get_active_user)):
    try:
        if user.get("role") != "shop_verified": raise HTTPException(status_code=403, detail="Unauthorized.")
        db.collection("shops").document(user.get("uid")).update({"quick_replies": payload.quick_replies})
        return {"message": "Quick replies updated!"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


@router.post("/flash-deal", tags=["Shops - Private"])
async def trigger_flash_deal(deal: FlashDealCreate, request: Request, user: dict = Depends(get_active_user)):
    try:
        if user.get("role") != "shop_verified":
            raise HTTPException(status_code=403, detail="Unauthorized.")

        uid = user.get("uid")
        shop_ref = db.collection("shops").document(uid)
        shop_doc = shop_ref.get()
        
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail="Shop not found.")
            
        shop_name = shop_doc.to_dict().get("shop_name", "A Campus Shop")

        expires_at = datetime.now(timezone.utc) + timedelta(hours=deal.duration_hours)
        
        shop_ref.update({
            "active_deal": {
                "item_name": deal.item_name,
                "original_price": deal.original_price,
                "deal_price": deal.deal_price,
                "expires_at": expires_at.isoformat()
            },
            "updated_at": firestore.SERVER_TIMESTAMP
        })

        # 🚨 THE REDIS FIX: Hands off the heavy lifting to the Python worker
        if hasattr(request.app.state, "redis"):
            try:
                await request.app.state.redis.enqueue_job(
                    'broadcast_flash_deal',
                    shop_name,
                    deal.item_name,
                    str(deal.deal_price),
                    str(deal.original_price)
                )
            except Exception as e:
                # Log to server console silently without breaking the user flow
                print(f"⚠️ Redis Flash Deal Broadcast failed. Error: {e}")

        return {"message": "Flash Deal Broadcasted & Live on Directory!"}
    except HTTPException:
        raise
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 4. PUBLIC ROUTES & TRUST & SAFETY
# ==========================================

@router.post("/{shop_id}/catalog/{item_id}/report", tags=["Shops - Public", "Trust & Safety"])
async def report_shop_item(shop_id: str, item_id: str, payload: ReportCreate, user: dict = Depends(get_active_user)):
    try:
        uid = user.get("uid")
        
        item_ref = db.collection("shops").document(shop_id).collection("catalog").document(item_id)
        item_doc = item_ref.get()
        
        if not item_doc.exists: 
            raise HTTPException(status_code=404, detail="Item not found.")
        
        item_data = item_doc.to_dict()
        reported_by = item_data.get("reported_by", [])
        
        if uid in reported_by:
            # Query by listing_id only to avoid complex index requirements
            tickets_stream = db.collection("chat_rooms").where("listing_id", "==", item_id).stream()
            existing_ticket = next((t for t in tickets_stream if t.to_dict().get("buyer_id") == uid and t.to_dict().get("is_ticket") == True), None)
                
            if existing_ticket:
                doc_ref = existing_ticket.reference
                doc_ref.update({
                    "status": "open",
                    "updated_at": firestore.SERVER_TIMESTAMP,
                    "last_message": f"🚨 ESCALATED: Product reported again: {payload.reason}",
                    "severity": "high"
                })
                doc_ref.collection("messages").add({
                    "sender_id": "ADMIN_SYSTEM",
                    "text": f"📥 The Reporter added additional information to this ticket:\n\nReason: {payload.reason}\nDetails: {payload.details}",
                    "is_system_message": True,
                    "timestamp": firestore.SERVER_TIMESTAMP
                })
            raise HTTPException(status_code=400, detail="You already reported this product. We have escalated your previous report.")
            
        reported_by.append(uid)
        new_report_count = item_data.get("report_count", 0) + 1
        
        update_payload = {
            "reported_by": reported_by,
            "report_count": new_report_count
        }
        
        if new_report_count >= 3:
            update_payload["is_available"] = False 
            update_payload["status"] = "hidden"

        item_ref.update(update_payload)
        
        db.collection("chat_rooms").document().set({
            "is_ticket": True,
            "buyer_id": uid, 
            "seller_id": "ADMIN_TEAM",
            "listing_id": item_id,
            "shop_id": shop_id, 
            "is_shop_item": True, 
            "listing_title": item_data.get('name', 'Unknown Shop Item'),
            "subject": f"🚩 SHOP REPORT: {item_data.get('name', 'Unknown')}",
            "last_message": f"Reason: {payload.reason}. {payload.details}",
            "status": "open",
            "severity": "high" if new_report_count >= 3 else "low",
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        return {"message": "Shop item reported. Our team will review it."}
        
    except HTTPException:
        raise
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/live", tags=["Shops - Public"])
async def get_all_verified_shops(user: dict = Depends(get_marketplace_user)): 
    try:
        shops = db.collection("shops").where("status", "==", "approved").stream()
        shop_list = []
        
        for shop in shops:
            shop_data = shop.to_dict()
            shop_data["id"] = shop.id
            
            catalog_docs = shop.reference.collection("catalog").stream()
            
            filtered_catalog = []
            for doc in catalog_docs:
                doc_data = doc.to_dict()
                if doc_data.get("status") not in ["hidden", "suspended"]:
                    filtered_catalog.append({"id": doc.id, **doc_data})
                    
            shop_data["catalog"] = filtered_catalog
            shop_list.append(shop_data)
            
        return {"data": shop_list}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 🚨 THE WILDCARD ROUTE (Must be absolutely last!)
@router.get("/{shop_id}", tags=["Shops - Public"])
async def get_single_shop(shop_id: str, user: dict = Depends(get_marketplace_user)): 
    try:
        shop_doc = db.collection("shops").document(shop_id).get()
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail="Shop not found.")
            
        shop_data = shop_doc.to_dict()
        shop_data["id"] = shop_doc.id
        
        catalog_docs = shop_doc.reference.collection("catalog").stream()
        filtered_catalog = []
        for doc in catalog_docs:
            doc_data = doc.to_dict()
            if doc_data.get("status") not in ["hidden", "suspended"]:
                filtered_catalog.append({"id": doc.id, **doc_data})
                
        shop_data["catalog"] = filtered_catalog
        
        return {"data": shop_data}
    except HTTPException: 
        raise
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))