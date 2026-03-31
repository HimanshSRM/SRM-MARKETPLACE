from fastapi import APIRouter, Depends, HTTPException, Query
from app.core.security import get_current_user
from app.services.storage_service import generate_signed_upload_url

router = APIRouter()

# Simple in-memory rate limiting (use Redis for a real production cluster)
upload_limiter = {}

@router.get("/signed-url", tags=["Storage"])
async def get_signed_url(
    content_type: str = Query(..., regex="^(image/jpeg|image/png|image/webp)$"),
    file_extension: str = Query(..., regex="^(\.jpg|\.jpeg|\.png|\.webp)$"),
    user: dict = Depends(get_current_user)
):
    uid = user.get("uid")

    # 🛑 ANTI-SPAM: Request Throttling
    # Prevents a single user from generating thousands of URLs to spam your bucket
    count = upload_limiter.get(uid, 0)
    if count >= 15:
        raise HTTPException(status_code=429, detail="Upload limit reached. Try again in an hour.")
    upload_limiter[uid] = count + 1

    try:
        # Generate the deployment-ready URLs
        result = generate_signed_upload_url(
            file_extension=file_extension,
            content_type=content_type,
            user_id=uid
        )
        return {"status": "success", "data": result}
        
    except Exception as e:
        # Mask internal errors but log the actual issue for debugging
        print(f"[STORAGE ERROR]: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail="Could not initialize secure upload channel. Check Blaze plan status."
        )