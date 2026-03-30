import redis
import os
from dotenv import load_dotenv
import json

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

try:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
except Exception as e:
    print(f"Redis connection failed: {e}")
    redis_client = None


def get_cache(key: str):
    """Get value from cache"""
    if not redis_client:
        return None
    try:
        return redis_client.get(key)
    except Exception as e:
        print(f"Cache get error: {e}")
        return None


def set_cache(key: str, value, ttl: int = 3600):
    """Set value in cache with TTL"""
    if not redis_client:
        return False
    try:
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        redis_client.setex(key, ttl, value)
        return True
    except Exception as e:
        print(f"Cache set error: {e}")
        return False


def delete_cache(key: str):
    """Delete value from cache"""
    if not redis_client:
        return False
    try:
        redis_client.delete(key)
        return True
    except Exception as e:
        print(f"Cache delete error: {e}")
        return False


def clear_cache():
    """Clear all cache"""
    if not redis_client:
        return False
    try:
        redis_client.flushdb()
        return True
    except Exception as e:
        print(f"Cache clear error: {e}")
        return False
