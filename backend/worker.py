import os
import asyncio
from arq.connections import RedisSettings
import firebase_admin
from firebase_admin import credentials, messaging, firestore

# Initialize Firebase for the worker
if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)

db = firestore.client()

# 🚨 HIGHLY OPTIMIZED BACKGROUND JOB
async def process_push_notification(ctx, user_id: str, title: str, body: str, url: str = "/inbox"):
    """Pulls tokens from Firestore and sends the push to ALL devices via Google FCM Multicast."""
    try:
        user_ref = db.collection("users").document(user_id)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return False
            
        user_data = user_doc.to_dict()
        tokens = user_data.get("fcmTokens", [])
        
        if not tokens:
            return False

        # 🚨 THE FIX: One API call for all devices simultaneously (Multicast)
        message = messaging.MulticastMessage(
            notification=messaging.Notification(title=title, body=body),
            data={"url": str(url)}, # Must be forced to a string for the FCM data payload
            tokens=tokens,
        )
        
        # Fire the single batch request to Google FCM
        response = messaging.send_each_for_multicast(message)
        
        # Cleanup invalid tokens (e.g. if the user uninstalled the app on an old device)
        if response.failure_count > 0:
            failed_tokens = []
            for idx, resp in enumerate(response.responses):
                if not resp.success:
                    failed_tokens.append(tokens[idx])
            
            if failed_tokens:
                user_ref.update({"fcmTokens": firestore.ArrayRemove(failed_tokens)})
                
        return True

    except Exception as e:
        print(f"Worker Error: {e}")
        return False

# 🚨 Connect the worker to your Redis container
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")

class WorkerSettings:
    functions = [process_push_notification]
    redis_settings = RedisSettings.from_dsn(redis_url)