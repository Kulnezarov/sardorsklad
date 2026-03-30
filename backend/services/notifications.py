import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

NOTIFICATIONS_ENABLED = os.getenv("NOTIFICATIONS_ENABLED", "true").lower() == "true"


class Notification:
    def __init__(self, title: str, message: str, notification_type: str = "info"):
        self.id = None
        self.title = title
        self.message = message
        self.type = notification_type
        self.timestamp = datetime.now()
        self.read = False


notifications_queue = []


def send_notification(title: str, message: str, notification_type: str = "info"):
    """Send notification to queue"""
    if not NOTIFICATIONS_ENABLED:
        return False

    notification = Notification(title, message, notification_type)
    notifications_queue.append(notification)
    print(f"[{notification_type.upper()}] {title}: {message}")
    return True


def low_stock_notification(product_name: str, quantity: int, threshold: int = 10):
    """Notify about low stock"""
    return send_notification(
        "Low Stock Alert",
        f"{product_name} has only {quantity} units left (threshold: {threshold})",
        "warning",
    )


def sale_notification(product_name: str, quantity: int, total_price: float):
    """Notify about new sale"""
    return send_notification(
        "Sale Recorded",
        f"Sold {quantity}x {product_name} for ${total_price}",
        "info",
    )


def revision_notification(product_name: str, expected: int, actual: int):
    """Notify about revision discrepancy"""
    difference = actual - expected
    return send_notification(
        "Inventory Revision",
        f"{product_name}: expected {expected}, found {actual} ({difference:+d})",
        "warning" if difference != 0 else "info",
    )


def get_notifications():
    """Get all notifications"""
    return notifications_queue


def clear_notifications():
    """Clear notification queue"""
    global notifications_queue
    notifications_queue = []
    return True
