import logging
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore, auth
from app.core.config import settings, BASE_DIR

# 1. Set up the professional logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

def initialize_firebase():
    if not firebase_admin._apps:
        cred_path_absolute = BASE_DIR / settings.FIREBASE_CREDENTIALS_PATH
        
        if not cred_path_absolute.exists():
            # We keep this as an error because we WANT the app to crash if the key is missing
            raise ValueError(
                f"CRITICAL ERROR: Firebase key not found at '{cred_path_absolute}'. "
            )
            
        cred = credentials.Certificate(str(cred_path_absolute))
        
        firebase_admin.initialize_app(cred, {
            'storageBucket': settings.FIREBASE_STORAGE_BUCKET
        })
        
        # 2. Use logger instead of print!
        logger.info("🔥 Firebase Admin SDK initialized dynamically and securely.")
        
    return firebase_admin.get_app()

initialize_firebase()

db = firestore.client()
firebase_auth = auth