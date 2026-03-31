from fastapi import APIRouter, Depends, Query, HTTPException, Body
from typing import Optional
from google.cloud import firestore
from datetime import datetime, timedelta, timezone

from app.core.firebase import db
from app.core.security import get_verified_student, get_marketplace_user
from app.models.listing import ListingCreate, ListingStatus 

router = APIRouter()

@router.get("/live", tags=["Products"])
async def get_live_products(
    category: Optional[str] = Query(None),
    limit: int = Query(15, le=30),
    cursor: Optional[str] = Query(None),
    user: dict = Depends(get_marketplace_user)
):
    """
    Fetches the live feed with cursor-based pagination.
    Optimization: Only reads the 'limit' requested, saving Firestore costs.
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
                
        # Optimization: Fetch one extra to determine if there is a next page
        docs = query.limit(limit).stream()
        
        results = []
        last_doc_id = None
        
        for doc in docs:
            item = doc.to_dict()
            item["id"] = doc.id
            # Clean up Firestore timestamps for JSON safety
            if "created_at" in item and item["created_at"]:
                item["created_at"] = item["created_at"].isoformat()
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
    user: dict = Depends(get_verified_student)
):
    """
    Creates a new listing with Anti-Spam Cooldown & Content Validation.
    """
    try:
        uid = user.get("uid")
        
        # --- 🛡️ ANTI-SPAM: 60-SECOND COOLDOWN ---
        # Fetch the user's most recent listing to check the gap
        recent_posts = db.collection("listings") \
            .where("owner_id", "==", uid) \
            .order_by("created_at", direction=firestore.Query.DESCENDING) \
            .limit(1).get()

        if recent_posts:
            last_post_time = recent_posts[0].to_dict().get("created_at")
            if last_post_time:
                # Ensure we're comparing offset-aware datetimes
                now = datetime.now(timezone.utc)
                diff = now - last_post_time
                if diff < timedelta(seconds=60):
                    seconds_left = 60 - int(diff.total_seconds())
                    raise HTTPException(
                        status_code=429, 
                        detail=f"Slow down! You can post again in {seconds_left} seconds."
                    )

        # --- 🛡️ CONTENT VALIDATION ---
        if listing.price < 0 or listing.price > 100000:
            raise HTTPException(status_code=400, detail="Invalid price range.")
        
        if len(listing.description) < 20:
            raise HTTPException(status_code=400, detail="Description is too short. Be more descriptive!")

        # --- DATA PREP ---
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
async def delete_student_product(listing_id: str, user: dict = Depends(get_verified_student)):
    """Allows a student to permanently delete their own listing."""
    try:
        uid = user.get("uid")
        doc_ref = db.collection("listings").document(listing_id)
        doc = doc_ref.get()
        
        if not doc.exists:
            raise HTTPException(status_code=404, detail="Listing not found.")
            
        listing_data = doc.to_dict()
        owner_id = listing_data.get("owner_id") or listing_data.get("seller_id")
        
        # 🛡️ SECURITY: Make sure they aren't trying to delete someone else's item!
        if owner_id != uid:
            raise HTTPException(status_code=403, detail="You can only delete your own listings.")
            
        # Nuke it from Firebase
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
    user: dict = Depends(get_verified_student)
):
    """Allows a student to update their own listing."""
    try:
        uid = user.get("uid")
        doc_ref = db.collection("listings").document(product_id)
        doc = doc_ref.get()

        if not doc.exists:
            raise HTTPException(status_code=404, detail="Product not found.")

        item_data = doc.to_dict()
        owner_id = item_data.get("owner_id") or item_data.get("seller_id")

        if owner_id != uid:
            raise HTTPException(status_code=403, detail="You can only edit your own listings.")

        # 1. Create the clean data for the RESPONSE
        safe_update_data = {
            k: v for k, v in payload.items() 
            if k in ["title", "description", "price", "condition", "category"]
        }
        
        if item_data.get("status") == "hidden":
            safe_update_data["status"] = "active"

        # 2. Create a separate copy for the DATABASE update
        db_payload = safe_update_data.copy()
        db_payload["updated_at"] = firestore.SERVER_TIMESTAMP # 🚨 Sentinel added here

        if db_payload:
            doc_ref.update(db_payload)
        
        # 3. Return the clean data (NO Sentinel!)
        return {
            "message": "Product successfully updated.", 
            "updated_data": safe_update_data # ✅ This is JSON-safe
        }
    except HTTPException:
        raise
    except Exception as e:
        # This will now catch real errors, not just JSON encoding crashes
        raise HTTPException(status_code=500, detail=str(e))
