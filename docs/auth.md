# Authentication (SkladPro)

SkladPro uses **FastAPI + JWT**: users live in таблице `users` в PostgreSQL, пароли хэшируются (bcrypt), access-токен выдаётся на `/api/v1/auth/login`.

## Регистрация

Публичная регистрация по умолчанию выключена (`ALLOW_OPEN_REGISTRATION=false`). Первый администратор создаётся при старте бэкенда (`bootstrap_admin`), если таблица пользователей пуста. Параметры: `ADMIN_EMAIL`, `ADMIN_PASSWORD` в `backend/.env`.

## Логин (frontend)

После успешного входа клиент сохраняет токен:

```javascript
localStorage.setItem('authToken', access_token);
```

Запросы к API отправляются с заголовком:

```
Authorization: Bearer <access_token>
```

См. `frontend/src/api/client.js` и `frontend/src/auth/AuthContext.jsx`.

## Переменные окружения (backend)

См. `backend/.env.example`: `SECRET_KEY`, `DATABASE_URL`, `JWT_EXPIRE_MINUTES`, `ORIGINS`.

## Типичные проблемы

1. **401 Unauthorized** — истёк или неверный токен; войти снова.
2. **CORS** — добавьте origin фронта в `ORIGINS` в `.env` бэкенда.
3. **Нет связи с БД** — проверьте `DATABASE_URL` и что PostgreSQL запущен.
