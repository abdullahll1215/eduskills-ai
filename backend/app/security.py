"""Authentication (bcrypt + JWT), encryption at rest (Fernet) and reviewer anonymization (salted SHA-256)."""
import base64
import hashlib
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

settings = get_settings()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": user_id, "role": role, "exp": expire}, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


def _fernet() -> Fernet:
    key = settings.encryption_key
    if not key:
        key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt(text: str | None) -> str | None:
    if text is None or text == "":
        return None
    return _fernet().encrypt(text.encode()).decode()


def decrypt(token: str | None) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return ""


def reviewer_hash(reviewer_id: str, project_id: str) -> str:
    """Salted SHA-256 hash of the reviewer identity. Scoped per project so hashes cannot be linked across projects."""
    raw = f"{settings.anonymization_salt}:{project_id}:{reviewer_id}"
    return hashlib.sha256(raw.encode()).hexdigest()
