import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

# 🚨 Replace with your actual email and the 16-letter App Password you just generated!
SENDER_EMAIL = os.getenv("GMAIL_ADDRESS")
APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD") 

def send_otp_email(receiver_email: str, otp: str):
    """Sends a 6-digit OTP to the user's SRM email."""
    try:
        message = MIMEMultipart()
        message["From"] = f"SRM Marketplace <{SENDER_EMAIL}>"
        message["To"] = receiver_email
        message["Subject"] = "Your SRM Marketplace Verification Code"

        # The HTML body of the email
        html = f"""
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
            <h2>Welcome to SRM Marketplace!</h2>
            <p>Your official student verification code is:</p>
            <h1 style="color: #2563EB; font-size: 40px; letter-spacing: 5px;">{otp}</h1>
            <p>This code will expire in 5 minutes. Do not share it with anyone.</p>
          </body>
        </html>
        """
        message.attach(MIMEText(html, "html"))

        # Connect to Google's SMTP server and send the email
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(SENDER_EMAIL, APP_PASSWORD)
            server.sendmail(SENDER_EMAIL, receiver_email, message.as_string())
            
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        return False