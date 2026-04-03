"""
Однократное создание администратора при пустой таблице users.
Учётные данные задаются через ADMIN_EMAIL / ADMIN_PASSWORD в окружении
(в .env на сервере), иначе — значения по умолчанию ниже (смените пароль в проде).
"""
import os

import models
from config.logger import setup_logger
from database import SessionLocal
from security import hash_password

logger = setup_logger("bootstrap_admin")


def ensure_default_admin() -> None:
    if os.getenv("SKIP_BOOTSTRAP_ADMIN", "").lower() in ("1", "true", "yes"):
        logger.info("SKIP_BOOTSTRAP_ADMIN: пропуск создания администратора")
        return

    db = SessionLocal()
    try:
        if db.query(models.User).first():
            return

        email = os.getenv("ADMIN_EMAIL", "sardor@gmail.com").strip().lower()
        password = os.getenv("ADMIN_PASSWORD", "123401")

        user = models.User(
            email=email,
            hashed_password=hash_password(password),
            full_name=os.getenv("ADMIN_FULL_NAME", "Administrator"),
        )
        db.add(user)
        db.commit()
        logger.warning(
            "Создан единственный администратор (таблица users была пуста): %s. "
            "Смените пароль через переменную ADMIN_PASSWORD в .env и перезапустите при необходимости.",
            email,
        )
    finally:
        db.close()
