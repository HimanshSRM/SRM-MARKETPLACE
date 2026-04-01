from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from app.core.firebase import db
import sentry_sdk
from app.core.config import settings

# 🛡️ Import ALL your powerful Bouncers
from app.core.security import (
    get_current_user, 
    get_verified_student, 
    get_verified_shop, 
    get_admin_user
) 

# Import all of your beautiful routers
from app.api.endpoints import products, upload, shops, chat, users, services, admin , support



# --- SENTRY INITIALIZATION ---
if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        traces_sample_rate=1.0,
    )
    print(f"✅ Sentry is ACTIVE with DSN: {settings.SENTRY_DSN[:15]}...")
else:
    print("❌ Sentry DSN is missing or None!")    

app = FastAPI(title="SRM Campus Economy API", version="1.0.0")

origins = [
    settings.FRONTEND_URL.rstrip("/"),      # Trusted URL from .env
    "https://srm-marketplace-webapp.vercel.app",
    # Alternative Localhost
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- ROUTER REGISTRATION ---
app.include_router(products.router, prefix="/api/products", tags=["Products"])
app.include_router(upload.router, prefix="/api/upload", tags=["Storage"])
app.include_router(shops.router, prefix="/api/shops", tags=["Shops"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat & Bidding"])
app.include_router(users.router, prefix="/api/users", tags=["User Management"])
app.include_router(services.router, prefix="/api/services", tags=["Services"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin Dashboard"]) 
app.include_router(support.router, prefix="/api/support", tags=["Support & Admin"])


# --- SYSTEM ROUTES ---
@app.get("/", tags=["System"])
async def root():
    return {"message": "API is Live!"}

@app.get("/test-db", tags=["System"])
async def test_database():
    try:
        doc_ref = db.collection("system").document("health_check")
        doc_ref.set({"status": "online"})
        return {"status": "success", "message": "Successfully wrote to Firestore!"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# --- 📊 ROLE-SPECIFIC DASHBOARDS ---

@app.get("/api/dashboard/student", tags=["Dashboards"])
async def get_student_dashboard(student: dict = Depends(get_verified_student)):
    """Locked to @srmist.edu.in users only."""
    return {
        "role": "student",
        "message": f"Welcome to the SRM Student Marketplace, {student.get('email')}!",
        "uid": student.get("uid")
    }

@app.get("/api/dashboard/shop", tags=["Dashboards"])
async def get_shop_dashboard(shop_owner: dict = Depends(get_verified_shop)):
    """Locked to officially verified business owners only."""
    return {
        "role": "shop",
        "message": "Welcome to your Business Seller Center!",
        "uid": shop_owner.get("uid")
    }

@app.get("/api/dashboard/admin", tags=["Dashboards"])
async def get_admin_dashboard(admin_user: dict = Depends(get_admin_user)):
    """Locked to Super Admins only."""
    return {
        "role": "admin",
        "message": "Welcome to the God Mode Control Panel.",
        "uid": admin_user.get("uid")
    }

@app.get("/api/dashboard/guest", tags=["Dashboards"])
async def get_guest_dashboard(user: dict = Depends(get_current_user)):
    """Base dashboard for unverified Gmail users who haven't been approved yet."""
    return {
        "role": "guest",
        "message": "Welcome! Please apply for a shop or use a student email for full access.",
        "uid": user.get("uid")
    }