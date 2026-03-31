import requests

FIREBASE_WEB_API_KEY = "AIzaSyDdIBo7XwWhRVnjkUTqHWjxJXNe6a_mPcs"

# Change this email whenever you want to test a different person!
TEST_EMAIL = "2342himansh11a2@gmail.com"  
TEST_PASSWORD = "StrongPassword123!"

print(f"Fetching token for {TEST_EMAIL}...")

payload = {
    "email": TEST_EMAIL,
    "password": TEST_PASSWORD,
    "returnSecureToken": True
}

# 1. Try to Sign Up FIRST
signup_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={FIREBASE_WEB_API_KEY}"
req = requests.post(signup_url, json=payload)
data = req.json()

if "idToken" in data:
    print("\n✅ BRAND NEW USER CREATED! COPY THIS TOKEN:\n")
    print(data["idToken"])
    print("\n")
elif data.get("error", {}).get("message") == "EMAIL_EXISTS":
    # 2. If they already exist, Log them in!
    print("⚠️ User exists. Logging in...")
    login_url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_WEB_API_KEY}"
    log_req = requests.post(login_url, json=payload)
    log_data = log_req.json()
    
    if "idToken" in log_data:
        print("\n✅ LOGGED IN SUCCESSFULLY! COPY THIS TOKEN:\n")
        print(log_data["idToken"])
        print("\n")
    else:
        print("❌ Login Error:", log_data)
else:
    print("❌ Auth Error:", data)
