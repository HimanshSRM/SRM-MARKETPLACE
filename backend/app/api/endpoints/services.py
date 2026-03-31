from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from google.cloud import firestore

from app.core.firebase import db
from app.core.security import get_verified_student, get_marketplace_user # 🌟 Updated Import
from app.models.listing import ListingCreate, ListingStatus, ListingType 

router = APIRouter()

@router.get("/live", tags=["Services"])
async def get_live_services(
    category: Optional[str] = Query(None, description="e.g., tutoring, laundry, freelance"),
    limit: int = Query(15, le=30),
    cursor: Optional[str] = Query(None),
    user: dict = Depends(get_marketplace_user) # 🛡️ SHARED DOOR: Guests, students and shops can view!
):
    """
    Fetches a live feed of ONLY services, using strict cursor-based pagination.
    """
    try:
        # 1. Base Query: Active items AND strictly type == "service"
        query = db.collection("listings")\
            .where("status", "==", "active")\
            .where("type", "==", "service")\
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        
        if category:
            query = query.where("category", "==", category)
            
        if cursor:
            cursor_doc = db.collection("listings").document(cursor).get()
            if cursor_doc.exists:
                query = query.start_after(cursor_doc)
                
        docs = query.limit(limit).stream()
        
        results = []
        last_doc_id = None
        
        for doc in docs:
            item = doc.to_dict()
            item["id"] = doc.id
            results.append(item)
            last_doc_id = doc.id
            
        return {
            "data": results,
            "next_cursor": last_doc_id,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch services: {str(e)}")


@router.post("/create", response_model=dict, tags=["Services"])
async def create_service_ad(
    listing: ListingCreate, 
    user: dict = Depends(get_verified_student) # 🔒 STRICT DOOR: Only verified students can post here
):
    """
    Allows a verified student to post a service they are offering.
    """
    try:
        listing_data = listing.model_dump()
        
        listing_data["owner_id"] = user.get("uid") 
        listing_data["status"] = ListingStatus.ACTIVE
        
        # 🛡️ SECURITY OVERRIDE: Even if a malicious frontend tries to send 
        # type="product" to this route, we force it to be a service.
        listing_data["type"] = ListingType.SERVICE 
        
        listing_data["created_at"] = firestore.SERVER_TIMESTAMP 
        
        # Save to the shared listings collection
        doc_ref = db.collection("listings").document() 
        doc_ref.set(listing_data)
        
        return {"message": "Service ad posted successfully!", "id": doc_ref.id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to post service: {str(e)}")