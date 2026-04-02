import requests
import json

# ==========================================
# 1. YOUR CONFIGURATION (Fill this in!)
# ==========================================
FIREBASE_WEB_API_KEY = ""
API_BASE_URL = "http://127.0.0.1:8000"

# A fake SRM student we will create to test the system
TEST_EMAIL = "tester@srmist.edu.in"
TEST_PASSWORD = "StrongPassword123!"

# ==========================================
# 2. FIREBASE AUTH LOGIC (Updated for Security)
# ==========================================
def get_firebase_token():
    print("🔄 Authenticating with Firebase...")
    payload = {
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "returnSecureToken": True
    }
    
    # 1. Try to Sign Up the user FIRST
    signup_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={FIREBASE_WEB_API_KEY}"
    req = requests.post(signup_url, json=payload)
    data = req.json()
    
    if "idToken" in data:
        print("✅ Account created and token received!")
        return data["idToken"]
        
    # 2. If it fails because they already exist, Log them in!
    elif data.get("error", {}).get("message") == "EMAIL_EXISTS":
        print("⚠️ User already exists. Logging in instead...")
        login_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_WEB_API_KEY}"
        log_req = requests.post(login_url, json=payload)
        log_data = log_req.json()
        
        if "idToken" in log_data:
            print("✅ Successfully logged in and got ID Token!")
            return log_data["idToken"]
        else:
            print(f"❌ Login Error: {log_data}")
            return None
    else:
        print(f"❌ Auth Error: {data}")
        return None

# ==========================================
# 3. FASTAPI ENDPOINT TESTING
# ==========================================
def run_tests():
    token = get_firebase_token()
    if not token:
        print("Stopping tests due to auth failure.")
        return

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # --- TEST 1: Sync User Profile ---
    print("\n[Test 1] Syncing User Profile to Database...")
    res = requests.post(f"{API_BASE_URL}/api/users/sync", headers=headers)
    print(res.json())

    # --- TEST 2: Post a Product Ad ---
    print("\n[Test 2] Posting a Bicycle Ad...")
    ad_payload = {
        "title": "Hero Sprint Bicycle 21 Gear",
        "description": "Used for 6 months. Selling because moving to a hostel closer to campus.",
        "price": 3500.0,
        "type": "product",
        "category": "sports",
        "images": [] # Leaving empty as we made it optional!
    }
    res = requests.post(f"{API_BASE_URL}/api/products/create", headers=headers, json=ad_payload)
    print(res.json())

    # --- TEST 3: Fetch the Live Feed ---
    print("\n[Test 3] Fetching the Live Market Feed...")
    res = requests.get(f"{API_BASE_URL}/api/products/live", headers=headers)
    
    # Pretty print the feed response so it's easy to read
    print(json.dumps(res.json(), indent=2))

if __name__ == "__main__":
    run_tests()