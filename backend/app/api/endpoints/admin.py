from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore
from datetime import datetime, timedelta, timezone
from firebase_admin import auth

from app.core.firebase import db
from app.core.security import get_admin_user, get_current_user , get_active_user 

# 🚨 IMPORTING ALL SCHEMAS FROM YOUR MODELS FILE
from app.models.admin import RoleUpdate, RejectRequest, ReportCreate, ModerateAction, GenericWarning, UserModerationPayload

router = APIRouter()

# ==========================================
# 🏪 SHOP MODERATION
# ==========================================
@router.get("/shops/pending", tags=["Admin - Shops"])
async def get_pending_shops(admin: dict = Depends(get_admin_user)):
    """Fetches all shop applications currently awaiting admin approval."""
    try:
        shops = db.collection("shops").where("status", "==", "pending").stream()
        return {"data": [{"id": shop.id, **shop.to_dict()} for shop in shops]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/shops/{shop_id}/verify", tags=["Admin - Shops"])
async def verify_shop(shop_id: str, admin: dict = Depends(get_admin_user)):
    """Approves a shop and updates the user's official role."""
    try:
        shop_ref = db.collection("shops").document(shop_id)
        if not shop_ref.get().exists:
            raise HTTPException(status_code=404, detail="Shop application not found.")
            
        shop_ref.update({
            "is_verified": True,
            "status": "approved",
            "approved_by": admin.get("email"),
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        user_ref = db.collection("users").document(shop_id) 
        if user_ref.get().exists:
            user_ref.update({"role": "shop_verified"})
            
        return {"message": f"Shop {shop_id} officially verified and user promoted!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/shops/{shop_id}/reject", tags=["Admin - Shops"])
async def reject_shop(shop_id: str, request: RejectRequest, admin: dict = Depends(get_admin_user)):
    """Rejects a shop application, demotes the user to guest, and opens an appeal ticket."""
    try:
        shop_ref = db.collection("shops").document(shop_id)
        shop_doc = shop_ref.get()
        
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail="Shop application not found.")
            
        shop_data = shop_doc.to_dict()
        owner_id = shop_data.get("owner_id", shop_id)

        batch = db.batch()

        # 1. Reject the Shop Document
        batch.update(shop_ref, {
            "is_verified": False,
            "status": "rejected",
            "rejection_reason": request.reason,
            "rejected_by": admin.get("email"),
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        # 2. 🚨 Demote the user back to GUEST so they see the correct restricted UI
        if owner_id:
            user_ref = db.collection("users").document(owner_id)
            if user_ref.get().exists:
                batch.update(user_ref, {"role": "guest"})

        # 3. 📬 Create the Official Appeal Ticket in the user's Inbox
        ticket_ref = db.collection("chat_rooms").document()
        batch.set(ticket_ref, {
            "is_ticket": True,
            "buyer_id": owner_id,
            "seller_id": "ADMIN_TEAM",
            "shop_id": shop_id,
            "subject": f"❌ Shop Application Rejected: {shop_data.get('shop_name', 'Your Shop')}",
            "last_message": f"Reason: {request.reason}",
            "status": "open",
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "last_sender_id": "ADMIN_SYSTEM"
        })

        # 4. Drop the Official Red Box into the chat
        message_ref = ticket_ref.collection("messages").document()
        batch.set(message_ref, {
            "sender_id": "ADMIN_SYSTEM",
            "text": f"Your shop application was rejected by the admin team.\n\nReason: {request.reason}\n\nYou can reply directly to this message to appeal this decision or ask for clarification.",
            "is_bid": False,
            "is_system_message": True,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP
        })

        # Execute everything at once!
        batch.commit()
        
        return {"message": f"Shop {shop_id} rejected. Appeal ticket created in user's inbox."}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🚨 GLOBAL USER MODERATION (Dark Panel)
# ==========================================
@router.post("/users/{uid}/moderate", tags=["Admin Users"])
async def moderate_user(uid: str, payload: UserModerationPayload, admin: dict = Depends(get_admin_user)):
    """Executes moderation action, cascades to their listings, and sends system message."""
    
    if payload.action not in ["warn", "ban", "restore", "nuke"]:
        raise HTTPException(status_code=400, detail="Invalid action.")

    try:
        user_ref = db.collection("users").document(uid)
        
        # 🚨 THE BULLETPROOF CASCADE BATCH
        batch = db.batch()
        
        # Query BOTH possible ID fields to ensure we don't miss a single item
        listings_by_owner = db.collection("listings").where("owner_id", "==", uid).stream()
        listings_by_seller = db.collection("listings").where("seller_id", "==", uid).stream()

        # Combine them into one dictionary to avoid duplicates
        all_user_listings = {doc.id: doc for doc in listings_by_owner}
        for doc in listings_by_seller:
            all_user_listings[doc.id] = doc

        # 1. APPLY ACTION TO AUTH, PROFILE, AND LISTINGS
        if payload.action == "ban":
            user_ref.update({"status": "banned", "role": "banned","banned_at": firestore.SERVER_TIMESTAMP})
            
            # Cascade: Hide all their items instantly
            for doc_id, doc in all_user_listings.items():
                batch.update(doc.reference, {"status": "suspended"})
                
        elif payload.action == "restore":
            # 🚨 THE FIX: Check for the verified SRM email field, NOT their primary email!
            user_data = user_ref.get().to_dict() or {}
            
            # Check if they successfully verified an SRM email in the past
            has_verified_srm_email = "srm_email" in user_data
            
            # Smart role assignment: Give them student if they verified, else guest
            restored_role = "student" if has_verified_srm_email else "guest"
            
            # Check if they actually own a verified shop to restore that role instead
            shop_doc = db.collection("shops").document(uid).get()
            if shop_doc.exists and shop_doc.to_dict().get("status") == "approved":
                restored_role = "shop_verified"

            user_ref.update({
                "status": "active", 
                "role": restored_role, # <-- This puts them back as a student/shop!
                "banned_at": firestore.DELETE_FIELD
            })
            
            # Cascade: Bring their items back to life
            for doc_id, doc in all_user_listings.items():
                if doc.to_dict().get("status") == "suspended":
                    batch.update(doc.reference, {"status": "active"})
                    
        elif payload.action == "nuke":
            try:
                auth.delete_user(uid)
            except Exception:
                pass 
            user_ref.delete()
            
            # Cascade: Erase all their items from existence
            for doc_id, doc in all_user_listings.items():
                batch.delete(doc.reference)

        # 💥 COMMIT THE BATCH (Executes all listing changes instantly)
        if all_user_listings or payload.action in ["ban", "restore", "nuke"]:
            batch.commit()
        
        # 2. Track Strikes (Only for Warn or Ban)
        if payload.action in ["warn", "ban"]:
            user_doc = user_ref.get()
            if user_doc.exists:
                current_strikes = user_doc.to_dict().get("strikes", 0)
                user_ref.update({"strikes": current_strikes + 1})

        # 3. Inject the Official Action Message into the existing Chat Room
        messages_ref = db.collection("chat_rooms").document(payload.room_id).collection("messages")
        
        system_text = f"🚨 ADMIN ACTION: {payload.action.upper()}\n\nReason: {payload.reason}"
        if payload.action == "restore":
            system_text = f"✅ ADMIN ACTION: RESTORED\n\nMessage: {payload.reason}"

        messages_ref.add({
            "sender_id": "ADMIN_SYSTEM", 
            "text": system_text,
            "is_system_message": True,   
            "timestamp": firestore.SERVER_TIMESTAMP
        })

        # 🚨 NEW: Update the room document with the final action so the Audit Log can filter it
        db.collection("chat_rooms").document(payload.room_id).update({
            "resolution_action": payload.action
        })

        return {"message": f"User {payload.action}ed successfully. Listings updated."}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🚩 STUDENT ACTION - REPORT LISTING
# ==========================================
@router.post("/listings/{listing_id}/report", tags=["Trust & Safety"])
async def report_listing(listing_id: str, payload: ReportCreate, user: dict = Depends(get_active_user)):
    """Allows a user to flag a listing. Prevents duplicate reporting."""
    uid = user.get("uid")
    
    try:
        listing_ref = db.collection("listings").document(listing_id)
        listing_doc = listing_ref.get()
        
        if not listing_doc.exists:
            raise HTTPException(status_code=404, detail="Listing not found.")
            
        listing_data = listing_doc.to_dict()
        
        # 🛡️ Anti-Spam Check: Has this user already reported this item?
        reported_by = listing_data.get("reported_by", [])
        if uid in reported_by:
            raise HTTPException(status_code=400, detail="You have already reported this listing.")
            
        # 1. Update the listing's report count
        reported_by.append(uid)
        new_report_count = listing_data.get("report_count", 0) + 1
        
        listing_ref.update({
            "reported_by": reported_by,
            "report_count": new_report_count
        })
        
        # 2. Create an internal ticket for the Admin to review in their inbox!
        ticket_ref = db.collection("chat_rooms").document()
        ticket_ref.set({
            "is_ticket": True,
            "buyer_id": uid, # The reporter
            "seller_id": "ADMIN_TEAM",
            "listing_id": listing_id,
            "listing_title": listing_data.get('title', 'Unknown Item'),
            "subject": f"🚩 REPORT: {listing_data.get('title', 'Unknown Item')}",
            "last_message": f"Reason: {payload.reason}. {payload.details}",
            "status": "open",
            "severity": "high" if new_report_count >= 3 else "low", # Auto-escalation!
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        return {"message": "Listing reported successfully. Our team will review it shortly."}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🚨 ITEM MODERATION (Red Panel)
# ==========================================
@router.post("/listings/{listing_id}/moderate", tags=["Trust & Safety"])
async def moderate_listing(listing_id: str, payload: ModerateAction, admin: dict = Depends(get_admin_user)):
    """Executes Warn, Hide, Delete, or Restore actions ON A SPECIFIC ITEM and alerts the seller."""
    
    if payload.action not in ["warn", "hide", "delete", "restore"]:
        raise HTTPException(status_code=400, detail="Invalid action. Use warn, hide, delete, or restore.")

    try:
        seller_id = None
        item_title = "Unknown Item"
        
        # 1. 🛡️ Determine if it's a Shop Item OR a Student Listing and get the reference
        if payload.shop_id:
            listing_ref = db.collection("shops").document(payload.shop_id).collection("catalog").document(listing_id)
        else:
            listing_ref = db.collection("listings").document(listing_id)

        listing_doc = listing_ref.get()
        
        if not listing_doc.exists:
            raise HTTPException(status_code=404, detail="Item not found in the database.")
            
        listing_data = listing_doc.to_dict()
        
        # 🚨 GRAB THE SELLER ID & TITLE
        seller_id = payload.shop_id if payload.shop_id else (listing_data.get("owner_id") or listing_data.get("seller_id"))
        item_title = listing_data.get("name") or listing_data.get("title", "Marketplace Item")
            
        if not seller_id:
            raise HTTPException(status_code=400, detail="Could not find the owner's ID for this item.")
            
        # 2. 📝 Apply the Action to the Listing
        if payload.action == "hide":
            listing_ref.update({"status": "hidden"})
        elif payload.action == "delete":
            listing_ref.delete() # Actually delete the document
        elif payload.action == "restore":
            listing_ref.update({"status": "active"})
        # Note: "warn" does not change the listing status at all.
            
        # 3. 📈 Track Strikes (If it's a Hide or Delete, give them a strike)
        if payload.action in ["hide", "delete"]:
            seller_ref = db.collection("users").document(seller_id)
            seller_doc = seller_ref.get()
            if seller_doc.exists:
                current_strikes = seller_doc.to_dict().get("strikes", 0)
                seller_ref.update({"strikes": current_strikes + 1})

        # 4. 📬 Format the Official Subject Line
        warning_subject = f"⚠️ OFFICIAL WARNING regarding '{item_title}'"
        if payload.action == "hide":
            warning_subject = f"🛑 ACTION REQUIRED: '{item_title}' has been hidden"
        elif payload.action == "delete":
            warning_subject = f"⛔ LISTING DELETED: '{item_title}'"
        elif payload.action == "restore":
            warning_subject = f"✅ LISTING RESTORED: '{item_title}'"

        # 5. 🔍 Find the EXACT existing Warning Thread (Prevents Duplicate Chats!)
        existing_rooms = db.collection("chat_rooms")\
            .where("is_ticket", "==", True)\
            .where("buyer_id", "==", seller_id)\
            .where("seller_id", "==", "ADMIN_TEAM")\
            .where("listing_id", "==", listing_id)\
            .limit(1).stream()
            
        existing_room = next(existing_rooms, None)

        if existing_room:
            # ♻️ Room exists! Forcefully Re-open it and update the subject
            room_ref = existing_room.reference
            room_ref.update({
                "subject": warning_subject,
                "last_message": f"Message: {payload.reason}",
                "status": "open", # 🚨 Forces the UI input box to reappear!
                "resolution_action": payload.action,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "last_sender_id": "ADMIN_SYSTEM" # 🚨 Ensure UI knows it's an official message
            })
        else:
            # 🆕 First offense: Create a brand new thread
            room_ref = db.collection("chat_rooms").document()
            room_ref.set({
                "is_ticket": True,
                "buyer_id": seller_id, 
                "seller_id": "ADMIN_TEAM",
                "listing_id": listing_id,
                "shop_id": payload.shop_id if payload.shop_id else None,
                "subject": warning_subject,
                "last_message": f"Message: {payload.reason}",
                "status": "open",
                "resolution_action": payload.action,
                "created_at": firestore.SERVER_TIMESTAMP,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "last_sender_id": "ADMIN_SYSTEM" # 🚨 Ensure UI knows it's an official message
            })
            
        # 6. 🚨 Add the Official System Message (Creates the RED BOX)
        room_ref.collection("messages").add({
            "sender_id": "ADMIN_SYSTEM", # 🚨 GUARANTEES the React UI renders the Red Box!
            "text": f"Admin Action Taken: {payload.action.upper()}\n\nMessage: {payload.reason}",
            "is_bid": False,
            "is_system_message": True, 
            "timestamp": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP
        })

        return {"message": f"Item successfully {payload.action}ed.", "status": "success"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 👤 USER DIRECTORY & MANAGEMENT
# ==========================================
@router.get("/users", tags=["Admin - Users"])
async def get_all_users(admin: dict = Depends(get_admin_user)):
    """Fetches a master list of users for the admin directory."""
    try:
        users = db.collection("users").limit(200).stream()
        results = [{"uid": user.id, **user.to_dict()} for user in users]
        return {"data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/users/search", tags=["Admin - Users"])
async def search_user_by_email(email: str, admin: dict = Depends(get_admin_user)):
    """Search for a user by email to get their UID."""
    try:
        users = db.collection("users").where("email", "==", email).stream()
        results = [{"uid": user.id, **user.to_dict()} for user in users]
        
        if not results:
            raise HTTPException(status_code=404, detail="No user found with that email.")
            
        return {"data": results}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/users/{uid}/role", tags=["Admin - Users"])
async def set_user_role(uid: str, request: RoleUpdate, admin: dict = Depends(get_admin_user)):
    """Master switchboard to set ANY user's role, with automatic asset suspension/restoration."""
    try:
        valid_roles = ["student", "guest", "shop_verified", "admin", "banned"]
        if request.role not in valid_roles:
            raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {valid_roles}")

        user_ref = db.collection("users").document(uid)
        if not user_ref.get().exists:
            raise HTTPException(status_code=404, detail="User not found.")
            
        # 🚨 Create a batch to update the role AND cascade to their items instantly
        batch = db.batch()
        batch.update(user_ref, {"role": request.role})
        
        # 1. If demoted to GUEST: Freeze their student items and shop
        if request.role == "guest":
            # Suspend student listings
            user_listings = db.collection("listings").where("owner_id", "==", uid).stream()
            for doc in user_listings:
                batch.update(doc.reference, {"status": "suspended"})
                
            # Suspend their shop (if they have one)
            shop_ref = db.collection("shops").document(uid)
            if shop_ref.get().exists:
                batch.update(shop_ref, {"status": "suspended", "is_verified": False})

        # 2. If promoted to STUDENT: Unfreeze their personal listings
        elif request.role == "student":
            user_listings = db.collection("listings").where("owner_id", "==", uid).stream()
            for doc in user_listings:
                if doc.to_dict().get("status") == "suspended":
                    batch.update(doc.reference, {"status": "active"})

        # 3. If promoted to SHOP_VERIFIED: Unfreeze their shop AND listings
        elif request.role == "shop_verified":
            user_listings = db.collection("listings").where("owner_id", "==", uid).stream()
            for doc in user_listings:
                if doc.to_dict().get("status") == "suspended":
                    batch.update(doc.reference, {"status": "active"})
                    
            shop_ref = db.collection("shops").document(uid)
            if shop_ref.get().exists:
                batch.update(shop_ref, {"status": "approved", "is_verified": True})

        # Execute the cascade!
        batch.commit()
        
        return {"message": f"User {uid} role successfully updated to '{request.role}'. Assets synced."}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/warn/{target_uid}", tags=["Admin - Users"])
async def warn_user_generic(target_uid: str, payload: GenericWarning, admin: dict = Depends(get_current_user)):
    """Creates a generic warning support ticket not tied to a listing."""
    role = admin.get("role", "guest")
    email = admin.get("email", "")
    
    if role != "admin" and email != "himanshyadav202@gmail.com":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    try:
        room_ref = db.collection("chat_rooms").document()
        room_ref.set({
            "is_ticket": True,
            "buyer_id": target_uid,
            "seller_id": "ADMIN_TEAM",
            "listing_id": "USER_MODERATION",
            "subject": payload.subject,
            "last_message": payload.message,
            "status": "open",
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "last_sender_id": "ADMIN_TEAM"
        })
        
        room_ref.collection("messages").add({
            "sender_id": "ADMIN_TEAM",
            "text": payload.message,
            "is_bid": False,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP
        })

        # 🚨 Returns the room_id so the frontend can redirect the admin directly into the chat
        return {
            "message": "Warning sent and ticket created.",
            "room_id": room_ref.id 
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

# ==========================================
# 🛡️ SUPPORT TICKETS (Unified Inbox)
# ==========================================
@router.get("/tickets", tags=["Admin - Support"])
async def get_all_support_tickets(admin: dict = Depends(get_admin_user)):
    """Fetches all unified support tickets (Reports, Warnings, Disputes) from the chat_rooms collection."""
    try:
        # 🚨 This grabs ALL tickets generated by the new moderation engine
        tickets_query = db.collection("chat_rooms").where("seller_id", "==", "ADMIN_TEAM").stream()
        
        results = []
        for doc in tickets_query:
            data = doc.to_dict()
            results.append({
                "id": doc.id,
                "chat_room_id": doc.id, # Ensures React knows which chat room to open
                **data
            })
        
        # Sort newest first
        results.sort(key=lambda x: str(x.get("updated_at") or x.get("created_at") or ""), reverse=True)
        
        return {"data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))    