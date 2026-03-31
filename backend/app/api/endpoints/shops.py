from pydantic import BaseModel
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore

from app.core.firebase import db
from app.core.security import get_current_user, get_marketplace_user, get_verified_shop
from app.models.shop import ShopCreate, CatalogItemCreate, CatalogItemUpdate , ShopProfileUpdate
from app.models.admin import ReportCreate



router = APIRouter()

# --- PUBLIC ROUTES (For Students & Shops Browsing) ---

@router.get("/live", tags=["Shops - Public"])
async def get_all_verified_shops(user: dict = Depends(get_marketplace_user)): 
    """Allows both students and verified shops to view the business directory."""
    try:
        shops = db.collection("shops").where("status", "==", "approved").stream()
        return {"data": [{"id": shop.id, **shop.to_dict()} for shop in shops]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{shop_id}/catalog", tags=["Shops - Public"])
async def get_shop_catalog(shop_id: str, user: dict = Depends(get_marketplace_user)): 
    """Allows both students and verified shops to view a specific shop's items."""
    try:
        catalog = db.collection("shops").document(shop_id).collection("catalog").stream()
        return {"data": [{"id": item.id, **item.to_dict()} for item in catalog]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- PRIVATE ROUTES (For Shop Owners & Applicants) ---


@router.get("/me", tags=["Shops - Private"])
async def check_my_shop_status(user: dict = Depends(get_current_user)):
    """Silently checks if the user already has a shop profile (by UID or Email)."""
    try:
        uid = user.get("uid")
        auth_email = user.get("email") # 🚨 Get their actual Firebase Auth email

        # 1. Primary Check: By exact UID
        shop_doc = db.collection("shops").document(uid).get()
        if shop_doc.exists:
            return {"has_shop": True, "shop_data": shop_doc.to_dict()}

        # 2. Secondary Check: By Email (Catches users who recreated their Firebase account)
        if auth_email:
            email_query = db.collection("shops").where("owner_email", "==", auth_email).limit(1).stream()
            existing_shop = next(email_query, None)
            if existing_shop:
                return {"has_shop": True, "shop_data": existing_shop.to_dict()}

        return {"has_shop": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create", tags=["Shops - Private"])
async def create_shop_profile(
    shop_data: ShopCreate, 
    overwrite: bool = False, 
    user: dict = Depends(get_current_user) 
):
    """Creates a shop profile, handling cross-UID email migrations safely."""
    try:
        uid = user.get("uid")
        auth_email = user.get("email") # 🚨 Lock to real Auth email
        
        shop_ref = db.collection("shops").document(uid)
        shop_doc = shop_ref.get()
        
        # 🚨 Look for orphaned shops attached to this email but a different UID
        existing_shop_by_email = None
        if not shop_doc.exists and auth_email:
            email_query = db.collection("shops").where("owner_email", "==", auth_email).limit(1).stream()
            existing_shop_by_email = next(email_query, None)

        # 1. THE INTERCEPT (Triggers "Welcome Back" screen)
        if (shop_doc.exists or existing_shop_by_email) and not overwrite:
            data_to_return = shop_doc.to_dict() if shop_doc.exists else existing_shop_by_email.to_dict()
            return {"status": "exists", "shop_data": data_to_return}

        # 2. OVERWRITE & MIGRATE PROTOCOL
        if overwrite:
            # If they are migrating an old email shop to a new UID, delete the old root document completely
            if existing_shop_by_email and not shop_doc.exists:
                old_shop_ref = existing_shop_by_email.reference
                old_catalog = old_shop_ref.collection("catalog").stream()
                batch = db.batch()
                for item in old_catalog:
                    batch.delete(item.reference)
                batch.delete(old_shop_ref)
                batch.commit()
            # If overwriting a shop on the current UID, just nuke the catalog
            elif shop_doc.exists:
                old_catalog = shop_ref.collection("catalog").stream()
                batch = db.batch()
                for item in old_catalog:
                    batch.delete(item.reference)
                batch.commit() 

        # 3. Create or Update the Shop Data on the NEW UID
        shop_dict = shop_data.model_dump()
        shop_dict["owner_id"] = uid
        shop_dict["owner_email"] = auth_email # 🚨 Strictly save their Firebase Auth email here
        shop_dict["status"] = "pending" 
        shop_dict["is_verified"] = False 
        shop_dict["created_at"] = firestore.SERVER_TIMESTAMP
        shop_dict["updated_at"] = firestore.SERVER_TIMESTAMP
        
        # Save to the new, correct UID
        shop_ref.set(shop_dict)
        
        # 🚨 THE FIX: Do not promote guests to students!
        user_ref = db.collection("users").document(uid)
        user_doc = user_ref.get()
        if user_doc.exists:
            current_role = user_doc.to_dict().get("role", "guest")
            if current_role == "shop_verified":
                # Only demote them if they were restarting an already verified shop
                user_ref.update({"role": "guest"})
        
        return {"status": "success", "message": "Shop application submitted!", "shop_id": uid}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/catalog/add", tags=["Shops - Private"])
async def add_catalog_item(
    item: CatalogItemCreate, 
    shop_owner: dict = Depends(get_verified_shop) 
):
    """Allows a verified business to add a permanent item to their shop."""
    try:
        uid = shop_owner.get("uid")
        shop_ref = db.collection("shops").document(uid)
        new_item_ref = shop_ref.collection("catalog").document()
        new_item_ref.set(item.model_dump())
        
        return {"message": "Item added to catalog successfully", "item_id": new_item_ref.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.put("/catalog/{item_id}", tags=["Shops - Private"])
async def update_catalog_item(
    item_id: str,
    item_update: CatalogItemUpdate,
    user_data: dict = Depends(get_verified_shop) 
):
    try:
        uid = user_data.get("uid")
        item_ref = db.collection("shops").document(uid).collection("catalog").document(item_id)
        item_doc = item_ref.get()

        if not item_doc.exists:
            raise HTTPException(status_code=404, detail="Item not found in your catalog.")

        update_data = {k: v for k, v in item_update.model_dump().items() if v is not None}
        
        if update_data:
            item_ref.update(update_data)
        
        updated_doc = item_ref.get()
        return {"id": item_id, **updated_doc.to_dict()}

    except HTTPException:
        raise 
    except Exception as e:
        print(f"Error updating item: {e}")
        raise HTTPException(status_code=500, detail="Failed to update item in database")
    
@router.delete("/catalog/{item_id}", tags=["Shops - Private"])
async def delete_catalog_item(
    item_id: str,
    user_data: dict = Depends(get_verified_shop) 
):
    try:
        uid = user_data.get("uid")
        item_ref = db.collection("shops").document(uid).collection("catalog").document(item_id)
        item_doc = item_ref.get()

        if not item_doc.exists:
            raise HTTPException(status_code=404, detail="Item not found in your catalog.")

        item_ref.delete()
        return {"message": "Item deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting item: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete item from database")
    

@router.post("/restore", tags=["Shops - Private"])
async def restore_old_shop(user: dict = Depends(get_current_user)):
    """Restores a previous shop. Safely migrates the catalog if the UID changed."""
    try:
        uid = user.get("uid")
        auth_email = user.get("email")
        
        shop_ref = db.collection("shops").document(uid)
        shop_doc = shop_ref.get()
        
        # Find by email if they recreated their Firebase account
        existing_shop_by_email = None
        if not shop_doc.exists and auth_email:
            email_query = db.collection("shops").where("owner_email", "==", auth_email).limit(1).stream()
            existing_shop_by_email = next(email_query, None)
            
        if not shop_doc.exists and not existing_shop_by_email:
            raise HTTPException(status_code=404, detail="No previous shop found to restore.")

        batch = db.batch()

        # 🚨 MIGRATION PROTOCOL (If their UID changed)
        if existing_shop_by_email and not shop_doc.exists:
            old_shop_ref = existing_shop_by_email.reference
            shop_data = existing_shop_by_email.to_dict()
            
            # Update ownership
            shop_data["owner_id"] = uid
            shop_data["status"] = "pending"
            shop_data["updated_at"] = firestore.SERVER_TIMESTAMP
            
            # 1. Create shop on NEW UID
            batch.set(shop_ref, shop_data)
            
            # 2. Safely COPY the entire catalog over to the new UID
            old_catalog = old_shop_ref.collection("catalog").stream()
            for item in old_catalog:
                new_item_ref = shop_ref.collection("catalog").document(item.id)
                batch.set(new_item_ref, item.to_dict())
                batch.delete(item.reference) # Delete old item
                
            # 3. Delete old shop root document
            batch.delete(old_shop_ref)

        # 🚨 SAME UID RESTORE (If they just got demoted/promoted)
        elif shop_doc.exists:
            # Just update the status, leave the catalog completely untouched!
            batch.update(shop_ref, {
                "status": "pending",
                "updated_at": firestore.SERVER_TIMESTAMP
            })

        # 🚨 THE FIX: Do not promote guests to students!
        user_ref = db.collection("users").document(uid)
        user_doc = user_ref.get()
        if user_doc.exists:
            current_role = user_doc.to_dict().get("role", "guest")
            if current_role == "shop_verified":
                batch.update(user_ref, {"role": "guest"})
        
        batch.commit()
        return {"status": "success", "message": "Shop successfully restored and pending approval!"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))    
    
# --- SHOP PROFILE EDITING ---

@router.put("/{shop_id}/profile", tags=["Shops"])
async def update_shop_profile(shop_id: str, payload: ShopProfileUpdate, user: dict = Depends(get_current_user)):
    """Allows a verified shop owner to update their business details."""
    if user.get("uid") != shop_id and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="You do not have permission to edit this shop.")

    try:
        shop_ref = db.collection("shops").document(shop_id)
        shop_doc = shop_ref.get()
        
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail="Shop profile not found.")

        update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
        
        if not update_data:
            return {"message": "No changes requested.", "status": "success"}

        update_data["updated_at"] = firestore.SERVER_TIMESTAMP
        shop_ref.update(update_data)

        return {
            "message": "Shop profile updated successfully!",
            "updated_fields": list(update_data.keys())
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))   


# ==========================================
# 🚨 TRUST & SAFETY - SHOP REPORTING
# ==========================================

@router.post("/{shop_id}/catalog/{item_id}/report", tags=["Shops - Public", "Trust & Safety"])
async def report_shop_item(
    shop_id: str, 
    item_id: str, 
    payload: ReportCreate, 
    user: dict = Depends(get_current_user) 
):
    """Allows a user to flag a shop's catalog item."""
    uid = user.get("uid")
    
    try:
        item_ref = db.collection("shops").document(shop_id).collection("catalog").document(item_id)
        item_doc = item_ref.get()
        
        if not item_doc.exists:
            raise HTTPException(status_code=404, detail="Shop item not found.")
            
        item_data = item_doc.to_dict()
        
        # Anti-Spam Check
        reported_by = item_data.get("reported_by", [])
        if uid in reported_by:
            raise HTTPException(status_code=400, detail="You have already reported this item.")
            
        reported_by.append(uid)
        new_report_count = item_data.get("report_count", 0) + 1
        
        item_ref.update({
            "reported_by": reported_by,
            "report_count": new_report_count
        })
        
        # Create the Admin Ticket
        ticket_ref = db.collection("chat_rooms").document()
        ticket_ref.set({
            "is_ticket": True,
            "buyer_id": uid, 
            "seller_id": "ADMIN_TEAM",
            "listing_id": item_id,
            "shop_id": shop_id, 
            "is_shop_item": True, 
            "listing_title": item_data.get('name', item_data.get('title', 'Unknown Shop Item')),
            "subject": f"🚩 SHOP REPORT: {item_data.get('name', item_data.get('title', 'Unknown Shop Item'))}",
            "last_message": f"Reason: {payload.reason}. {payload.details}",
            "status": "open",
            "severity": "high" if new_report_count >= 3 else "low",
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        return {"message": "Shop item reported successfully. Our team will review it."}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))