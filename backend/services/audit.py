from typing import Any, Optional

import models
from sqlalchemy.orm import Session


def write_audit_log(
    db: Session,
    *,
    user_id: Optional[int],
    action: str,
    entity_type: str,
    entity_id: Optional[int] = None,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    db.add(
        models.AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            payload_json=payload or {},
        )
    )
