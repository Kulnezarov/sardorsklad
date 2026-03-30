# Authentication API Documentation

## Overview

SkladPro uses Supabase Authentication for user management and JWT tokens for API access.

## Authentication Flow

### 1. User Registration
Users are created through Supabase Auth dashboard or API.

### 2. User Login
```http
POST /api/v1/auth/token
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "created_at": "2023-12-01T10:00:00Z"
  }
}
```

### 3. API Access
Include the JWT token in the Authorization header:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Endpoints

### POST /api/v1/auth/token
Authenticate user and return JWT token.

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User email |
| password | string | Yes | User password |

**Response:**
- `200 OK`: Authentication successful
- `401 Unauthorized`: Invalid credentials
- `422 Unprocessable Entity`: Validation error

### POST /api/v1/auth/refresh
Refresh JWT token.

**Request Headers:**
```http
Authorization: Bearer <current_token>
```

**Response:**
```json
{
  "access_token": "new_jwt_token",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### POST /api/v1/auth/logout
Logout user and invalidate token.

**Request Headers:**
```http
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "Successfully logged out"
}
```

### GET /api/v1/auth/me
Get current user information.

**Request Headers:**
```http
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "user-id",
  "email": "user@example.com",
  "created_at": "2023-12-01T10:00:00Z",
  "last_sign_in_at": "2023-12-01T15:30:00Z"
}
```

## Frontend Integration

### React Hook Example
```javascript
import { useAuth } from '../contexts/AuthContext';

function Login() {
  const { login } = useAuth();
  
  const handleLogin = async (email, password) => {
    try {
      await login(email, password);
      // Redirect to dashboard
    } catch (error) {
      // Handle error
    }
  };
}
```

### API Client Setup
```javascript
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.VITE_API_URL,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('supabase_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

## Security Considerations

### JWT Token Storage
- Store tokens securely (httpOnly cookies recommended)
- Implement token refresh mechanism
- Handle token expiration gracefully

### CORS Configuration
Ensure proper CORS settings in production:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)
```

### Rate Limiting
Implement rate limiting for authentication endpoints to prevent brute force attacks.

## Error Handling

### Common Error Responses

**401 Unauthorized:**
```json
{
  "detail": "Invalid authentication credentials",
  "error_code": "INVALID_CREDENTIALS"
}
```

**401 Token Expired:**
```json
{
  "detail": "Token has expired",
  "error_code": "TOKEN_EXPIRED"
}
```

**422 Validation Error:**
```json
{
  "detail": "Validation error",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

## Testing

### Test Authentication Flow
```bash
# Login
curl -X POST http://localhost:8000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Use token for API call
curl -X GET http://localhost:8000/api/v1/products \
  -H "Authorization: Bearer <token>"
```

## Environment Variables

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key

# JWT Configuration
JWT_SECRET_KEY=your-jwt-secret
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60
```

## Troubleshooting

### Common Issues

1. **Token not working**
   - Check token format (should be JWT)
   - Verify token is not expired
   - Ensure proper Authorization header format

2. **CORS errors**
   - Check frontend URL in CORS configuration
   - Ensure credentials flag is set correctly

3. **Supabase connection issues**
   - Verify Supabase URL and keys
   - Check network connectivity
   - Ensure RLS policies allow access

### Debug Mode
Enable debug logging for troubleshooting:
```bash
LOG_LEVEL=DEBUG
```

---

*Last updated: December 2023*
