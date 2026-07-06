from fastapi import APIRouter, Depends, Query, HTTPException, Body
from typing import Optional
from google.cloud import firestore
from datetime import datetime, timedelta, timezone

from app.core.firebase import db
from app.core.security import get_active_user, get_marketplace_user
from app.models.listing import ListingCreate, ListingStatus, ListingStatusToggle

router = APIRouter()

@router.put("/{listing_id}/toggle-visibility", tags=["Products"])
async def toggle_listing_visibility(
    listing_id: str, 
    payload: ListingStatusToggle, 
    user: dict = Depends(get_active_user)
):
    """
    Allows a seller to toggle their listing between 'active' and 'paused'.
    Strictly prevents modifying Admin 'suspended' or 'hidden' items.
    """
    try:
        uid = user.get("uid")
        listing_ref = db.collection("listings").document(listing_id)
        listing_doc = listing_ref.get()
        
        if not listing_doc.exists:
            raise HTTPException(status_code=404, detail="Listing not found.")
            
        listing_data = listing_doc.to_dict()
        
        # Security: Only the owner can toggle this
        owner_id = listing_data.get("owner_id") or listing_data.get("seller_id")
        if owner_id != uid:
            raise HTTPException(status_code=403, detail="Not authorized to edit this listing.")
            
        current_status = listing_data.get("status", "active")
        
        # 🚨 STRICT STATE MACHINE: Protect the Admin's moderation state
        if current_status in ["suspended", "hidden"]:
            raise HTTPException(
                status_code=403, 
                detail="This listing has been restricted by an Admin and cannot be modified."
            )
        if current_status == "sold":
            raise HTTPException(
                status_code=400, 
                detail="Sold items cannot be un-archived."
            )
            
        # 🚨 THE FIX: Seller uses "paused", Admin uses "hidden". No more collision!
        new_status = "active" if payload.is_active else "paused"
        
        listing_ref.update({
            "status": new_status,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        return {"message": f"Listing is now {new_status}."}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/live", tags=["Products"])
async def get_live_products(
    category: Optional[str] = Query(None),
    limit: int = Query(15, le=30),
    cursor: Optional[str] = Query(None),
    user: dict = Depends(get_marketplace_user)  # Browsing allows everyone
):
    """
    Fetches the live feed with cursor-based pagination.
    """
    try:
        # Base query
        query = db.collection("listings").where("status", "==", "active").order_by("created_at", direction=firestore.Query.DESCENDING)
        
        if category:
            query = query.where("category", "==", category)
            
        if cursor:
            cursor_doc = db.collection("listings").document(cursor).get()
            if cursor_doc.exists:
                query = query.start_after(cursor_doc)
                
        # Optimization: Fetch via stream matching the configured limit
        docs = query.limit(limit).stream()
        
        results = []
        last_doc_id = None
        
        for doc in docs:
            item = doc.to_dict()
            item["id"] = doc.id
            
            # Clean up Firestore timestamps for JSON serialization safety
            if "created_at" in item and item["created_at"]:
                if hasattr(item["created_at"], "isoformat"):
                    item["created_at"] = item["created_at"].isoformat()
                else:
                    item["created_at"] = str(item["created_at"])
                    
            results.append(item)
            last_doc_id = doc.id
            
        return {
            "data": results,
            "next_cursor": last_doc_id if len(results) == limit else None,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch feed: {str(e)}")


@router.post("/create", response_model=dict, tags=["Products"])
async def create_product(
    listing: ListingCreate, 
    user: dict = Depends(get_active_user)  # Blocks banned users
):
    """
    Creates a new listing with Anti-Spam Cooldown & Content Validation.
    """
    try:
        # Role check: Ensure active user is authorized
        if user.get("role") not in ["student", "admin"]:
            raise HTTPException(status_code=403, detail="Only verified students can post ads.")

        uid = user.get("uid")
        
        # --- ANTI-SPAM: 60-SECOND COOLDOWN ---
        recent_posts = db.collection("listings") \
            .where("owner_id", "==", uid) \
            .order_by("created_at", direction=firestore.Query.DESCENDING) \
            .limit(1).get()

        if recent_posts:
            last_post_time = recent_posts[0].to_dict().get("created_at")
            if last_post_time:
                now = datetime.now(timezone.utc)
                diff = now - last_post_time
                if diff < timedelta(seconds=60):
                    seconds_left = 60 - int(diff.total_seconds())
                    raise HTTPException(
                        status_code=429, 
                        detail=f"Slow down! You can post again in {seconds_left} seconds."
                    )

        # --- CONTENT VALIDATION ---
        if listing.price < 0 or listing.price > 100000:
            raise HTTPException(status_code=400, detail="Invalid price range.")
        
        if len(listing.description) < 20:
            raise HTTPException(status_code=400, detail="Description is too short. Be more descriptive!")

        # --- DATA PREPARATION ---
        listing_data = listing.model_dump()
        listing_data["owner_id"] = uid
        listing_data["status"] = ListingStatus.ACTIVE
        listing_data["created_at"] = firestore.SERVER_TIMESTAMP 
        
        doc_ref = db.collection("listings").document() 
        doc_ref.set(listing_data)
        
        return {"message": "Ad posted successfully!", "id": doc_ref.id}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
    

@router.delete("/{listing_id}", tags=["Products"])
async def delete_student_product(
    listing_id: str, 
    user: dict = Depends(get_active_user)
):
    """Allows a student to permanently delete their own listing."""
    try:
        if user.get("role") not in ["student", "admin"]:
            raise HTTPException(status_code=403, detail="Only verified students can delete ads.")

        uid = user.get("uid")
        doc_ref = db.collection("listings").document(listing_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            raise HTTPException(status_code=404, detail="Listing not found.")
            
        listing_data = doc.to_dict()
        owner_id = listing_data.get("owner_id") or listing_data.get("seller_id")
        
        # SECURITY: Ensure owners can only delete their own assets
        if owner_id != uid:
            raise HTTPException(status_code=403, detail="You can only delete your own listings.")
            
        doc_ref.delete()
        return {"message": "Listing successfully deleted."}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))    
    

@router.put("/{product_id}", tags=["Products"])
async def update_product(
    product_id: str, 
    payload: dict = Body(...), 
    user: dict = Depends(get_active_user)
):
    """Allows a student to update their listing and alerts Admins if under moderation."""
    try:
        # 🚨 ROLE FIX: Added "banned" so suspended users aren't locked out of appealing
        if user.get("role") not in ["student", "admin", "banned"]:
            raise HTTPException(status_code=403, detail="Unauthorized to edit ads.")

        uid = user.get("uid")
        doc_ref = db.collection("listings").document(product_id)
        doc = doc_ref.get()

        if not doc.exists:
            raise HTTPException(status_code=404, detail="Product not found.")

        item_data = doc.to_dict()
        owner_id = item_data.get("owner_id") or item_data.get("seller_id")

        if owner_id != uid:
            raise HTTPException(status_code=403, detail="You can only edit your own listings.")

        current_status = item_data.get("status")

        # 1. Filter out malicious payloads (Seller cannot force "status": "active" via API)
        safe_update_data = {
            k: v for k, v in payload.items() 
            if k in ["title", "description", "price", "condition", "category"]
        }
        
        # 2. THE FIX: Only unpause items that the SELLER paused themselves.
        # 🚨 NEVER un-hide items restricted by an Admin!
        if current_status == "paused":
            safe_update_data["status"] = "active"

        # 3. Update the database
        db_payload = safe_update_data.copy()
        db_payload["updated_at"] = firestore.SERVER_TIMESTAMP

        if db_payload:
            doc_ref.update(db_payload)
        
        # 4. 🚨 THE MODERATION LOOP: Alert Admin if editing a restricted item
        if current_status in ["suspended", "hidden"]:
            # 🚨 THE INDEX FIX: Query only by listing_id to prevent Firestore crash
            tickets = db.collection("chat_rooms").where("listing_id", "==", product_id).stream()

            for t in tickets:
                t_data = t.to_dict()
                if t_data.get("is_ticket") == True and t_data.get("seller_id") == "ADMIN_TEAM":
                    room_ref = t.reference
                    
                    # Pop the thread back into the Admin's "Needs Reply" inbox
                    room_ref.update({
                        "status": "open",
                        "last_message": "🔄 Seller updated the listing for review.",
                        "updated_at": firestore.SERVER_TIMESTAMP,
                        "last_sender_id": uid 
                    })
                    
                    # Drop an automated system alert inside the chat
                    room_ref.collection("messages").add({
                        "sender_id": "ADMIN_SYSTEM",
                        "text": "🔄 **SYSTEM ALERT:** The seller has edited the details of this restricted listing.\n\nPlease review the updated listing. If it now complies with the rules, you can use the Quick Restore button.",
                        "is_system_message": True,
                        "is_bid": False,
                        "timestamp": firestore.SERVER_TIMESTAMP,
                        "created_at": firestore.SERVER_TIMESTAMP
                    })
                    break # Stop looping once the admin ticket is found

        return {
            "message": "Product successfully updated.", 
            "updated_data": safe_update_data
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))