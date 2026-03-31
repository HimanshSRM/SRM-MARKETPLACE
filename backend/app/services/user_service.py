from fastapi import HTTPException
from google.cloud import firestore
from app.core.firebase import db

class UserService:
    @staticmethod
    def sync_user_profile(uid: str, email: str, name: str, selected_role: str) -> dict:
        """Checks if a user exists. If not, creates a fresh profile with the correct role."""
        user_ref = db.collection("users").document(uid)
        user_doc = user_ref.get()
        
        if user_doc.exists:
            return user_doc.to_dict()
            
        # 🛡️ Dynamic role assignment: Based on frontend selection AND email domain
        assigned_role = "guest" # Default fallback for security
        
        if selected_role == "student":
            if email.endswith("@srmist.edu.in"):
                assigned_role = "student"
            else:
                assigned_role = "guest" # Denied: Tried to be a student without the right email
                
        elif selected_role == "shop":
            # Shops MUST start as guests until admin approval
            assigned_role = "guest"
        
        new_user = {
            "uid": uid,
            "email": email,
            "name": name,
            "role": assigned_role,
            "reputation_score": 5.0 if assigned_role == "student" else 0.0
        }
        
        user_ref.set(new_user)
        return new_user

    @staticmethod
    def get_profile(uid: str) -> dict:
        """Fetches a specific user profile."""
        user_doc = db.collection("users").document(uid).get()
        
        if not user_doc.exists:
            raise HTTPException(status_code=404, detail="Profile not found. Please sync first.")
            
        return user_doc.to_dict()