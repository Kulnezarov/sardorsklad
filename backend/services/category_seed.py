"""Начальный справочник групп и подкатегорий (идемпотентный сид)."""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

import models


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9а-яё]+", "-", name.lower()).strip("-")
    return s or "item"


def _field(key: str, label: str, ftype: str, opts: list[str] | None = None, *, required: bool = False) -> dict:
    row: dict = {"key": key, "label": label, "type": ftype, "required": required}
    if opts:
        row["options"] = opts
    return row


def _schema(fields: list[dict], *, show_compatibility: bool = False) -> dict:
    from services.form_layout import normalize_attribute_schema

    return normalize_attribute_schema({
        "fields": fields,
        "show_compatibility": show_compatibility,
    })


# (icon, group_name, [(sub_name, schema), ...])
CATEGORY_TREE: list[tuple[str, str, list[tuple[str, dict]]]] = [
    ("⚙️", "Двигатель", [
        ("Мотор", _schema([
            _field("volume", "Объём (л)", "text", required=True),
            _field("fuel", "Тип топлива", "chip", ["Бензин", "Дизель", "Газ", "Гибрид"], required=True),
        ], show_compatibility=True)),
        ("Генератор", _schema([
            _field("voltage", "Вольтаж", "text"),
            _field("power", "Мощность (Вт)", "text"),
        ], show_compatibility=True)),
        ("Стартер", _schema([
            _field("voltage", "Вольтаж", "text"),
            _field("power", "Мощность (кВт)", "text"),
        ], show_compatibility=True)),
        ("Турбина", _schema([
            _field("type", "Тип", "text"),
            _field("pressure", "Давление наддува", "text"),
        ], show_compatibility=True)),
        ("Помпа", _schema([
            _field("type", "Тип", "text"),
        ], show_compatibility=True)),
    ]),
    ("🚗", "Кузов", [
        ("Дверь", _schema([
            _field("side", "Сторона", "chip", ["Левая", "Правая"]),
            _field("pos", "Позиция", "chip", ["Передняя", "Задняя"]),
            _field("moving", "Подвижная", "chip", ["Да", "Нет"]),
        ], show_compatibility=True)),
        ("Капот", _schema([
            _field("material", "Материал", "text"),
        ], show_compatibility=True)),
        ("Бампер", _schema([
            _field("pos", "Позиция", "chip", ["Передний", "Задний"]),
            _field("parking", "С парктроником", "chip", ["Да", "Нет"]),
        ], show_compatibility=True)),
        ("Крыло", _schema([
            _field("side", "Сторона", "chip", ["Левое", "Правое"]),
            _field("pos", "Позиция", "chip", ["Переднее", "Заднее"]),
        ], show_compatibility=True)),
        ("Зеркало", _schema([
            _field("side", "Сторона", "chip", ["Левое", "Правое"]),
            _field("heat", "С обогревом", "chip", ["Да", "Нет"]),
        ], show_compatibility=True)),
        ("Трос", _schema([
            _field("naznachenie", "Назначение", "chip", [
                "Сцепление", "Ручник", "Капот", "Багажник", "Дверь", "Сиденье", "Другое",
            ], required=True),
            _field("dlina", "Длина (мм)", "text"),
        ], show_compatibility=True)),
    ]),
    ("🔩", "Подвеска", [
        ("Амортизатор", _schema([
            _field("side", "Сторона", "chip", ["Левый", "Правый"]),
            _field("axis", "Ось", "chip", ["Передний", "Задний"]),
            _field("type", "Тип", "chip", ["Масляный", "Газовый", "Газомасляный"]),
        ], show_compatibility=True)),
        ("Пружина", _schema([
            _field("axis", "Ось", "chip", ["Передняя", "Задняя"]),
            _field("stiff", "Жёсткость", "text"),
        ], show_compatibility=True)),
        ("Рычаг", _schema([
            _field("side", "Сторона", "chip", ["Левый", "Правый"]),
            _field("pos", "Позиция", "chip", ["Передний", "Задний"]),
        ], show_compatibility=True)),
    ]),
    ("🛑", "Тормоза", [
        ("Диск", _schema([
            _field("axis", "Ось", "chip", ["Передний", "Задний"]),
            _field("vent", "Вентилируемый", "chip", ["Да", "Нет"]),
        ], show_compatibility=True)),
        ("Колодки", _schema([
            _field("axis", "Ось", "chip", ["Передние", "Задние"]),
            _field("material", "Материал", "text"),
        ], show_compatibility=True)),
        ("Суппорт", _schema([
            _field("side", "Сторона", "chip", ["Левый", "Правый"]),
            _field("axis", "Ось", "chip", ["Передний", "Задний"]),
            _field("pistons", "Поршней", "text"),
        ], show_compatibility=True)),
    ]),
    ("🧴", "Жидкости", [
        ("Моторное масло", _schema([
            _field("visc", "Вязкость", "chip", ["0W-20", "5W-30", "5W-40", "10W-40", "15W-40"]),
            _field("vol", "Объём (л)", "chip", ["1", "4", "5", "20", "60"]),
            _field("oiltype", "Тип", "chip", ["Синтетика", "Полусинтетика", "Минерал"]),
        ])),
        ("Транс. масло", _schema([
            _field("gearbox", "Тип КПП", "chip", ["МКПП", "АКПП", "DSG"]),
            _field("vol", "Объём (л)", "chip", ["1", "2", "4", "5"]),
            _field("visc", "Вязкость", "text"),
        ])),
        ("Антифриз", _schema([
            _field("color", "Цвет", "chip", ["Зелёный", "Красный", "Синий", "Жёлтый"]),
            _field("vol", "Объём (л)", "chip", ["1", "5", "10", "20"]),
            _field("temp", "Температура (°C)", "text"),
            _field("std", "Стандарт", "chip", ["G11", "G12", "G12+", "G13"]),
        ])),
        ("Тормозная жидкость", _schema([
            _field("dot", "Класс (DOT)", "chip", ["DOT 3", "DOT 4", "DOT 5", "DOT 5.1"]),
            _field("vol", "Объём (мл)", "chip", ["250", "500", "1000"]),
        ])),
    ]),
    ("🔘", "Фильтры", [
        ("Масляный фильтр", _schema([
            _field("thread", "Резьба", "text"),
        ], show_compatibility=True)),
        ("Воздушный фильтр", _schema([
            _field("type", "Тип", "chip", ["Панельный", "Круглый", "Конусный"]),
        ], show_compatibility=True)),
        ("Топливный фильтр", _schema([
            _field("fuel", "Тип топлива", "chip", ["Бензин", "Дизель"]),
        ], show_compatibility=True)),
    ]),
    ("⚡", "Электрика", [
        ("Фара", _schema([
            _field("side", "Сторона", "chip", ["Левая", "Правая"]),
            _field("type", "Тип", "chip", ["Ближний", "Дальний", "Противотуманная"]),
        ], show_compatibility=True)),
        ("Аккумулятор", _schema([
            _field("cap", "Ёмкость (А·ч)", "text"),
        ], show_compatibility=True)),
        ("Датчик", _schema([
            _field("type", "Тип", "text"),
            _field("conn", "Разъём", "text"),
        ], show_compatibility=True)),
    ]),
]


def _upsert_category(
    db: Session,
    name: str,
    *,
    parent_id: int | None = None,
    icon: str | None = None,
    sort_order: int = 0,
    attribute_schema: dict | None = None,
) -> models.Category:
    slug = _slug(name)
    if parent_id:
        slug = f"{parent_id}-{_slug(name)}"
    row = db.query(models.Category).filter(models.Category.slug == slug).first()
    if row:
        row.name = name
        row.parent_id = parent_id
        row.icon = icon
        row.sort_order = sort_order
        if attribute_schema is not None:
            row.attribute_schema = attribute_schema
        row.is_active = True
        return row
    row = models.Category(
        name=name,
        slug=slug,
        parent_id=parent_id,
        icon=icon,
        sort_order=sort_order,
        attribute_schema=attribute_schema,
        is_active=True,
    )
    db.add(row)
    db.flush()
    return row


def seed_default_categories(db: Session) -> int:
    """Идемпотентно создаёт дерево категорий. Возвращает число групп."""
    count = 0
    for gi, (g_icon, g_name, children) in enumerate(CATEGORY_TREE):
        group = _upsert_category(db, g_name, icon=g_icon, sort_order=gi * 100)
        count += 1
        for si, (s_name, schema) in enumerate(children):
            _upsert_category(
                db,
                s_name,
                parent_id=group.id,
                icon=g_icon,
                sort_order=gi * 100 + si + 1,
                attribute_schema=schema,
            )
    db.commit()
    return count
