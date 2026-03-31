from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from enum import Enum

# 1. Enforce strict choices (No typos allowed)
class ListingType(str, Enum):
    PRODUCT = "product"
    SERVICE = "service"

class ListingStatus(str, Enum):
    ACTIVE = "active"
    SOLD = "sold"
    HIDDEN = "hidden"

# 2. The Base Model (What the frontend MUST send when making a post)
class ListingCreate(BaseModel):
    title: str = Field(..., min_length=5, max_length=100, description="Title of the ad")
    description: str = Field(..., min_length=10, max_length=1000)
    price: float = Field(..., ge=0.0, description="Price must be 0 or greater")
    type: ListingType
    category: str = Field(..., example="electronics, books, tutoring, UI/UX")
    images: Optional[List[str]] = Field(default=[], max_length=5, description="Max 5 image URLs allowed")

# 3. The Database Model (What it looks like once we add our backend data)
class ListingResponse(ListingCreate):
    id: str
    owner_id: str  # The Firebase UID of the student who posted it
    status: ListingStatus = ListingStatus.ACTIVE
    created_at: datetime