"""
Умный поиск товаров: нормализация, синонимы автозапчастей, нечёткое совпадение.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import List, Optional, Set, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Query

import models

_SYNONYM_GROUPS: Tuple[Tuple[str, ...], ...] = (
    ("амортизатор", "мартезатор", "аморт", "стойка", "амортиз"),
    ("фара", "фонарь", "headlight", "фары"),
    ("правая", "прав", "правый", "pr", "r", "п", "rh"),
    ("левая", "лев", "левый", "pl", "l", "л", "lh"),
    ("свеча", "свечи", "spark", "свечка"),
    ("зажигания", "зажигание", "ignition", "зажиг"),
    ("камри", "camry", "камри70", "камри75"),
    ("тормоз", "колодк", "колодки", "brake"),
    ("масло", "oil", "моторное"),
    ("фильтр", "filter", "фильтра"),
    ("подшипник", "подшип", "bearing"),
    ("ремень", "belt", "ремн"),
    ("насос", "pump", "помпа"),
    ("радиатор", "radiator", "рад"),
    ("крыло", "wing", "крылья"),
    ("бампер", "bumper"),
    ("дворник", "щетк", "стеклоочист"),
    ("аккумулятор", "акб", "battery"),
    ("генератор", "generator", "ген"),
    ("стартер", "starter"),
    ("сальник", "seal", "сальники"),
    ("прокладка", "gasket", "проклад"),
    ("рычаг", "lever", "рычаги"),
    ("шрус", "cv", "граната"),
    ("суппорт", "caliper"),
    ("диск", "disk", "disc", "диски"),
    ("оригинал", "oem", "original"),
)

_LATIN_TO_CYR = str.maketrans(
    {
        "a": "а",
        "b": "в",
        "c": "с",
        "e": "е",
        "h": "н",
        "k": "к",
        "m": "м",
        "o": "о",
        "p": "р",
        "r": "р",
        "t": "т",
        "x": "х",
        "y": "у",
    }
)

_MIN_FUZZY_LEN = 3
_FUZZY_MIN_SCORE = 0.52
_SUBSEQUENCE_MIN_RATIO = 0.72
_FUZZY_FALLBACK_CAP = 2500


def normalize_search_text(value: str) -> str:
    s = (value or "").lower().strip()
    s = s.translate(_LATIN_TO_CYR)
    s = re.sub(r"[^a-zа-яё0-9]", "", s)
    return s


def _tokenize(query: str) -> List[str]:
    raw = re.split(r"[\s,;/|+]+", (query or "").strip().lower())
    return [t for t in raw if t]


def expand_term_variants(term: str) -> List[str]:
    """Один токен + синонимы из его группы."""
    out: Set[str] = {term}
    norm = normalize_search_text(term)
    if norm:
        out.add(norm)
    for group in _SYNONYM_GROUPS:
        group_raw = set(group)
        group_norm = {normalize_search_text(g) for g in group}
        if term in group_raw or norm in group_norm:
            out.update(group_raw)
            out.update(g for g in group_norm if g)
    return [t for t in out if t]


def expand_search_terms(query: str) -> List[str]:
    tokens = _tokenize(query)
    if not tokens:
        return []
    expanded: Set[str] = set()
    for token in tokens:
        expanded.update(expand_term_variants(token))
    return list(expanded)


def subsequence_match(needle: str, haystack: str) -> bool:
    a = normalize_search_text(needle)
    b = normalize_search_text(haystack)
    if not a:
        return True
    if not b:
        return False
    if a in b:
        return True
    i = 0
    for ch in b:
        if ch == a[i]:
            i += 1
            if i == len(a):
                return True
    return False


def fuzzy_score(needle: str, haystack: str) -> float:
    a = normalize_search_text(needle)
    b = normalize_search_text(haystack)
    if not a:
        return 1.0
    if not b:
        return 0.0
    if a in b:
        return 1.0
    if subsequence_match(a, b):
        ratio = len(a) / max(len(b), 1)
        return max(_SUBSEQUENCE_MIN_RATIO, min(0.95, 0.75 + ratio * 0.2))
    return SequenceMatcher(None, a, b).ratio()


def _field_ilike(pattern: str):
    return or_(
        models.Product.name.ilike(pattern),
        models.Product.sku.ilike(pattern),
        models.Product.barcode.ilike(pattern),
        models.Product.brand.ilike(pattern),
        models.Product.model.ilike(pattern),
        models.Product.category.ilike(pattern),
        models.Product.description.ilike(pattern),
        models.Product.supplier.ilike(pattern),
    )


def apply_product_search_filter(query: Query, search: Optional[str]) -> Query:
    """Каждый токен запроса (AND) — варианты токена (OR по полям)."""
    if not search or not str(search).strip():
        return query
    user_terms = _tokenize(search)
    for user_term in user_terms:
        variants = expand_term_variants(user_term)
        if not variants:
            variants = [user_term]
        query = query.filter(or_(*[_field_ilike(f"%{v}%") for v in variants]))
    return query


def product_haystack(product: models.Product) -> str:
    parts = [
        product.name,
        product.sku,
        product.barcode,
        product.brand,
        product.model,
        product.category,
        product.description,
        product.supplier,
    ]
    return " ".join(str(p) for p in parts if p)


def score_product(product: models.Product, query: str) -> float:
    """Оценка релевантности 0..1."""
    hay = product_haystack(product)
    q_norm = normalize_search_text(query)
    if not q_norm:
        return 1.0
    hay_norm = normalize_search_text(hay)
    if q_norm in hay_norm:
        return 1.0
    tokens = _tokenize(query)
    if not tokens:
        return fuzzy_score(query, hay)
    scores = [fuzzy_score(t, hay) for t in tokens]
    return sum(scores) / len(scores)


def rank_products(products: List[models.Product], query: str, min_score: float = 0.0) -> List[models.Product]:
    scored = [(score_product(p, query), p) for p in products]
    scored = [(s, p) for s, p in scored if s >= min_score]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored]


def search_products(
    base_query: Query,
    search: str,
    *,
    limit: int,
    skip: int = 0,
) -> List[models.Product]:
    """
    Умный поиск: SQL с синонимами → ранжирование → при малом ответе нечёткий поиск по каталогу.
    """
    q = (search or "").strip()
    if not q:
        return base_query.order_by(models.Product.created_at.desc()).offset(skip).limit(limit).all()

    filtered = apply_product_search_filter(base_query, q)
    pool_limit = max(limit * 6, 80)
    rows = filtered.order_by(models.Product.created_at.desc()).limit(pool_limit).all()
    ranked = rank_products(rows, q)

    if len(ranked) < min(limit, 8) and len(normalize_search_text(q)) >= _MIN_FUZZY_LEN:
        cap_rows = (
            base_query.order_by(models.Product.created_at.desc()).limit(_FUZZY_FALLBACK_CAP).all()
        )
        fuzzy_ranked = rank_products(cap_rows, q, min_score=_FUZZY_MIN_SCORE)
        seen = {p.id for p in ranked}
        for p in fuzzy_ranked:
            if p.id not in seen:
                ranked.append(p)
                seen.add(p.id)

    return ranked[skip : skip + limit]
