from fastapi import HTTPException
from google.cloud import firestore
from app.core.firebase import db

class UserService:
    @staticmethod
    def sync_user_profile(uid: str, email: str, name: str, selected_role: str) -> dict:
        """
        Called on login. Checks if a user exists. 
        If they exist, it returns the doc AS IS (preserving bans/roles).
        If not, creates a fresh profile.
        """
        user_ref = db.collection("users").document(uid)
        user_doc = user_ref.get()
        
        if user_doc.exists:
            user_data = user_doc.to_dict()
            
            # 🚨 ANTI-BYPASS: If the user is already in the DB, we return their data immediately.
            # This ensures that if an Admin set their role to 'banned', this sync call 
            # won't accidentally reset them to 'student' or 'guest'.
            return user_data
            
        # --- NEW USER CREATION LOGIC ---
        
        # 🛡️ Dynamic role assignment: Based on frontend selection AND email domain
        assigned_role = "guest" # Default fallback for security
        
        if selected_role == "student":
            # Only auto-promote if they are logging in with their SRM email directly
            if email and email.endswith("@srmist.edu.in"):
                assigned_role = "student"
            else:
                assigned_role = "guest"
                
        elif selected_role == "shop":
            # Shops always start as guests until they fill out the application
            assigned_role = "guest"
        
        new_user = {
            "uid": uid,
            "email": email,
            "name": name,
            "role": assigned_role,
            "status": "active", # 🚨 Default status for all new law-abiding citizens
            "strikes": 0,
            "reputation_score": 5.0 if assigned_role == "student" else 0.0,
            "created_at": firestore.SERVER_TIMESTAMP
        }
        
        user_ref.set(new_user)
        return new_user

    @staticmethod
    def get_profile(uid: str) -> dict:
        """
        Fetches a specific user profile. 
        Used by the /me endpoint and for internal checks.
        """
        user_doc = db.collection("users").document(uid).get()
        
        if not user_doc.exists:
            raise HTTPException(status_code=404, detail="Profile not found. Please sync first.")
            
        profile = user_doc.to_dict()
        
        # 🟢 OPTION B SUPPORT: We return the profile even if banned.
        # The 'security.py' and 'AuthContext' will handle the actual blocking.
        return profile