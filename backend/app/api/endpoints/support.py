from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore

from app.core.firebase import db
from app.core.security import get_current_user, get_admin_user, get_active_user
from app.models.support import TicketStatus, TicketCreate, AdminTicketReply ,WarnUserRequest

router = APIRouter()

# ==========================================
# 🙋‍♂️ USER ROUTES (Anyone logged in)
# ==========================================

@router.post("/create", tags=["Support & Admin"])
async def create_support_ticket(
    ticket: TicketCreate, 
    user: dict = Depends(get_current_user) # 🟢 Changed to base user to allow the custom bouncer
):
    try:
        uid = user.get("uid")
        role = user.get("role", "guest")
        status = user.get("status", "active")
        
        # 🚨 THE "SINGLE APPEAL TICKET" BOUNCER
        is_banned = (role == "banned" or status == "banned")
        if is_banned:
            # Check if they already have an open ticket in the chat_rooms collection
            existing_tickets = db.collection("chat_rooms")\
                .where("buyer_id", "==", uid)\
                .where("seller_id", "==", "ADMIN_TEAM")\
                .where("status", "==", "open")\
                .limit(1).get()
                
            if existing_tickets:
                raise HTTPException(
                    status_code=403, 
                    detail="You already have an open appeal. Please reply in your existing active ticket in your inbox."
                )

        # 1. Create the Chat Room First
        chat_ref = db.collection("chat_rooms").document()
        chat_room_id = chat_ref.id
        
        chat_ref.set({
            "id": chat_room_id,
            "listing_id": ticket.reference_id or "system_support",
            "buyer_id": uid,
            "seller_id": "ADMIN_TEAM",
            "subject": ticket.subject,
            "last_message": ticket.description,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "is_ticket": True,
            "status": "open" # 🚨 Ensure status is explicitly tracked here!
        })
        
        # Add the user's description as the first message
        chat_ref.collection("messages").add({
            "sender_id": uid,
            "text": ticket.description,
            "is_bid": False,
            "created_at": firestore.SERVER_TIMESTAMP 
        })

        # 2. Create the Official Ticket Record
        ticket_ref = db.collection("tickets").document()
        ticket_ref.set({
            "id": ticket_ref.id,
            "owner_id": uid,
            "user_email": user.get("email"), 
            "subject": ticket.subject,
            "description": ticket.description, 
            "reference_id": ticket.reference_id,
            "reference_type": ticket.reference_type,
            "status": TicketStatus.OPEN.value,
            "chat_room_id": chat_room_id,
            "created_at": firestore.SERVER_TIMESTAMP
        })

        return {"message": "Support ticket created successfully!", "ticket_id": ticket_ref.id, "chat_room_id": chat_room_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/my-tickets", tags=["Support & Admin"])
async def get_my_tickets(user: dict = Depends(get_current_user)): 
    # 🟢 READ ACTION: Keep get_current_user so Banned users can read their ban appeal ticket
    try:
        uid = user.get("uid")
        tickets_query = db.collection("tickets").where("owner_id", "==", uid).stream()
        
        results = []
        for doc in tickets_query:
            data = doc.to_dict()
            if "created_at" in data and data["created_at"]:
                data["created_at"] = data["created_at"].isoformat() if hasattr(data["created_at"], 'isoformat') else str(data["created_at"])
            results.append({"id": doc.id, **data})
            
        results.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
        return {"data": results}
    except Exception as e:
        print("Error fetching tickets:", e)
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 👑 ADMIN ROUTES (Strictly God Mode)
# ==========================================

@router.get("/admin/all", tags=["Support & Admin"])
async def get_all_campus_tickets(admin: dict = Depends(get_admin_user)):
    try:
        tickets_query = db.collection("tickets").where("status", "==", TicketStatus.OPEN.value).stream()
        results = []
        for doc in tickets_query:
            data = doc.to_dict()
            if "created_at" in data and data["created_at"]:
                data["created_at"] = data["created_at"].isoformat() if hasattr(data["created_at"], 'isoformat') else str(data["created_at"])
            results.append({"id": doc.id, **data})
            
        results.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
        return {"data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/{ticket_id}/reply", tags=["Support & Admin"])
async def admin_reply_to_ticket(ticket_id: str, reply: AdminTicketReply, admin: dict = Depends(get_admin_user)):
    try:
        admin_id = admin.get("uid")
        ticket_ref = db.collection("tickets").document(ticket_id)
        ticket_doc = ticket_ref.get()
        
        if not ticket_doc.exists:
            raise HTTPException(status_code=404, detail="Ticket not found.")
            
        ticket_data = ticket_doc.to_dict()
        chat_room_id = ticket_data.get("chat_room_id")
        
        # Update the actual Ticket document so the /support page can see it
        ticket_ref.update({
            "status": reply.status,
            "admin_response": reply.admin_response
        })
        
        # Inject the message into the chat room
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
        
        return {"message": "Reply sent successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/admin/{ticket_id}/resolve", tags=["Support & Admin"])
async def resolve_ticket(ticket_id: str, admin: dict = Depends(get_admin_user)):
    try:
        # Check chat_rooms first
        room_ref = db.collection("chat_rooms").document(ticket_id)
        
        if room_ref.get().exists:
            room_ref.update({
                "status": TicketStatus.RESOLVED.value,
                "updated_at": firestore.SERVER_TIMESTAMP
            })
            tickets = db.collection("tickets").where("chat_room_id", "==", ticket_id).stream()
            for t in tickets:
                t.reference.update({"status": TicketStatus.RESOLVED.value})
                
        else:
            # Fallback if the ID was the ticket ID instead
            ticket_ref = db.collection("tickets").document(ticket_id)
            if ticket_ref.get().exists:
                ticket_ref.update({"status": TicketStatus.RESOLVED.value})
                chat_id = ticket_ref.get().to_dict().get("chat_room_id")
                if chat_id:
                    db.collection("chat_rooms").document(chat_id).update({"status": TicketStatus.RESOLVED.value})

        return {"message": "Ticket resolved and closed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    

@router.post("/admin/warn/{target_uid}", tags=["Support & Admin"])
async def warn_user(target_uid: str, req: WarnUserRequest, admin: dict = Depends(get_admin_user)):
    """Admin initiates a Warning ticket directly into a user's inbox."""
    try:
        # 1. Create the Chat Room
        chat_ref = db.collection("chat_rooms").document()
        chat_room_id = chat_ref.id
        
        chat_ref.set({
            "id": chat_room_id,
            "listing_id": "system_warning",
            "buyer_id": target_uid, # The User receiving the warning
            "seller_id": "ADMIN_TEAM", # Admin is the sender
            "subject": f"⚠️ WARNING: {req.subject}",
            "last_message": req.message,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "is_ticket": True,
            "status": TicketStatus.OPEN.value
        })
        
        # 2. Add Admin's Warning Message
        chat_ref.collection("messages").add({
            "sender_id": admin.get("uid"),
            "text": req.message,
            "is_bid": False,
            "created_at": firestore.SERVER_TIMESTAMP 
        })

        return {"message": "Warning sent to user.", "chat_room_id": chat_room_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))