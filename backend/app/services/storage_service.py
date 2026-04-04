from firebase_admin import storage
from datetime import timedelta
import uuid
import os
from app.core.config import settings

def generate_signed_upload_url(file_extension: str, content_type: str, user_id: str) -> dict:
    """
    Generates a secure, short-lived v4 Signed URL for direct client-to-cloud upload.
    Added Metadata for Admin auditing of banned/active users.
    """
    try:
        # 1. Clean the extension and generate a collision-proof filename
        ext = os.path.splitext(file_extension)[1].lower()
        unique_id = str(uuid.uuid4())
        
        # Path: uploads/user_abc123/unique-uuid-name.jpg
        filename = f"uploads/{user_id}/{unique_id}{ext}"
        
        # 2. Get the bucket
        bucket = storage.bucket(settings.FIREBASE_STORAGE_BUCKET)
        blob = bucket.blob(filename)
        
        # 3. Create the Signed URL (Expires in 5 mins)
        # 🚨 Added 'headers' to enforce metadata during the PUT request
        upload_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=5),
            method="PUT",
            content_type=content_type,
            # This ensures the file is "tagged" with the owner's ID in the cloud
            headers={"x-goog-meta-owner-id": user_id} 
        )
        
        # 4. Construct the permanent Public URL for database storage
        # Note: This URL assumes your Firebase Storage rules allow public read 
        # or you are using the 'alt=media' hack for non-authenticated viewing.
        safe_path = filename.replace("/", "%2F")
        public_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{safe_path}?alt=media"
        
        return {
            "upload_url": upload_url,
            "public_url": public_url,
            "file_path": filename
        }

    except Exception as e:
        # Log it so you can see it in your FastAPI terminal
        print(f"Error in generate_signed_upload_url: {e}")
        raise e