from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
import random
from datetime import datetime, timedelta, timezone
from google.cloud import firestore
from app.utils.email import send_otp_email

# 🚨 IMPORT THE NEW BOUNCER (get_active_user)
from app.core.security import get_current_user, get_verified_student, get_active_user 
from app.services.user_service import UserService
from app.core.firebase import db

router = APIRouter()

# --- PYDANTIC MODELS (Requests) ---
class SyncRequest(BaseModel):
    selected_role: Optional[str] = "guest"

class SendOtpRequest(BaseModel):
    srm_email: EmailStr

class VerifyOtpRequest(BaseModel):
    srm_email: EmailStr
    otp_code: str


# --- SYNC & PROFILE ENDPOINTS ---

@router.post("/sync", tags=["User Management"])
async def sync_user_profile(payload: SyncRequest, user: dict = Depends(get_current_user)):
    """Called exactly ONCE right after a user logs in."""
    try:
        uid = user.get("uid")
        
        email = user.get("email")
        phone = user.get("phone_number")
        
        # Safely assign a name without crashing if email is None
        if user.get("name"):
            name = user.get("name")
        elif email:
            name = email.split("@")[0]
        else:
            name = phone or "Campus User"
        
        # Hand the work directly to the Service layer
        profile = UserService.sync_user_profile(uid, email, name, payload.selected_role)
        
        # 🚨 READ-ONLY BAN LOGIC: Check if the user is suspended
        is_banned = profile.get("role") == "banned" or profile.get("status") == "banned"
        
        next_step = "dashboard"
        
        if is_banned:
            # If banned, force the profile role to 'banned' so the frontend catches it
            profile["role"] = "banned"
            profile["status"] = "banned"
        elif profile.get("role") == "guest":
            # 🌟 NORMAL ROUTING LOGIC for active users 🌟
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
    """
    Fetches the currently logged-in user's profile data.
    """
    try:
        uid = user.get("uid")
        profile = UserService.get_profile(uid)
        return {"profile": profile}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- PROGRESSIVE ONBOARDING (OTP) ENDPOINTS ---

@router.post("/send-otp", tags=["User Management"])
async def send_student_otp(
    request: SendOtpRequest, 
    user: dict = Depends(get_active_user) # 🚨 THE BOUNCER: Banned users cannot request OTPs
):
    """Generates a 6-digit OTP, saves it temporarily to Firestore, and EMAILS it."""
    try:
        uid = user.get("uid") 
        safe_email = request.srm_email.strip().lower()

        if not safe_email.endswith("@srmist.edu.in"):
            raise HTTPException(status_code=400, detail="Must be a valid @srmist.edu.in email.")

        # THE UNIQUENESS CHECK
        existing_users = db.collection("users").where("srm_email", "==", safe_email).limit(1).stream()
        existing_user = next(existing_users, None)
        
        if existing_user and existing_user.id != uid:
            raise HTTPException(
                status_code=400, 
                detail="This SRM email is already registered to another account."
            )

        otp_code = str(random.randint(100000, 999999))
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        # Save to Firestore
        db.collection("otp_codes").document(safe_email).set({
            "code": otp_code,
            "expires_at": expires_at,
            "uid_requesting": uid 
        })
        
        # ACTUALLY SEND THE EMAIL
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
async def verify_student_otp(
    request: VerifyOtpRequest, 
    user: dict = Depends(get_active_user) # 🚨 THE BOUNCER: Banned users cannot verify OTPs
):
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
            
        # Use a batch to update the user AND unfreeze their old items!
        batch = db.batch()
        
        # 1. Update the main user document to make them an official student
        user_ref = db.collection("users").document(uid)
        batch.update(user_ref, {
            "role": "student",
            "srm_email": safe_email, 
            "verified_at": firestore.SERVER_TIMESTAMP
        })
        
        # 2. UNSUSPEND OLD LISTINGS
        user_listings = db.collection("listings").where("owner_id", "==", uid).stream()
        for doc in user_listings:
            if doc.to_dict().get("status") == "suspended":
                batch.update(doc.reference, {"status": "active"})
        
        # 3. Clean up the OTP document
        batch.delete(otp_ref)
        
        # Execute everything instantly
        batch.commit()
        
        return {"message": "Email verified! You are now an official student and your listings are live."}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))    


# ==========================================
# 📊 USER DASHBOARDS
# ==========================================

@router.get("/dashboard/student", tags=["Dashboards"])
async def get_student_dashboard(student: dict = Depends(get_verified_student)):
    """Locked to @srmist.edu.in users only (and banned users viewing their graveyard)."""
    uid = student.get("uid")
    try:
        # 1. Fetch all items owned by this user from the 'listings' collection
        docs = db.collection("listings").where("owner_id", "==", uid).stream()
        my_listings = [{"id": doc.id, **doc.to_dict()} for doc in docs]
        
        # 2. Return the profile info + their items!
        return {
            # 🚨 THE FIX: Make the role dynamic so it returns "banned" if they are suspended!
            "role": student.get("role"), 
            "message": f"Welcome to the SRM Marketplace, {student.get('email')}!",
            "uid": uid,
            "listings": my_listings
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))