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

# 🚨 THIS IS THE BACKGROUND JOB
async def process_push_notification(ctx, user_id: str, title: str, body: str, url: str = "/inbox"):
    """Pulls tokens from Firestore and sends the push via Google FCM."""
    try:
        user_ref = db.collection("users").document(user_id)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return False
            
        user_data = user_doc.to_dict()
        tokens = user_data.get("fcmTokens", [])
        
        if not tokens:
            return False

        failed_tokens = []

        for token in tokens:
            try:
                message = messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    data={"url": url},
                    token=token,
                )
                messaging.send(message)
            except Exception as e:
                failed_tokens.append(token)
        
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