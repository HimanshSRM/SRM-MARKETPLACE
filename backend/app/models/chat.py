from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

# --- 1. THE MESSAGE SCHEMAS ---
class BidStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"

class MessageCreate(BaseModel):
    text: str = Field(..., max_length=500)
    is_bid: bool = False
    bid_amount: Optional[float] = None

class MessageRead(BaseModel):
    id: str
    sender_id: str
    text: str
    is_bid: bool
    bid_amount: Optional[float]
    bid_status: Optional[BidStatus]
    created_at: datetime 


class TicketCreate(BaseModel):
    subject: str
    message: str        

# --- 2. THE CHAT INITIATION SCHEMA ---
class ChatInitiate(BaseModel):
    listing_id: str
    owner_id: str
    initial_message: str = Field(..., max_length=500)
    bid_amount: Optional[float] = None

# --- 3. THE CATEGORIZED INBOX SCHEMA ---
class InboxRoom(BaseModel):
    room_id: str
    listing_id: str
    # listing_title: str  # Note: You'll need to join this from the listings collection
    last_message: str
    updated_at: datetime
    status: str = "active" # "active" or "sold"

class InboxResponse(BaseModel):
    buying: List[InboxRoom]
    selling: List[InboxRoom]
    support: List[InboxRoom]


class BulkDeletePayload(BaseModel):
    message_ids: List[str]    


