from pydantic import BaseModel
from typing import Optional
from enum import Enum

class UserRole(str, Enum):
    GUEST = "guest"
    STUDENT = "student"
    SHOP_PENDING = "shop_pending"
    SHOP_VERIFIED = "shop_verified"
    ADMIN = "admin"

class UserProfile(BaseModel):
    uid: str
    email: str
    name: Optional[str] = None
    role: UserRole = UserRole.GUEST
    is_verified: bool = False
    phone_number: Optional[str] = None
    reputation_score: float = 5.0  # Everyone starts with a 5-star rating