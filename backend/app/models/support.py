from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# --- PYDANTIC MODELS & ENUMS ---
class TicketStatus(str, Enum):
    OPEN = "open"
    RESOLVED = "resolved"
    TAKEDOWN = "closed_takedown"

class TicketCreate(BaseModel):
    subject: str = Field(..., max_length=100)
    description: str = Field(..., max_length=1000)
    reference_id: Optional[str] = None 
    reference_type: Optional[str] = None 

# 🚨 FIXED: Matched exactly to what Next.js sends in api.ts
class AdminTicketReply(BaseModel):
    status: str
    admin_response: str    


class WarnUserRequest(BaseModel):
    subject: str
    message: str