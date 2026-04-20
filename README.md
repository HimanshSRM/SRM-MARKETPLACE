# 🎓 Campus Marketplace

A full-stack, enterprise-grade marketplace designed exclusively for university campuses. This platform allows students to buy, sell, and offer services in a secure, role-based ecosystem with built-in moderation, real-time negotiation, and official campus storefronts.

## ✨ Key Features

### 🔐 Progressive Authentication & Security
* **Unified Login:** Seamless 1-click OAuth (Google, GitHub) alongside secure Email/Password.
* **Two-Vault Security:** Passwords and core credentials are mathematically hashed and handled entirely by Google's Firebase Auth, keeping the application database 100% secure.
* **Progressive Onboarding:** Users start as `guests` and are automatically routed through dynamic verification flows (via `.edu.in` emails) before gaining `student` trading privileges.

### 💬 Real-Time Bidding & Negotiation
* **Live Chat Engine:** Direct messaging between buyers and sellers.
* **Official Bids:** Buyers can send mathematical "Official Bids" directly in the chat, which sellers can accept with one click to instantly mark an item as "Sold".
* **State Persistence:** In-progress chat drafts and active filter states are automatically saved to local storage so users never lose their context upon refreshing.

### 🛡️ Advanced Admin & Moderation (God-Mode)
* **Live Audit Log:** A comprehensive tracking system for all platform interactions.
* **In-Chat Moderation:** Admins can step into user chats to issue official warnings, delete items, or drop the ban-hammer directly from the negotiation screen.
* **Strike System:** Automated strike counting and account suspension (locking users into a read-only mode).
* **Quick Actions:** 1-click "Quick Unban" and role reassignment from the directory.

### 🏪 Official Campus Shops
* **Business Registration:** Students can apply to open official campus storefronts.
* **Smart State Handling:** If a user tries to open a new shop but already has an archived one, the system intelligently intercepts them, offering a 1-click reactivation flow.

---

## 🛠️ Tech Stack

**Frontend:**
* [Next.js](https://nextjs.org/) (React Framework)
* TypeScript
* Tailwind CSS (Styling & Animations)
* React Context API (Global Auth State)

**Backend:**
* [FastAPI](https://fastapi.tiangolo.com/) (Python)
* Firebase Authentication (JWT validation & OAuth mapping)
* Cloud Firestore (NoSQL Document Database)

---

## 🗂️ System Architecture & Roles

The application relies on a strict separation of **Authentication** (Firebase) and **Authorization** (FastAPI). 
Users are assigned one of the following dynamic roles:
1.  `guest`: Can view the landing page and login, but cannot trade.
2.  `student`: Fully verified campus member. Can buy, sell, and chat.
3.  `shop_verified`: An approved campus business with a dedicated storefront.
4.  `admin`: Platform moderators with full read/write/nuke permissions.
5.  `banned`: Suspended users restricted to read-only mode and Admin Support chats.

---

## 🚀 Getting Started (Local Development)

### Prerequisites
* Node.js (v18+)
* Python (3.10+)
* A Firebase Project (with Firestore and Authentication enabled)

### 1. Setup the Frontend
```bash
# Clone the repository
git clone [https://github.com/yourusername/campus-marketplace.git](https://github.com/yourusername/campus-marketplace.git)
cd campus-marketplace

# Install dependencies
npm install
