from pydantic import BaseModel, Field ,EmailStr
from typing import Optional

# 1. When a business signs up
class ShopCreate(BaseModel):
    shop_name: str = Field(..., min_length=3, max_length=100)
    description: str = Field(..., max_length=500)
    location: str = Field(..., example="Tech Park, Potheri, Estancia")
    contact_number: str
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
    phone_number: Optional[str] = None
    location: Optional[str] = None # e.g., "Tech Park", "Main Campus"

    
        
