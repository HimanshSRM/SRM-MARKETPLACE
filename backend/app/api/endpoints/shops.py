from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone , timedelta
import uuid
from google.cloud import firestore

from app.core.firebase import db
from app.core.security import get_current_user, get_marketplace_user, get_active_user
from app.models.shop import ShopCreate, CatalogItemCreate, CatalogItemUpdate, ShopProfileUpdate
from app.models.admin import ReportCreate
from app.models.shop import ShopStatusUpdate , ShopNoticeUpdate , FlashDealCreate , QuickReplyUpdate

router = APIRouter()



# ==========================================
# 1. PUBLIC ROUTES (Zero-Latency Reads)
# ==========================================

@router.get("/live", tags=["Shops - Public"])
async def get_all_verified_shops(user: dict = Depends(get_marketplace_user)): 
    """🚨 OPTIMIZED: Fetches all approved shops AND their catalogs in exactly 1 read per shop."""
    try:
        shops = db.collection("shops").where("status", "==", "approved").stream()
        return {"data": [{"id": shop.id, **shop.to_dict()} for shop in shops]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{shop_id}", tags=["Shops - Public"])
async def get_single_shop(shop_id: str, user: dict = Depends(get_marketplace_user)): 
    """🚨 OPTIMIZED: Fetches a single shop and its embedded catalog instantly."""
    try:
        shop_doc = db.collection("shops").document(shop_id).get()
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail="Shop not found.")
        return {"data": {"id": shop_doc.id, **shop_doc.to_dict()}}
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 2. PRIVATE ROUTES (Dashboard & Creation)
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
async def create_shop_profile(shop_data: ShopCreate, overwrite: bool = False, user: dict = Depends(get_active_user)):
    """🚨 OPTIMIZED: Creates a shop profile and initializes the embedded arrays."""
    try:
        uid = user.get("uid")
        auth_email = user.get("email") 
        shop_ref = db.collection("shops").document(uid)
        shop_doc = shop_ref.get()
        
        if shop_doc.exists and not overwrite:
            return {"status": "exists", "shop_data": shop_doc.to_dict()}

        shop_dict = shop_data.model_dump()
        shop_dict.update({
            "owner_id": uid,
            "owner_email": auth_email,
            "status": "pending",
            "is_verified": False,
            "is_open": False,
            "catalog": [],           # 🚨 NEW: Embedded catalog array
            "quick_replies": [],     # 🚨 NEW: Embedded auto-replies
            "live_notice": {"text": "", "is_active": False}, # 🚨 NEW: Embedded Notice
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        shop_ref.set(shop_dict)
        return {"status": "success", "message": "Shop application submitted!", "shop_id": uid}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{shop_id}/profile", tags=["Shops - Private"])
async def update_shop_profile(shop_id: str, payload: ShopProfileUpdate, user: dict = Depends(get_active_user)):
    """Allows a verified shop owner to update their business details."""
    if user.get("uid") != shop_id and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Permission denied.")
    try:
        shop_ref = db.collection("shops").document(shop_id)
        update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
        if update_data:
            update_data["updated_at"] = firestore.SERVER_TIMESTAMP
            shop_ref.update(update_data)
        return {"message": "Shop profile updated successfully!"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 3. CATALOG MANAGEMENT (Fast Array Updates)
# ==========================================

@router.post("/catalog/add", tags=["Shops - Private"])
async def add_catalog_item(item: CatalogItemCreate, user: dict = Depends(get_active_user)):
    """🚨 OPTIMIZED: Instantly appends an item to the embedded catalog array."""
    try:
        if user.get("role") != "shop_verified":
            raise HTTPException(status_code=403, detail="Unauthorized.")

        uid = user.get("uid")
        item_dict = item.model_dump()
        item_dict["id"] = f"item_{uuid.uuid4().hex[:8]}" # Generate unique ID

        db.collection("shops").document(uid).update({
            "catalog": firestore.ArrayUnion([item_dict]),
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        return {"message": "Item added!", "item_id": item_dict["id"]}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.delete("/catalog/{item_id}", tags=["Shops - Private"])
async def delete_catalog_item(item_id: str, user: dict = Depends(get_active_user)):
    """🚨 OPTIMIZED: Removes an exact item from the embedded catalog array."""
    try:
        if user.get("role") != "shop_verified":
            raise HTTPException(status_code=403, detail="Unauthorized.")

        uid = user.get("uid")
        shop_ref = db.collection("shops").document(uid)
        shop_doc = shop_ref.get()
        
        # Find the exact item to remove it
        catalog = shop_doc.to_dict().get("catalog", [])
        item_to_remove = next((i for i in catalog if i["id"] == item_id), None)
        
        if not item_to_remove:
            raise HTTPException(status_code=404, detail="Item not found.")

        shop_ref.update({
            "catalog": firestore.ArrayRemove([item_to_remove]),
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        return {"message": "Item deleted."}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


@router.put("/catalog/{item_id}", tags=["Shops - Private"])
async def update_catalog_item(
    item_id: str, 
    request: Request, 
    user: dict = Depends(get_active_user)
):
    """🚨 OPTIMIZED: Updates a specific item inside the embedded catalog array."""
    try:
        if user.get("role") != "shop_verified":
            raise HTTPException(status_code=403, detail="Unauthorized.")

        payload = await request.json()
        uid = user.get("uid")
        shop_ref = db.collection("shops").document(uid)
        shop_doc = shop_ref.get()
        
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail="Shop not found.")
            
        # 1. Pull the current catalog array
        catalog = shop_doc.to_dict().get("catalog", [])
        
        # 2. Find the exact index of the item we want to edit
        item_index = next((index for (index, d) in enumerate(catalog) if d["id"] == item_id), None)
        
        if item_index is None:
            raise HTTPException(status_code=404, detail="Item not found in catalog.")
            
        # 3. Update the specific fields in memory
        for key, value in payload.items():
            # Prevent them from accidentally overwriting the item ID
            if key != "id": 
                catalog[item_index][key] = value
            
        # 4. Push the entire updated array back to Firestore instantly
        shop_ref.update({
            "catalog": catalog,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        return {"message": "Item updated successfully!", "item": catalog[item_index]}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error updating item: {e}")
        raise HTTPException(status_code=500, detail="Failed to update item in database")   


# ==========================================
# 4. ADVANCED SHOP FEATURES (UX & Communication)
# ==========================================

@router.put("/status", tags=["Shops - Private"])
async def update_shop_status(payload: ShopStatusUpdate, user: dict = Depends(get_active_user)):
    """Toggles shop open/closed to allow/prevent new inquiries."""
    try:
        if user.get("role") != "shop_verified": raise HTTPException(status_code=403, detail="Unauthorized.")
        db.collection("shops").document(user.get("uid")).update({"is_open": payload.is_open})
        return {"message": f"Shop is now {'Open' if payload.is_open else 'Closed'}"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.put("/notice", tags=["Shops - Private"])
async def update_live_notice(payload: ShopNoticeUpdate, user: dict = Depends(get_active_user)):
    """Updates the live ticker on the shop's public profile."""
    try:
        if user.get("role") != "shop_verified": raise HTTPException(status_code=403, detail="Unauthorized.")
        db.collection("shops").document(user.get("uid")).update({"live_notice": payload.model_dump()})
        return {"message": "Live notice updated!"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.put("/quick-replies", tags=["Shops - Private"])
async def update_quick_replies(payload: QuickReplyUpdate, user: dict = Depends(get_active_user)):
    """Updates the automated quick replies for the shop."""
    try:
        if user.get("role") != "shop_verified": raise HTTPException(status_code=403, detail="Unauthorized.")
        db.collection("shops").document(user.get("uid")).update({"quick_replies": payload.quick_replies})
        return {"message": "Quick replies updated!"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@router.post("/flash-deal", tags=["Shops - Private"])
async def trigger_flash_deal(deal: FlashDealCreate, request: Request, user: dict = Depends(get_active_user)):
    """Broadcasts a deal AND saves it to the shop profile for the Directory UI."""
    try:
        if user.get("role") != "shop_verified":
            raise HTTPException(status_code=403, detail="Unauthorized.")

        uid = user.get("uid")
        shop_ref = db.collection("shops").document(uid)
        shop_name = shop_ref.get().to_dict().get("shop_name", "A Shop")

        # 🚨 NEW: Calculate expiration and save the deal to the database
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

        # Broadcast the Push Notification
        await request.app.state.redis.enqueue_job(
            'send_topic_push_notification',
            "flash_deals", 
            f"⚡ FLASH DEAL: {shop_name}",
            f"{deal.item_name} is only ₹{deal.deal_price} (Was ₹{deal.original_price})!",
            "/shops" 
        )
        return {"message": "Flash Deal Broadcasted & Live on Directory!"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 5. TRUST & SAFETY 
# ==========================================

@router.post("/{shop_id}/catalog/{item_id}/report", tags=["Shops - Public", "Trust & Safety"])
async def report_shop_item(shop_id: str, item_id: str, payload: ReportCreate, user: dict = Depends(get_active_user)):
    """Allows a user to flag a shop's catalog item (Ticket system)."""
    try:
        uid = user.get("uid")
        shop_doc = db.collection("shops").document(shop_id).get()
        if not shop_doc.exists: raise HTTPException(status_code=404, detail="Shop not found.")
        
        # Find item in array
        catalog = shop_doc.to_dict().get("catalog", [])
        item_data = next((i for i in catalog if i["id"] == item_id), None)
        if not item_data: raise HTTPException(status_code=404, detail="Item not found.")
        
        # Create Admin Ticket
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
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        return {"message": "Shop item reported. Our team will review it."}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))