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


# 🚨 NEW: THE BOUNCER
def get_active_user(user_data: dict = Depends(get_user_document)):
    """
    THE BOUNCER: Checks if the user is suspended.
    This is the base for any write operations (POST, PUT, DELETE).
    """
    if user_data.get("role") == "banned" or user_data.get("status") == "banned":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been suspended. You are in read-only mode."
        )
    return user_data


def get_verified_student(user_data: dict = Depends(get_user_document)):
    """
    DOOR 2 (Student Dashboard): Allows Students, Admins, AND Banned users.
    Use this for GET routes (like viewing the student dashboard graveyard).
    """
    # 🚨 Bypassed the active_user bouncer and added "banned"
    if user_data.get("role") not in ["student", "admin", "banned"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only verified students can access this."
        )
    return user_data


def get_verified_shop(user_data: dict = Depends(get_user_document)):
    """
    DOOR 3 (Shop Dashboard): Allows Approved Shops AND Banned users.
    Use this for GET routes (like viewing the shop dashboard graveyard).
    """
    # 🚨 Bypassed the active_user bouncer and added "banned"
    if user_data.get("role") not in ["shop_verified", "banned"]: 
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Access Denied. Your shop account is pending or suspended."
        )
    return user_data


def get_marketplace_user(user_data: dict = Depends(get_user_document)):
    """
    DOOR 4 (Public Browsing): Allows EVERYONE in the database.
    Used ONLY for viewing the public feeds, products, and directories.
    🚨 Notice this relies on `get_user_document`, completely bypassing the Bouncer!
    """
    allowed_roles = ["guest", "student", "shop", "shop_verified", "admin", "banned"]
    
    if user_data.get("role") not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Invalid user profile."
        )
    return user_data


def get_transacting_user(user_data: dict = Depends(get_active_user)):
    """
    DOOR 5 (Interactive Features): Allows Students, Verified Shops, and Admins.
    STRICTLY BLOCKS GUESTS AND BANNED USERS.
    Used for Messaging, Bidding, and Buying.
    """
    if user_data.get("role") not in ["student", "shop_verified", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guest accounts cannot send messages or place bids. Please verify your campus email."
        )
    return user_data


def get_admin_user(user_data: dict = Depends(get_active_user)):
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