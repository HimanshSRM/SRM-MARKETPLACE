from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum

# --- LEGACY SCHEMAS (Keep these if used elsewhere in your app) ---
class TicketStatus(str, Enum):
    OPEN = "open"
    RESOLVED = "resolved"
    TAKEDOWN = "closed_takedown"

class SeverityLevel(str, Enum):
    LOW = "low"      # User gets a warning, item stays live for 24 hours
    HIGH = "high"    # Item is immediately hidden from the public feed

class AdminWarningCreate(BaseModel):
    reference_id: str = Field(..., description="The ID of the product, service, or shop.")
    reference_type: str = Field(..., description="e.g., 'product', 'service', 'shop'")
    reason: str = Field(..., min_length=10, max_length=500, description="Detailed explanation for the owner.")
    severity: SeverityLevel

class UserModerationPayload(BaseModel):
    action: str = Field(..., description="Must be: warn, ban, restore, or nuke")
    reason: str = Field(..., min_length=10, max_length=500, description="The message sent to the user.")
    room_id: str = Field(..., description="The ID of the active chat room to inject the message into.")

# ==========================================
# 🚨 ACTIVE SCHEMAS FOR ADMIN.PY ROUTER
# ==========================================

class RoleUpdate(BaseModel):
    role: str = Field(..., description="The new role to assign to the user")

class RejectRequest(BaseModel):
    reason: str = Field(..., description="Reason for rejecting the shop")

class ReportCreate(BaseModel):
    reason: str = Field(..., description="Primary reason for reporting")
    details: Optional[str] = Field("", description="Extra context from the student")

class ModerateAction(BaseModel):
    action: str = Field(..., description="Must be 'warn', 'hide', or 'delete'")
    reason: str = Field(..., description="Explanation sent to the seller")
    shop_id: Optional[str] = Field(None, description="If this is a shop item, pass the shop ID")

class GenericWarning(BaseModel):
    subject: str = Field(..., description="Subject of the warning ticket")
    message: str = Field(..., description="Body of the warning message")