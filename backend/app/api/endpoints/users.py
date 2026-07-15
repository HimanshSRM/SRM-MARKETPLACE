from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
import random
from datetime import datetime, timedelta, timezone
from google.cloud import firestore
from firebase_admin import messaging

# Security dependencies
from app.core.security import get_current_user, get_verified_student, get_active_user 
from app.services.user_service import UserService
from app.core.firebase import db
from app.utils.email import send_otp_email

router = APIRouter()

# ==========================================
# PYDANTIC MODELS
# ==========================================
class SyncRequest(BaseModel):
    selected_role: Optional[str] = "guest"

class SendOtpRequest(BaseModel):
    srm_email: EmailStr

class VerifyOtpRequest(BaseModel):
    srm_email: EmailStr
    otp_code: str

class StudentProfileUpdate(BaseModel):
    phone: Optional[str] = None
    upi_id: Optional[str] = None

class FCMTokenRequest(BaseModel):
    token: str
    topic: Optional[str] = "campus_active_pools"


# ==========================================
# SYNC & PROFILE ENDPOINTS
# ==========================================

@router.post("/sync", tags=["User Management"])
async def sync_user_profile(payload: SyncRequest, user: dict = Depends(get_current_user)):
    """Called exactly ONCE right after a user logs in to synchronize Firebase Auth with Firestore."""
    try:
        uid = user.get("uid")
        email = user.get("email")
        phone = user.get("phone_number")
        
        # Safely assign a name
        if user.get("name"):
            name = user.get("name")
        elif email:
            name = email.split("@")[0]
        else:
            name = phone or "Campus User"
        
        profile = UserService.sync_user_profile(uid, email, name, payload.selected_role)
        
        # Read-only ban logic
        is_banned = profile.get("role") == "banned" or profile.get("status") == "banned"
        next_step = "dashboard"
        
        if is_banned:
            profile["role"] = "banned"
            profile["status"] = "banned"
        elif profile.get("role") == "guest":
            if payload.selected_role == "shop":
                shop_doc = db.collection("shops").document(uid).get()
                if shop_doc.exists and shop_doc.to_dict().get("status") == "pending":
                    next_step = "shop_pending_approval" 
                else:
                    next_step = "apply_for_shop" 
            elif payload.selected_role == "student":
                next_step = "verify_srm_email" 
        
        return {
            "message": "User synchronized", 
            "profile": profile,
            "next_step": next_step
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/me", tags=["User Management"])
async def get_my_profile(user: dict = Depends(get_current_user)):
    """Fetches the currently logged-in user's profile data."""
    try:
        uid = user.get("uid")
        profile = UserService.get_profile(uid)
        return {"profile": profile}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# PROGRESSIVE ONBOARDING (OTP) ENDPOINTS
# ==========================================

@router.post("/send-otp", tags=["User Management"])
async def send_student_otp(request: SendOtpRequest, user: dict = Depends(get_active_user)):
    """Generates a 6-digit OTP, saves it temporarily to Firestore, and emails it."""
    try:
        uid = user.get("uid") 
        safe_email = request.srm_email.strip().lower()

        if not safe_email.endswith("@srmist.edu.in"):
            raise HTTPException(status_code=400, detail="Must be a valid @srmist.edu.in email.")

        # Dual-layer uniqueness check
        srm_check = db.collection("users").where("srm_email", "==", safe_email).limit(1).stream()
        existing_srm = next(srm_check, None)
        if existing_srm and existing_srm.id != uid:
            raise HTTPException(status_code=400, detail="This SRM email is already registered to another account.")

        primary_check = db.collection("users").where("email", "==", safe_email).limit(1).stream()
        existing_primary = next(primary_check, None)
        if existing_primary and existing_primary.id != uid:
            raise HTTPException(status_code=400, detail="An account already exists with this primary email address. Please log in directly.")

        otp_code = str(random.randint(100000, 999999))
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        db.collection("otp_codes").document(safe_email).set({
            "code": otp_code,
            "expires_at": expires_at,
            "uid_requesting": uid 
        })
        
        email_sent = send_otp_email(safe_email, otp_code)
        
        if not email_sent:
            db.collection("otp_codes").document(safe_email).delete()
            raise HTTPException(status_code=500, detail="Failed to send the email. Please try again.")
        
        return {"message": "OTP sent successfully to your SRM email."}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/verify-otp", tags=["User Management"])
async def verify_student_otp(request: VerifyOtpRequest, user: dict = Depends(get_active_user)):
    """Verifies the OTP, promotes the user to 'student', and unfreezes old listings."""
    try:
        uid = user.get("uid")
        safe_email = request.srm_email.strip().lower()
        
        otp_ref = db.collection("otp_codes").document(safe_email)
        otp_doc = otp_ref.get()
        
        if not otp_doc.exists:
            raise HTTPException(status_code=400, detail="No OTP requested for this email.")
            
        otp_data = otp_doc.to_dict()
        
        if datetime.now(timezone.utc) > otp_data["expires_at"]:
            otp_ref.delete() 
            raise HTTPException(status_code=400, detail="OTP has expired. Please request a new one.")
            
        if otp_data["code"] != request.otp_code.strip():
            raise HTTPException(status_code=400, detail="Invalid OTP code.")
            
        # Batch update: Verify user, unfreeze items, and cleanup OTP
        batch = db.batch()
        
        user_ref = db.collection("users").document(uid)
        batch.update(user_ref, {
            "role": "student",
            "srm_email": safe_email, 
            "verified_at": firestore.SERVER_TIMESTAMP
        })
        
        user_listings = db.collection("listings").where("owner_id", "==", uid).stream()
        for doc in user_listings:
            if doc.to_dict().get("status") == "suspended":
                batch.update(doc.reference, {"status": "active"})
        
        batch.delete(otp_ref)
        batch.commit()
        
        return {"message": "Email verified! You are now an official student and your listings are live."}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))    


# ==========================================
# USER DASHBOARDS & PROFILES
# ==========================================

@router.get("/dashboard/student", tags=["Dashboards"])
async def get_student_dashboard(student: dict = Depends(get_verified_student)):
    """Locked to @srmist.edu.in users only."""
    uid = student.get("uid")
    try:
        user_doc = db.collection("users").document(uid).get()
        user_data = user_doc.to_dict() if user_doc.exists else {}

        docs = db.collection("listings").where("owner_id", "==", uid).stream()
        my_listings = [{"id": doc.id, **doc.to_dict()} for doc in docs]
        
        return {
            "role": student.get("role"), 
            "message": f"Welcome to the SRM Marketplace, {student.get('email')}!",
            "uid": uid,
            "phone": user_data.get("phone", ""),      
            "upi_id": user_data.get("upi_id", ""),    
            "listings": my_listings
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/profile/contact", tags=["User Management"])
async def update_student_contact(payload: StudentProfileUpdate, user: dict = Depends(get_verified_student)):
    """Updates contact defaults for verified students."""
    try:
        uid = user.get("uid")
        update_data = {}
        if payload.phone is not None: update_data["phone"] = payload.phone
        if payload.upi_id is not None: update_data["upi_id"] = payload.upi_id
        
        if update_data:
            db.collection("users").document(uid).update(update_data)
        return {"message": "Defaults updated successfully!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# NOTIFICATIONS (FCM TOPIC SUBSCRIPTION)
# ==========================================

@router.post("/subscribe-topic", tags=["Notifications"])
async def subscribe_fcm_topic(payload: FCMTokenRequest, current_user: dict = Depends(get_current_user)):
    """Subscribes a frontend web token to a global campus broadcast channel."""
    try:
        response = messaging.subscribe_to_topic([payload.token], payload.topic)
        return {"message": f"Subscribed to {payload.topic} successfully.", "status": "success"}
    except Exception as e:
        print(f"Topic Subscription Failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to subscribe token to topic.")