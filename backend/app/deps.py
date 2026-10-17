from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Role, User
from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_access_token(creds.credentials)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found or disabled")
    return user


def require_roles(*roles: Role):
    """Role-Based Access Control guard."""
    allowed = {r.value for r in roles}

    def guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to perform this action")
        return user

    return guard


student_only = require_roles(Role.STUDENT)
instructor_only = require_roles(Role.INSTRUCTOR, Role.ADMIN)
advisor_only = require_roles(Role.ADVISOR, Role.ADMIN)
admin_only = require_roles(Role.ADMIN)
staff_only = require_roles(Role.INSTRUCTOR, Role.ADVISOR, Role.ADMIN)
