    # 🏛️ SRM Campus Economy API

    A multi-tenant, role-based backend architecture designed exclusively for the SRM University ecosystem. This API powers a dual-sided marketplace supporting both **P2P (Peer-to-Peer)** student trading and **B2C (Business-to-Consumer)** campus shop sales.

    ---

    ## 🚀 Tech Stack

    * **Framework:** FastAPI (Python 3.10+)
    * **Database:** Google Firebase (Firestore NoSQL)
    * **Authentication:** Firebase Auth
    * **Validation & Settings:** Pydantic & Pydantic-Settings
    * **Error Monitoring:** Sentry SDK
    * **Server:** Uvicorn

    ---

    ## 🧠 Core Architecture & Features

    ### 1. Asymmetric Market Permissions
    The database operates two distinct, isolated economies that share a unified viewing feed:
    * **Student Zone (P2P):** Only verified students can post used items, gig work, or freelance services.
    * **Business Zone (B2C):** Only officially verified shops can manage and post to their business catalogs.
    * **The Shared Economy:** Both students and shops can view, browse, and bid on each other's public feeds, creating a fully interactive campus economy.

    ### 2. The "5-Door" RBAC Security System
    Every endpoint is protected by a strict Role-Based Access Control (RBAC) dependency injected via FastAPI:
    1. **`get_current_user` (Guest):** Base entry. Allows unverified Gmail users to log in, sync their profile, and apply for a shop.
    2. **`get_srm_student` (Student):** Strictly enforces an `@srmist.edu.in` email domain. Grants access to P2P creation routes.
    3. **`get_verified_shop` (Shop):** Queries Firestore to verify the user has an approved `"shop"` role. Grants access to B2C catalog management.
    4. **`get_marketplace_user` (Shared):** A shared gateway allowing both Students and Verified Shops to view public feeds and place bids.
    5. **`get_admin_user` (God Mode):** Strictly for Super Admins to approve shops and moderate listings.

    ### 3. Production-Ready Infrastructure
    * **Dynamic Pathing:** Utilizes `pathlib` for bulletproof file routing, ensuring the API never crashes due to cross-OS directory path issues.
    * **Environment Vault:** Protected by `pydantic-settings`. The server will instantly crash on boot with a helpful error if any `.env` variables are missing, preventing silent failures in production.
    * **Automated Crash Reporting:** Integrated with Sentry. Unhandled exceptions are automatically packaged with their tracebacks and emailed to the developer team.

    ---

    ## 📂 Project Structure

    ```text
    backend/
    ├── app/
    │   ├── api/
    │   │   └── endpoints/       # Route handlers (products, services, shops, etc.)
    │   ├── core/
    │   │   ├── config.py        # Pydantic environment validation
    │   │   ├── firebase.py      # Firestore & Storage initialization
    │   │   └── security.py      # The 5-Door RBAC authentication logic
    │   ├── models/              # Pydantic schemas for data validation
    │   └── services/            # Business logic and database operations
    ├── serviceAccountKey.json   # (IGNORED IN GIT) Firebase Admin SDK key
    ├── .env                     # (IGNORED IN GIT) Environment variables
    ├── requirements.txt         # Python dependencies
    └── main.py                  # The centralized FastAPI switchboard




    1. Clone & Environment
    Bash
    git clone <your-repo-url>
    cd backend
    python -m venv venv
    source venv/bin/activate  # On Windows use: venv\Scripts\activate
    pip install -r requirements.txt


    .env

    ENVIRONMENT="development"
    PROJECT_NAME="SRM Campus Economy API"

    # Security
    SECRET_KEY="generate-a-secure-random-string"

    # Firebase
    FIREBASE_CREDENTIALS_PATH="serviceAccountKey.json"
    FIREBASE_STORAGE_BUCKET="your-project-id.appspot.com"

    # Sentry (Optional for local dev)
    SENTRY_DSN="your-sentry-dsn-url"




    3. Firebase Initialization
    Go to the Firebase Console.

    Navigate to Project Settings > Service Accounts.

    Generate a new private key and save it in the root directory as serviceAccountKey.json.

    4. Run the Server
    Bash
    uvicorn main:app --reload
    The API will be live at http://127.0.0.1:8000.
    Visit http://127.0.0.1:8000/docs to view the auto-generated interactive Swagger UI documentation.

    📡 Core API Routes
    System: /, /test-db

    Users: /api/users/sync, /api/users/me

    Dashboards: /api/dashboard/student, /api/dashboard/shop, /api/dashboard/admin

    Student P2P: /api/products/..., /api/services/...

    Business B2C: /api/shops/...

    Economy: /api/chat/...




ENVIRONMENT="development"
FIREBASE_CREDENTIALS_PATH="serviceAccountKey.json"
SECRET_KEY="" generate in python
FIREBASE_STORAGE_BUCKET=""
SENTRY_DSN=""
FIREBASE_WEB_API_KEY = ""
