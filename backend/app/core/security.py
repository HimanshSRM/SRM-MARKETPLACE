from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth

from app.core.firebase import db

# This tells FastAPI to look for the "Authorization: Bearer <token>" header
security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    DOOR 1 (Base): Verifies the Firebase ID token. 
    Lets ANYONE with a valid token in (Gmail, SRM, Phone Auth, etc.).
    """
    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

def get_user_document(user: dict = Depends(get_current_user)):
    """
    THE CHECKPOINT: Fetches the user's official profile from Firestore.
    This acts as the single source of truth for their RBAC role.
    """
    uid = user.get("uid")
    user_doc = db.collection("users").document(uid).get()
    
    if not user_doc.exists:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="User profile not found. Please log in to sync your account."
        )
        
    # Merge the Firebase Auth token data with their official Database data
    return {**user, **user_doc.to_dict()}


def get_verified_student(user_data: dict = Depends(get_user_document)):
    """
    DOOR 2 (Strict Student): Only allows officially verified Students (and Admins).
    Use this for POSTING standard classified ads. Keeps Shops and Guests out.
    """
    if user_data.get("role") not in ["student", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only verified students can post standard ads."
        )
    return user_data


def get_verified_shop(user_data: dict = Depends(get_user_document)):
    """
    DOOR 3 (Strict Shop): Only allows Admin-approved Shops.
    Use this for posting items to a shop's catalog.
    """
    if user_data.get("role") != "shop_verified": 
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Access Denied. Your shop account is pending admin approval or you are not registered as a shop."
        )
    return user_data


def get_marketplace_user(user_data: dict = Depends(get_user_document)):
    """
    DOOR 4 (Public Browsing): Allows Guests, Students, Verified Shops, OR Admins.
    Used ONLY for viewing the public feeds, products, and directories.
    """
    if user_data.get("role") not in ["guest", "student", "shop_verified", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Invalid user profile."
        )
    return user_data


def get_transacting_user(user_data: dict = Depends(get_user_document)):
    """
    DOOR 5 (Interactive Features): Allows Students, Verified Shops, and Admins.
    STRICTLY BLOCKS GUESTS.
    Used for Messaging, Bidding, and Buying.
    """
    if user_data.get("role") not in ["student", "shop_verified", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guest accounts cannot send messages or place bids. Please verify your campus email."
        )
    return user_data


def get_admin_user(user_data: dict = Depends(get_user_document)):
    """
    DOOR 6 (God Mode): Strictly for Super Admins.
    Used for moderating shops, users, and listings.
    """
    if user_data.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied. You do not have administrator privileges."
        )
    return user_data