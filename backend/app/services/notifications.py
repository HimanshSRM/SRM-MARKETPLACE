import firebase_admin
from firebase_admin import credentials, messaging, firestore

# Initialize Firebase Admin (Only run this once when your app starts!)
if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)

db = firestore.client()

def send_push_notification(user_id: str, title: str, body: str, url: str = "/inbox"):
    """
    Looks up a user's device tokens and sends them a push notification individually.
    """
    try:
        # 1. Fetch the user's profile from Firestore to get their tokens
        user_ref = db.collection("users").document(user_id)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            print(f"User {user_id} not found.")
            return False
            
        user_data = user_doc.to_dict()
        tokens = user_data.get("fcmTokens", [])
        
        if not tokens:
            print(f"User {user_id} has no registered devices for notifications.")
            return False

        failed_tokens = []

        # 2. 🚨 THE FIX: Send to each token individually to avoid the Google Batch 404 bug
        for token in tokens:
            try:
                message = messaging.Message(
                    notification=messaging.Notification(
                        title=title,
                        body=body,
                    ),
                    data={
                        "url": url 
                    },
                    token=token,
                )
                
                # Fire the message!
                response = messaging.send(message)
                print(f"Successfully sent message to token: {response}")
                
            except Exception as e:
                # If a specific token fails (e.g., user uninstalled browser), flag it for removal
                print(f"Failed to send to token. Error: {e}")
                failed_tokens.append(token)
        
        # 3. Cleanup: Remove invalid tokens from the database
        if failed_tokens:
            user_ref.update({
                "fcmTokens": firestore.ArrayRemove(failed_tokens)
            })
                
        return True

    except Exception as e:
        print(f"Error executing push notification logic: {e}")
        return False