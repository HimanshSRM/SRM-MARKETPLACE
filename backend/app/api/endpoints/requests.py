from fastapi import APIRouter, Depends, Query, HTTPException
from typing import Optional
from google.cloud import firestore
from app.core.firebase import db
from app.core.security import get_active_user, get_marketplace_user 
from app.models.listing import ListingCreate, ListingStatus, ListingType 

router = APIRouter()

@router.get("/live", tags=["Requests"])
async def get_live_requests(
    category: Optional[str] = Query(None),
    limit: int = Query(15, le=30),
    cursor: Optional[str] = Query(None),
    user: dict = Depends(get_marketplace_user)
):
    """Fetches a live feed of items or accommodation students are looking for."""
    try:
        query = db.collection("listings")\
            .where("status", "==", "active")\
            .where("type", "==", "request")\
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
            if "created_at" in item and item["created_at"]:
                item["created_at"] = item["created_at"].isoformat()
            results.append(item)
            last_doc_id = doc.id
            
        return {
            "data": results,
            "next_cursor": last_doc_id,
            "count": len(results)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch requests: {str(e)}")


@router.post("/create", response_model=dict, tags=["Requests"])
async def create_student_request(
    listing: ListingCreate, 
    user: dict = Depends(get_active_user)
):
    """Allows a verified student to post an item or roommate request."""
    try:
        if user.get("role") not in ["student", "admin"]:
            raise HTTPException(status_code=403, detail="Only verified students can post requests.")

        listing_data = listing.model_dump()
        listing_data["owner_id"] = user.get("uid") 
        listing_data["status"] = ListingStatus.ACTIVE
        
        # 🛡️ Force write type to avoid frontend injection attacks
        listing_data["type"] = ListingType.REQUEST 
        listing_data["created_at"] = firestore.SERVER_TIMESTAMP 
        
        doc_ref = db.collection("listings").document() 
        doc_ref.set(listing_data)
        
        return {"message": "Request posted successfully!", "id": doc_ref.id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to post request: {str(e)}")