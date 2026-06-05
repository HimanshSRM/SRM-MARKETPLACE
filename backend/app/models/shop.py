from pydantic import BaseModel, Field ,EmailStr
from typing import Optional , List , Dict , Any

# 1. When a business signs up
class ShopCreate(BaseModel):
    shop_name: str = Field(..., min_length=3, max_length=100)
    description: str = Field(..., max_length=500)
    location: str = Field(..., example="Tech Park, Potheri, Estancia")
    contact_number: str
    phone_number: Optional[str] = None
    contact_email: EmailStr

# 2. When a business adds a permanent item to their menu/catalog
class CatalogItemCreate(BaseModel):
    name: str = Field(..., min_length=2)
    price: float = Field(..., ge=0.0)
    image_url: Optional[str] = None
    is_available: bool = True

class CatalogItemUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_available: Optional[bool] = None 


class ShopProfileUpdate(BaseModel):
    shop_name: Optional[str] = None
    description: Optional[str] = None
    contact_number: Optional[str] = None
    phone_number: Optional[str] = None
    location: Optional[str] = None # e.g., "Tech Park", "Main Campus"


# --- NEW SCHEMAS FOR ADVANCED FEATURES ---
class ShopStatusUpdate(BaseModel):
    is_open: bool

class ShopNoticeUpdate(BaseModel):
    text: str
    is_active: bool

class QuickReplyUpdate(BaseModel):
    quick_replies: List[Dict[str, str]] # e.g., [{"id": "1", "trigger": "Location?", "response": "H-Block"}]

class FlashDealCreate(BaseModel):
    item_name: str
    original_price: float
    deal_price: float
    duration_hours: int


    
        
