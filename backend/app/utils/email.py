import os
import requests
from dotenv import load_dotenv

load_dotenv()

# We swapped the Google App Password for the Brevo API Key
SENDER_EMAIL = os.getenv("GMAIL_ADDRESS")
BREVO_API_KEY = os.getenv("BREVO_API_KEY") 

def send_otp_email(receiver_email: str, otp: str):
    """Sends a 6-digit OTP to the user's SRM email via Brevo HTTP API."""
    
    url = "https://api.brevo.com/v3/smtp/email"
    
    headers = {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json"
    }
    
    # Your exact custom HTML from before!
    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
        <h2>Welcome to SRM Marketplace!</h2>
        <p>Your official student verification code is:</p>
        <h1 style="color: #2563EB; font-size: 40px; letter-spacing: 5px;">{otp}</h1>
        <p>This code will expire in 5 minutes. Do not share it with anyone.</p>
      </body>
    </html>
    """
    
    payload = {
        "sender": {"email": SENDER_EMAIL, "name": "SRM Marketplace"},
        "to": [{"email": receiver_email}],
        "subject": "Your SRM Marketplace Verification Code",
        "htmlContent": html_content
    }
    
    try:
        # We use requests.post over port 443 (HTTP) which Render completely allows
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status() 
        return True
    except Exception as e:
        print(f"Failed to send email via Brevo: {e}")
        # This will print the exact reason if Brevo rejects it
        if hasattr(e, 'response') and e.response is not None:
            print(f"Brevo Error Details: {e.response.text}")
        return False