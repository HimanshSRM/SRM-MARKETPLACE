from fastapi import APIRouter, Depends, HTTPException, Request, Query
from google.cloud import firestore
from datetime import datetime, timedelta, timezone
from firebase_admin import auth
from typing import Optional

from app.core.firebase import db
from app.core.security import get_admin_user, get_current_user, get_active_user 

# 🚨 IMPORTING ALL SCHEMAS FROM YOUR MODELS FILE
from app.models.admin import RoleUpdate, RejectRequest, ReportCreate, ModerateAction, GenericWarning, UserModerationPayload

router = APIRouter()

# ==========================================
# 🏪 SHOP MODERATION
# ==========================================
@router.get("/shops/pending", tags=["Admin - Shops"])
async def get_pending_shops(
    limit: int = Query(35, le=50), # ✅ Optimized Limit
    admin: dict = Depends(get_admin_user)
):
    """Fetches shop applications currently awaiting admin approval up to a safe layout limit."""
    try:
        shops = db.collection("shops").where("status", "==", "pending").limit(limit).stream()
        return {"data": [{"id": shop.id, **shop.to_dict()} for shop in shops]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/shops/{shop_id}/verify", tags=["Admin - Shops"])
async def verify_shop(
    shop_id: str, 
    request: Request, 
    admin: dict = Depends(get_admin_user)
):
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
            
        # 🚨 TRIGGER BACKGROUND ALERT TO USER
        await request.app.state.redis.enqueue_job(
            'process_push_notification',
            shop_id,
            "🏪 Shop Approved!",
            "Congratulations! Your shop application has been verified by the admin team.",
            "/dashboard"
        )
            
        return {"message": f"Shop {shop_id} officially verified and user promoted!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/shops/{shop_id}/reject", tags=["Admin - Shops"])
async def reject_shop(
    shop_id: str, 
    payload: RejectRequest, 
    request: Request, 
    admin: dict = Depends(get_admin_user)
):
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
            "rejection_reason": payload.reason,
            "rejected_by": admin.get("email"),
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        # 2. Demote the user back to GUEST so they see the correct restricted UI
        if owner_id:
            user_ref = db.collection("users").document(owner_id)
            if user_ref.get().exists:
                batch.update(user_ref, {"role": "guest"})

        # 3. Create the Official Appeal Ticket in the user's Inbox
        ticket_ref = db.collection("chat_rooms").document()
        batch.set(ticket_ref, {
            "is_ticket": True,
            "buyer_id": owner_id,
            "seller_id": "ADMIN_TEAM",
            "shop_id": shop_id,
            "subject": f"❌ Shop Application Rejected: {shop_data.get('shop_name', 'Your Shop')}",
            "last_message": f"Reason: {payload.reason}",
            "status": "open",
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "last_sender_id": "ADMIN_SYSTEM"
        })

        # 4. Drop the Official Red Box into the chat
        message_ref = ticket_ref.collection("messages").document()
        batch.set(message_ref, {
            "sender_id": "ADMIN_SYSTEM",
            "text": f"Your shop application was rejected by the admin team.\n\nReason: {payload.reason}\n\nYou can reply directly to this message to appeal this decision or ask for clarification.",
            "is_bid": False,
            "is_system_message": True,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP
        })

        batch.commit()
        
        # 🚨 TRIGGER BACKGROUND ALERT TO USER
        if owner_id:
            await request.app.state.redis.enqueue_job(
                'process_push_notification',
                owner_id,
                "❌ Shop Application Rejected",
                f"Reason: {payload.reason}",
                f"/chat/{ticket_ref.id}"
            )
        
        return {"message": f"Shop {shop_id} rejected. Appeal ticket created in user's inbox."}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🚨 GLOBAL USER MODERATION (Dark Panel)
# ==========================================
@router.post("/users/{uid}/moderate", tags=["Admin - Users"])
async def moderate_user(
    uid: str, 
    payload: UserModerationPayload, 
    request: Request, 
    admin: dict = Depends(get_admin_user)
):
    """Executes moderation action, cascades to their listings, and opens a direct thread with the abuser."""
    
    if payload.action not in ["warn", "ban", "restore", "nuke"]:
        raise HTTPException(status_code=400, detail="Invalid action.")

    try:
        user_ref = db.collection("users").document(uid)
        
        batch = db.batch()
        
        listings_by_owner = db.collection("listings").where("owner_id", "==", uid).stream()
        listings_by_seller = db.collection("listings").where("seller_id", "==", uid).stream()

        all_user_listings = {doc.id: doc for doc in listings_by_owner}
        for doc in listings_by_seller:
            all_user_listings[doc.id] = doc

        # 1. APPLY ACTION TO AUTH, PROFILE, AND LISTINGS
        if payload.action == "ban":
            user_ref.update({"status": "banned", "role": "banned", "banned_at": firestore.SERVER_TIMESTAMP})
            
            # 🚨 BUG 1 FIX: Suspend the User's Shop Document
            shop_doc = db.collection("shops").document(uid).get()
            if shop_doc.exists:
                batch.update(shop_doc.reference, {"status": "suspended"})
            
            # 🚨 BUG 2 FIX: Save the exact state to memory before suspending
            for doc_id, doc in all_user_listings.items():
                current_status = doc.to_dict().get("status", "active")
                batch.update(doc.reference, {
                    "status": "suspended",
                    "pre_ban_status": current_status
                })
                
        elif payload.action == "restore":
            user_data = user_ref.get().to_dict() or {}
            has_verified_srm_email = "srm_email" in user_data
            restored_role = "student" if has_verified_srm_email else "guest"
            
            # 🚨 BUG 1 FIX: Restore the Shop Document
            shop_doc = db.collection("shops").document(uid).get()
            if shop_doc.exists and shop_doc.to_dict().get("status") == "suspended":
                restored_role = "shop_verified"
                batch.update(shop_doc.reference, {"status": "approved"})

            user_ref.update({
                "status": "active", 
                "role": restored_role, 
                "banned_at": firestore.DELETE_FIELD
            })
            
            # 🚨 BUG 2 FIX: Read the memory and restore exact state
            for doc_id, doc in all_user_listings.items():
                doc_data = doc.to_dict()
                if doc_data.get("status") == "suspended":
                    old_status = doc_data.get("pre_ban_status", "active")
                    batch.update(doc.reference, {
                        "status": old_status,
                        "pre_ban_status": firestore.DELETE_FIELD
                    })
                    
        elif payload.action == "nuke":
            try:
                auth.delete_user(uid)
            except Exception:
                pass 
            user_ref.delete()
            for doc_id, doc in all_user_listings.items():
                batch.delete(doc.reference)

        if all_user_listings or payload.action in ["ban", "restore", "nuke"]:
            batch.commit()
        
        if payload.action in ["warn", "ban"]:
            user_doc = user_ref.get()
            if user_doc.exists:
                current_strikes = user_doc.to_dict().get("strikes", 0)
                user_ref.update({"strikes": current_strikes + 1})

        # 2. THE DIRECT THREAD ROUTING LOGIC
        if payload.action != "nuke":
            system_text = f"🚨 ADMIN ACTION: {payload.action.upper()}\n\nReason: {payload.reason}"
            if payload.action == "restore":
                system_text = f"✅ ADMIN ACTION: RESTORED\n\nMessage: {payload.reason}"

            target_room_query = db.collection("chat_rooms")\
                .where("is_ticket", "==", True)\
                .where("buyer_id", "==", uid)\
                .where("seller_id", "==", "ADMIN_TEAM")\
                .where("listing_id", "==", "USER_MODERATION")\
                .limit(1).stream()
                
            target_room = next(target_room_query, None)
            
            if target_room:
                t_room_ref = target_room.reference
                t_room_ref.update({
                    "last_message": system_text,
                    "status": "open",
                    "updated_at": firestore.SERVER_TIMESTAMP,
                    "last_sender_id": "ADMIN_SYSTEM"
                })
            else:
                t_room_ref = db.collection("chat_rooms").document()
                t_room_ref.set({
                    "is_ticket": True,
                    "buyer_id": uid,
                    "seller_id": "ADMIN_TEAM",
                    "listing_id": "USER_MODERATION",
                    "subject": "⚠️ OFFICIAL ADMIN NOTICE",
                    "last_message": system_text,
                    "status": "open",
                    "created_at": firestore.SERVER_TIMESTAMP,
                    "updated_at": firestore.SERVER_TIMESTAMP,
                    "last_sender_id": "ADMIN_SYSTEM"
                })
            
            t_room_ref.collection("messages").add({
                "sender_id": "ADMIN_SYSTEM", 
                "text": system_text,
                "is_system_message": True,   
                "timestamp": firestore.SERVER_TIMESTAMP
            })

            alert_title = f"🚨 Account {payload.action.capitalize()}ed"
            if payload.action == "restore":
                alert_title = "✅ Account Restored"
                
            await request.app.state.redis.enqueue_job(
                'process_push_notification',
                uid,
                alert_title,
                payload.reason,
                f"/chat/{t_room_ref.id}"
            )

        # 3. Resolve the original Reporter's Ticket
        if getattr(payload, "room_id", None):
            original_ticket_ref = db.collection("chat_rooms").document(payload.room_id)
            if original_ticket_ref.get().exists:
                original_ticket_ref.update({
                    "status": "resolved", 
                    "resolution_action": payload.action,
                    "updated_at": firestore.SERVER_TIMESTAMP
                })
                original_ticket_ref.collection("messages").add({
                    "sender_id": "ADMIN_SYSTEM", 
                    "text": f"✅ Moderation Action Taken against reported user.\n\nAction: {payload.action.upper()}\n\nThis ticket is now closed.",
                    "is_system_message": True,   
                    "timestamp": firestore.SERVER_TIMESTAMP
                })

        return {"message": f"User {payload.action}ed successfully. Listings updated."}

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
    """Search for a user by email to get their UID cleanly without collection-wide scanning."""
    try:
        users = db.collection("users").where("email", "==", email).limit(1).stream()
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
            
        batch = db.batch()
        batch.update(user_ref, {"role": request.role})
        
        # 1. If demoted to GUEST: Freeze their student items and shop
        if request.role == "guest":
            user_listings = db.collection("listings").where("owner_id", "==", uid).stream()
            for doc in user_listings:
                batch.update(doc.reference, {"status": "suspended"})
                
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

        batch.commit()
        return {"message": f"User {uid} role successfully updated to '{request.role}'. Assets synced."}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/warn/{target_uid}", tags=["Admin - Users"])
async def warn_user_generic(
    target_uid: str, 
    payload: GenericWarning, 
    request: Request, 
    admin: dict = Depends(get_current_user)
):
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
        
        # 🚨 TRIGGER BACKGROUND ALERT TO USER
        await request.app.state.redis.enqueue_job(
            'process_push_notification',
            target_uid,
            f"⚠️ OFFICIAL WARNING: {payload.subject}",
            payload.message,
            f"/chat/{room_ref.id}"
        )

        return {
            "message": "Warning sent and ticket created.",
            "room_id": room_ref.id 
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🎫 ADMINISTRATIVE SUPPORT & TICKETING
# ==========================================

@router.get("/tickets", tags=["Admin - Support"])
async def get_all_support_tickets(
    limit: int = Query(200, le=500), # 🚨 Bumped to 200 so the Admin UI can filter properly
    cursor: Optional[str] = Query(None),
    admin: dict = Depends(get_admin_user)
):
    """Fetches unified support tickets. Lifted limit and removed Firestore ordering to prevent ghosting legacy tickets."""
    try:
        # 🚨 Removed .order_by("updated_at") so older tickets without this field aren't ghosted
        query = db.collection("chat_rooms").where("seller_id", "==", "ADMIN_TEAM")
        
        if cursor:
            cursor_doc = db.collection("chat_rooms").document(cursor).get()
            if cursor_doc.exists:
                query = query.start_after(cursor_doc)
                
        tickets_stream = query.limit(limit).stream()
        results = []
        last_doc_id = None
        
        for doc in tickets_stream:
            data = doc.to_dict()
            if "created_at" in data and data["created_at"]:
                data["created_at"] = data["created_at"].isoformat()
            if "updated_at" in data and data["updated_at"]:
                data["updated_at"] = data["updated_at"].isoformat()
                
            results.append({
                "id": doc.id,
                "chat_room_id": doc.id, 
                **data
            })
            last_doc_id = doc.id
            
        # 🚨 Python handles the sorting perfectly here without dropping missing fields!
        results.sort(key=lambda x: str(x.get("updated_at") or x.get("created_at") or ""), reverse=True)
            
        return {
            "data": results,
            "next_cursor": last_doc_id if len(results) == limit else None,
            "count": len(results)
        }
    except Exception as e:
        print(f"\n🔥 FIRESTORE TICKETS READ ERROR: {str(e)}\n")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 🛡️ TRUST & SAFETY (ITEM REPORTING & MODERATION)
# ==========================================

@router.get("/listings", tags=["Admin - Moderation"])
async def get_all_listings(
    limit: int = Query(35, le=50), # ✅ Optimized Limit
    cursor: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    reported_only: bool = Query(False),
    admin: dict = Depends(get_admin_user)
):
    """Fetches a paginated list of all student listings for the Admin Products Tab."""
    try:
        query = db.collection("listings")
        
        if reported_only:
            query = query.where("report_count", ">", 0).order_by("report_count", direction=firestore.Query.DESCENDING)
        else:
            query = query.order_by("created_at", direction=firestore.Query.DESCENDING)
            
        if status:
            query = query.where("status", "==", status)
            
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
            if "updated_at" in item and item["updated_at"]:
                item["updated_at"] = item["updated_at"].isoformat()
                
            results.append(item)
            last_doc_id = doc.id
            
        return {
            "data": results,
            "next_cursor": last_doc_id if len(results) == limit else None,
            "count": len(results)
        }
    except Exception as e:
        print(f"\n🔥 FIRESTORE LISTINGS INDEX ERROR: {str(e)}\n") 
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/listings/{listing_id}/report", tags=["Trust & Safety"])
async def report_listing(
    listing_id: str, 
    payload: ReportCreate, 
    user: dict = Depends(get_active_user)
):
    """Unified route to report student listings or subcollection shop catalog items securely."""
    uid = user.get("uid")
    try:
        target_ref = None
        listing_data = None
        is_shop_item = False
        shop_id_found = None

        # 🚨 SMART LOOKUP 1: Check native root student listings
        listing_doc = db.collection("listings").document(listing_id).get()
        if listing_doc.exists:
            target_ref = listing_doc.reference
            listing_data = listing_doc.to_dict()
        else:
            # 🚨 OPTIMIZED LOOKUP 2: Collection Group Query replaces the old O(N) database scan loops entirely
            catalog_query = db.collection_group("catalog").where(
                firestore.FieldPath.document_id(), "==", listing_id
            ).limit(1).stream()
            
            catalog_docs = list(catalog_query)
            if catalog_docs:
                item_doc = catalog_docs[0]
                target_ref = item_doc.reference
                listing_data = item_doc.to_dict()
                is_shop_item = True
                shop_id_found = target_ref.parent.parent.id

        if not target_ref or not listing_data:
            raise HTTPException(status_code=404, detail="Item not found in the database.")
            
        reported_by = listing_data.get("reported_by", [])
        
        # SPAM FILTER & LIVE ESCALATION TRACKER
        if uid in reported_by:
            existing_tickets = db.collection("chat_rooms")\
                .where("buyer_id", "==", uid)\
                .where("listing_id", "==", listing_id)\
                .where("is_ticket", "==", True)\
                .limit(1).get()
                
            if existing_tickets:
                doc_ref = existing_tickets[0].reference
                doc_ref.update({
                    "status": "open",
                    "updated_at": firestore.SERVER_TIMESTAMP,
                    "last_message": f"🚨 ESCALATED: Product reported again: {payload.reason}",
                    "severity": "high"
                })
                doc_ref.collection("messages").add({
                    "sender_id": "ADMIN_SYSTEM",
                    "text": f"📥 The Reporter added additional information to this ticket:\n\nReason: {payload.reason}\nDetails: {payload.details}",
                    "is_system_message": True,
                    "timestamp": firestore.SERVER_TIMESTAMP
                })
            raise HTTPException(status_code=400, detail="You already reported this product. We have escalated your previous report.")
            
        reported_by.append(uid)
        new_report_count = listing_data.get("report_count", 0) + 1
        update_payload = {"reported_by": reported_by, "report_count": new_report_count}
        
        # Auto-hide threshold mapping
        if new_report_count >= 3:
            if is_shop_item:
                update_payload["is_available"] = False
            else:
                update_payload["status"] = "suspended" 

        target_ref.update(update_payload)
        
        ticket_ref = db.collection("chat_rooms").document()
        ticket_ref.set({
            "is_ticket": True,
            "buyer_id": uid, 
            "seller_id": "ADMIN_TEAM",
            "listing_id": listing_id,
            "shop_id": shop_id_found,
            "is_shop_item": is_shop_item,
            "listing_title": listing_data.get('title') or listing_data.get('name') or 'Unknown Item',
            "subject": f"🚩 REPORT: {listing_data.get('title') or listing_data.get('name') or 'Unknown Item'}",
            "last_message": f"Reason: {payload.reason}. {payload.details}",
            "status": "open",
            "severity": "high" if new_report_count >= 3 else "low",
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        return {"message": "Listing reported successfully. Our team will review it shortly."}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/listings/{listing_id}/moderate", tags=["Trust & Safety"])
async def moderate_listing(
    listing_id: str, 
    payload: ModerateAction, 
    request: Request,
    admin: dict = Depends(get_admin_user)
):
    """Executes Warn, Hide, Delete, or Restore actions ON A SPECIFIC ITEM and alerts the seller."""
    
    if payload.action not in ["warn", "hide", "delete", "restore"]:
        raise HTTPException(status_code=400, detail="Invalid action. Use warn, hide, delete, or restore.")

    try:
        seller_id = None
        item_title = "Unknown Item"
        
        if payload.shop_id:
            listing_ref = db.collection("shops").document(payload.shop_id).collection("catalog").document(listing_id)
        else:
            listing_ref = db.collection("listings").document(listing_id)

        listing_doc = listing_ref.get()
        
        if not listing_doc.exists:
            raise HTTPException(status_code=404, detail="Item not found in the database.")
            
        listing_data = listing_doc.to_dict()
        seller_id = payload.shop_id if payload.shop_id else (listing_data.get("owner_id") or listing_data.get("seller_id"))
        item_title = listing_data.get("name") or listing_data.get("title", "Marketplace Item")
            
        if not seller_id:
            raise HTTPException(status_code=400, detail="Could not find the owner's ID for this item.")
            
        if payload.action == "hide":
            listing_ref.update({"status": "hidden"})
        elif payload.action == "delete":
            listing_ref.delete()
        elif payload.action == "restore":
            listing_ref.update({"status": "active"})
            
        if payload.action in ["hide", "delete"]:
            seller_ref = db.collection("users").document(seller_id)
            seller_doc = seller_ref.get()
            if seller_doc.exists:
                current_strikes = seller_doc.to_dict().get("strikes", 0)
                seller_ref.update({"strikes": current_strikes + 1})

        warning_subject = f"⚠️ OFFICIAL WARNING regarding '{item_title}'"
        if payload.action == "hide":
            warning_subject = f"🛑 ACTION REQUIRED: '{item_title}' has been hidden"
        elif payload.action == "delete":
            warning_subject = f"⛔ LISTING DELETED: '{item_title}'"
        elif payload.action == "restore":
            warning_subject = f"✅ LISTING RESTORED: '{item_title}'"

        existing_rooms = db.collection("chat_rooms")\
            .where("is_ticket", "==", True)\
            .where("buyer_id", "==", seller_id)\
            .where("seller_id", "==", "ADMIN_TEAM")\
            .where("listing_id", "==", listing_id)\
            .limit(1).stream()
            
        existing_room = next(existing_rooms, None)

        if existing_room:
            room_ref = existing_room.reference
            room_ref.update({
                "subject": warning_subject,
                "last_message": f"Message: {payload.reason}",
                "status": "open", 
                "resolution_action": payload.action,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "last_sender_id": "ADMIN_SYSTEM" 
            })
        else:
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
                "last_sender_id": "ADMIN_SYSTEM"
            })
            
        room_ref.collection("messages").add({
            "sender_id": "ADMIN_SYSTEM", 
            "text": f"Admin Action Taken: {payload.action.upper()}\n\nMessage: {payload.reason}",
            "is_bid": False,
            "is_system_message": True, 
            "timestamp": firestore.SERVER_TIMESTAMP,
            "created_at": firestore.SERVER_TIMESTAMP
        })
        
        await request.app.state.redis.enqueue_job(
            'process_push_notification',
            seller_id,
            warning_subject,
            payload.reason,
            f"/chat/{room_ref.id}"
        )

        return {"message": f"Item successfully {payload.action}ed.", "status": "success"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))