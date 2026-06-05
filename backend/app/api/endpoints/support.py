from fastapi import APIRouter, Depends, HTTPException, Request, Query
from typing import Optional
from google.cloud import firestore

from app.core.firebase import db
from app.core.security import get_current_user, get_admin_user
from app.models.support import TicketStatus, TicketCreate, AdminTicketReply, WarnUserRequest

router = APIRouter()

# ==========================================
# 🙋‍♂️ USER ROUTES (General Support & Ban Appeals)
# ==========================================

@router.post("/create", tags=["Support & Admin"])
async def create_support_ticket(
    ticket: TicketCreate, 
    user: dict = Depends(get_current_user)
):
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        status = user.get("status", "active")
        
        is_banned = (role == "banned" or status == "banned")

        # 🚨 1. TICKET-FIRST QUERY
        # We query the TICKETS collection. If you deleted it in the admin panel, 
        # this safely returns empty and generates a new one.
        existing_tickets = db.collection("tickets")\
            .where("owner_id", "==", uid)\
            .where("reference_type", "==", "general")\
            .limit(1).stream()
            
        existing_room_id = None
        existing_ticket_id = None
        
        for t in existing_tickets:
            t_data = t.to_dict()
            
            # Banned user restriction
            if is_banned and t_data.get("status") in ["open", "action_required"]:
                raise HTTPException(status_code=403, detail="You already have an open appeal. Please reply in your existing active ticket.")
                
            existing_room_id = t_data.get("chat_room_id")
            existing_ticket_id = t.id
            break

        # 🚨 2. VALIDATE CHAT ROOM INTEGRITY
        # If the ticket exists but the chat room was manually deleted, discard it and start fresh.
        if existing_room_id:
            room_doc = db.collection("chat_rooms").document(existing_room_id).get()
            if not room_doc.exists:
                existing_room_id = None
                existing_ticket_id = None

        # 3. ESCALATE & APPEND (Only runs if BOTH the ticket and room perfectly exist)
        if existing_room_id and existing_ticket_id:
            room_ref = db.collection("chat_rooms").document(existing_room_id)
            user_name = user.get("name", user.get("email", "User").split("@")[0])

            msg_text = f"🚨 NEW TICKET ADDED:\n\nSubject: {ticket.subject}\n\n{ticket.description}"

            room_ref.collection("messages").add({
                "sender_id": uid,
                "sender_name": user_name,
                "text": msg_text,
                "is_bid": False,
                "created_at": firestore.SERVER_TIMESTAMP
            })

            room_ref.update({
                "status": "open",
                "subject": ticket.subject,
                "last_message": ticket.description,
                "updated_at": firestore.SERVER_TIMESTAMP
            })

            ticket_ref = db.collection("tickets").document(existing_ticket_id)
            ticket_ref.update({
                "status": TicketStatus.OPEN.value,
                "subject": ticket.subject,
                "updated_at": firestore.SERVER_TIMESTAMP
            })
                
            return {"message": "Ticket appended.", "ticket_id": existing_ticket_id, "chat_room_id": existing_room_id}

        # ==========================================
        # 4. CREATE BRAND NEW TICKET 
        # (Executes instantly if the old ticket or room was deleted)
        # ==========================================
        chat_ref = db.collection("chat_rooms").document()
        chat_room_id = chat_ref.id
        
        chat_ref.set({
            "id": chat_room_id,
            "listing_id": "system_support",
            "reference_type": "general",
            "buyer_id": uid,
            "seller_id": "ADMIN_TEAM",
            "subject": ticket.subject,
            "last_message": ticket.description,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "is_ticket": True,
            "status": "open" 
        })
        
        chat_ref.collection("messages").add({
            "sender_id": uid,
            "text": ticket.description,
            "is_bid": False,
            "created_at": firestore.SERVER_TIMESTAMP 
        })

        ticket_ref = db.collection("tickets").document()
        ticket_ref.set({
            "id": ticket_ref.id,
            "owner_id": uid,
            "user_email": user.get("email"), 
            "subject": ticket.subject,
            "description": ticket.description, 
            "reference_id": "system_support",
            "reference_type": "general", # 🚨 Ensures Admin Panel handles it properly
            "status": TicketStatus.OPEN.value,
            "chat_room_id": chat_room_id,
            "created_at": firestore.SERVER_TIMESTAMP
        })

        return {"message": "Support ticket created successfully!", "ticket_id": ticket_ref.id, "chat_room_id": chat_room_id}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 🚨 THE FIX: Fully paginated User Tickets Route
@router.get("/my-tickets", tags=["Support & Admin"])
async def get_my_tickets(
    limit: int = Query(15, le=50),
    cursor: Optional[str] = Query(None),
    user: dict = Depends(get_current_user)
): 
    try:
        uid = user.get("uid")
        query = db.collection("tickets")\
            .where("owner_id", "==", uid)\
            .order_by("created_at", direction=firestore.Query.DESCENDING)
        
        if cursor:
            cursor_doc = db.collection("tickets").document(cursor).get()
            if cursor_doc.exists:
                query = query.start_after(cursor_doc)
                
        tickets_stream = query.limit(limit).stream()
        results = []
        last_doc_id = None
        
        for doc in tickets_stream:
            data = doc.to_dict()
            if "created_at" in data and data["created_at"]:
                data["created_at"] = data["created_at"].isoformat() if hasattr(data["created_at"], 'isoformat') else str(data["created_at"])
            results.append({"id": doc.id, **data})
            last_doc_id = doc.id
            
        return {
            "data": results,
            "next_cursor": last_doc_id if len(results) == limit else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 👑 ADMIN ROUTES (Strictly God Mode)
# ==========================================

# 🚨 THE FIX: Fully paginated Admin Tickets Route
@router.get("/admin/all", tags=["Support & Admin"])
async def get_all_campus_tickets(
    limit: int = Query(35, le=100),
    cursor: Optional[str] = Query(None),
    admin: dict = Depends(get_admin_user)
):
    try:
        query = db.collection("tickets")\
            .where("status", "==", TicketStatus.OPEN.value)\
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            
        if cursor:
            cursor_doc = db.collection("tickets").document(cursor).get()
            if cursor_doc.exists:
                query = query.start_after(cursor_doc)

        tickets_stream = query.limit(limit).stream()
        results = []
        last_doc_id = None
        
        for doc in tickets_stream:
            data = doc.to_dict()
            if "created_at" in data and data["created_at"]:
                data["created_at"] = data["created_at"].isoformat() if hasattr(data["created_at"], 'isoformat') else str(data["created_at"])
            results.append({"id": doc.id, **data})
            last_doc_id = doc.id
            
        return {
            "data": results,
            "next_cursor": last_doc_id if len(results) == limit else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/{ticket_id}/reply", tags=["Support & Admin"])
async def admin_reply_to_ticket(
    ticket_id: str, 
    reply: AdminTicketReply, 
    request: Request,
    admin: dict = Depends(get_admin_user)
):
    try:
        admin_id = admin.get("uid")
        ticket_ref = db.collection("tickets").document(ticket_id)
        ticket_doc = ticket_ref.get()
        
        if not ticket_doc.exists:
            raise HTTPException(status_code=404, detail="Ticket not found.")
            
        ticket_data = ticket_doc.to_dict()
        chat_room_id = ticket_data.get("chat_room_id")
        owner_id = ticket_data.get("owner_id")
        
        ticket_ref.update({
            "status": reply.status,
            "admin_response": reply.admin_response,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        chat_ref = db.collection("chat_rooms").document(chat_room_id)
        chat_ref.collection("messages").add({
            "sender_id": admin_id,
            "text": f"👨‍💻 Admin Support: {reply.admin_response}",
            "is_bid": False,
            "created_at": firestore.SERVER_TIMESTAMP
        })
        
        chat_ref.update({
            "last_message": reply.admin_response, 
            "status": reply.status,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
        if owner_id:
            await request.app.state.redis.enqueue_job(
                'process_push_notification',
                owner_id,
                "👨‍💻 Admin Support Reply",
                reply.admin_response,
                f"/chat/{chat_room_id}"
            )
        
        return {"message": "Reply sent successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/admin/{ticket_id}/resolve", tags=["Support & Admin"])
async def resolve_ticket(
    ticket_id: str, 
    request: Request, 
    admin: dict = Depends(get_admin_user)
):
    try:
        target_uid = None
        chat_room_id = ticket_id

        room_ref = db.collection("chat_rooms").document(ticket_id)
        room_doc = room_ref.get()
        
        if room_doc.exists:
            target_uid = room_doc.to_dict().get("buyer_id")
            room_ref.update({
                "status": TicketStatus.RESOLVED.value,
                "updated_at": firestore.SERVER_TIMESTAMP
            })
            tickets = db.collection("tickets").where("chat_room_id", "==", ticket_id).stream()
            for t in tickets:
                t.reference.update({"status": TicketStatus.RESOLVED.value})
                
        else:
            ticket_ref = db.collection("tickets").document(ticket_id)
            ticket_doc = ticket_ref.get()
            if ticket_doc.exists:
                ticket_data = ticket_doc.to_dict()
                target_uid = ticket_data.get("owner_id")
                chat_room_id = ticket_data.get("chat_room_id")
                ticket_ref.update({"status": TicketStatus.RESOLVED.value})
                
                if chat_room_id:
                    db.collection("chat_rooms").document(chat_room_id).update({
                        "status": TicketStatus.RESOLVED.value,
                        "updated_at": firestore.SERVER_TIMESTAMP
                    })

        if target_uid and chat_room_id:
            await request.app.state.redis.enqueue_job(
                'process_push_notification',
                target_uid,
                "✅ Ticket Resolved",
                "An admin has resolved and closed your support ticket.",
                f"/chat/{chat_room_id}"
            )

        return {"message": "Ticket resolved and closed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@router.post("/admin/warn/{target_uid}", tags=["Support & Admin"])
async def warn_user(
    target_uid: str, 
    req: WarnUserRequest, 
    request: Request, 
    admin: dict = Depends(get_admin_user)
):
    try:
        chat_ref = db.collection("chat_rooms").document()
        chat_room_id = chat_ref.id
        
        chat_ref.set({
            "id": chat_room_id,
            "listing_id": "system_warning",
            "reference_type": "general", 
            "buyer_id": target_uid, 
            "seller_id": "ADMIN_TEAM", 
            "subject": f"⚠️ WARNING: {req.subject}",
            "last_message": req.message,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "is_ticket": True,
            "status": TicketStatus.OPEN.value
        })
        
        chat_ref.collection("messages").add({
            "sender_id": admin.get("uid"),
            "text": req.message,
            "is_bid": False,
            "created_at": firestore.SERVER_TIMESTAMP 
        })

        await request.app.state.redis.enqueue_job(
            'process_push_notification',
            target_uid,
            f"⚠️ Official Action: {req.subject}",
            req.message,
            f"/chat/{chat_room_id}"
        )

        return {"message": "Warning sent to user.", "chat_room_id": chat_room_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))