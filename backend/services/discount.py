from typing import Union
from decimal import Decimal, ROUND_HALF_UP
from models import Product

def calculate_discount(price: Union[float, Decimal, int], discount_percent: Union[float, Decimal, int]) -> Decimal:
    """
    Calculate discounted price with proper rounding.
    
    Args:
        price: Original price
        discount_percent: Discount percentage (0-100)
    
    Returns:
        Discounted price rounded to 2 decimal places
    
    Raises:
        ValueError: If discount_percent is not between 0 and 100
    """
    # Convert to Decimal for precision
    price_decimal = Decimal(str(price))
    discount_decimal = Decimal(str(discount_percent))
    
    # Validate discount percentage
    if discount_decimal < 0 or discount_decimal > 100:
        raise ValueError("Discount percentage must be between 0 and 100")
    
    # Calculate discount amount
    discount_amount = price_decimal * (discount_decimal / Decimal('100'))
    
    # Calculate final price
    discounted_price = price_decimal - discount_amount
    
    # Round to 2 decimal places
    return discounted_price.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

def apply_product_discount(product: Product, discount_percent: Union[float, Decimal, int]) -> Decimal:
    """
    Apply discount to a product and return the new sale price.
    
    Args:
        product: Product instance
        discount_percent: Discount percentage to apply
    
    Returns:
        New sale price after discount
    """
    if not product.sale_price:
        raise ValueError("Product must have a sale price")
    
    return calculate_discount(product.sale_price, discount_percent)
