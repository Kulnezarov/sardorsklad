"""Начальный справочник групп и подкатегорий (идемпотентный сид)."""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

import models


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9а-яё]+", "-", name.lower()).strip("-")
    return s or "item"


def _schema(fields: list, *, show_compatibility: bool = False) -> dict:
    from services.form_layout import normalize_attribute_schema

    return normalize_attribute_schema({
        "fields": fields,
        "show_compatibility": show_compatibility,
    })


# (icon, group_name, [(icon, sub_name, schema), ...])
CATEGORY_TREE: list[tuple[str, str, list[tuple[str, str, dict]]]] = [
    ("🏗️", "Двигатель и Навесное оборудование (Крупные узлы)", [
        ("⚙️", "Двигатели в сборе (Моторы)", _schema([
            {"key": "engine_volume", "label": "Объём", "type": "select", "options": ["1.1", "1.3", "1.5"], "unit": "л"},
            {"key": "motor_code", "label": "Код мотора", "type": "text"},
        ], show_compatibility=True)),
        ("⚡", "Генераторы и Стартеры", _schema([
            {"key": "voltage", "label": "Вольтаж", "type": "select", "options": ["12V", "24V"]},
            {"key": "amperage", "label": "Ампераж", "type": "number", "unit": "А"},
        ])),
        ("🌀", "Турбины и Компрессоры", _schema([
            {"key": "unit_type", "label": "Тип", "type": "select", "options": ["Турбина", "Компрессор"]},
            {"key": "note", "label": "Примечание", "type": "textarea"},
        ])),
    ]),
    ("🌡️", "Система охлаждения и Отопления", [
        ("🧊", "Радиаторы", _schema([
            {"key": "purpose", "label": "Назначение", "type": "select", "options": ["Охлаждение", "Кондиционер", "Печка"]},
            {"key": "transmission", "label": "Тип КПП", "type": "select", "options": ["МКПП", "АКПП"]},
        ], show_compatibility=True)),
        ("➿", "Патрубки и Шланги", _schema([
            {"key": "material", "label": "Материал", "type": "select", "options": ["Резина", "Силикон", "Металл"]},
            {"key": "diameter_mm", "label": "Диаметр", "type": "number", "unit": "мм"},
        ])),
        ("💧", "Помпы и Термостаты", _schema([
            {"key": "unit_type", "label": "Тип", "type": "select", "options": ["Помпа", "Термостат"]},
        ])),
    ]),
    ("🪟", "Кузовные запчасти и Оптика", [
        ("🛡️", "Автостекла", _schema([
            {"key": "glass_type", "label": "Тип", "type": "select", "options": ["Лобовое", "Боковое", "Заднее"]},
            {"key": "heated", "label": "Подогрев", "type": "select", "options": ["Да", "Нет"]},
        ], show_compatibility=True)),
        ("🪞", "Зеркала", _schema([
            {"key": "side", "label": "Сторона", "type": "select", "options": ["Левое", "Правое"]},
            {"key": "power", "label": "Электропривод", "type": "select", "options": ["Да", "Нет"]},
            {"key": "chrome", "label": "Хром", "type": "select", "options": ["Да", "Нет"]},
        ], show_compatibility=True)),
        ("🚪", "Дверные ручки и Замки", _schema([
            {"key": "position", "label": "Позиция", "type": "select", "options": ["Передняя", "Задняя"]},
            {"key": "side", "label": "Сторона", "type": "select", "options": ["Левая", "Правая"]},
        ])),
        ("🚙", "Брызговики", _schema([
            {"key": "position", "label": "Позиция", "type": "select", "options": ["Передние", "Задние"]},
        ])),
        ("💡", "Фары и Фонари", _schema([
            {"key": "light_type", "label": "Тип", "type": "select", "options": ["Фара", "Фонарь", "ПТФ"]},
            {"key": "side", "label": "Сторона", "type": "select", "options": ["Левая", "Правая", "Пара"]},
        ])),
    ]),
    ("🛋️", "Салон и Интерьер", [
        ("🎛️", "Панели и Обшивка", _schema([
            {"key": "panel_type", "label": "Тип", "type": "select", "options": ["Торпедо", "Дверная карта", "Потолок"]},
            {"key": "color", "label": "Цвет", "type": "text"},
        ])),
        ("🛟", "Подушки безопасности (Airbag)", _schema([
            {"key": "position", "label": "Позиция", "type": "select", "options": ["Водитель", "Пассажир", "Боковая", "Шторка"]},
        ])),
        ("🕹️", "Элементы управления", _schema([
            {"key": "ctrl_type", "label": "Тип", "type": "select", "options": ["Кнопка", "Переключатель", "Ручка"]},
        ])),
    ]),
    ("🧠", "Электроника и Датчики", [
        ("🔌", "Датчики", _schema([
            {"key": "sensor_type", "label": "Тип", "type": "select", "options": ["ABS", "Коленвал", "Парктроник", "Другой"]},
            {"key": "contacts", "label": "Контактов", "type": "number"},
        ])),
        ("💻", "Блоки управления (ЭБУ)", _schema([
            {"key": "ecu_type", "label": "Тип блока", "type": "text"},
            {"key": "oem_code", "label": "Код OEM", "type": "text"},
        ])),
        ("🪢", "Проводка и Реле", _schema([
            {"key": "wire_type", "label": "Тип", "type": "select", "options": ["Проводка", "Реле", "Предохранитель"]},
        ])),
    ]),
    ("⚙️", "Ходовая часть, Подвеска и Рулевое управление", [
        ("🚜", "Амортизаторы и Пружины", _schema([
            {"key": "unit_type", "label": "Тип", "type": "select", "options": ["Амортизатор", "Пружина"]},
            {"key": "axle", "label": "Ось", "type": "select", "options": ["Перед", "Зад"]},
        ], show_compatibility=True)),
        ("🦴", "Рычаги и Сайлентблоки", _schema([
            {"key": "unit_type", "label": "Тип", "type": "select", "options": ["Рычаг", "Сайлентблок"]},
            {"key": "axle", "label": "Позиция", "type": "select", "options": ["Перед", "Зад"]},
        ])),
        ("🛞", "Рулевые наконечники и Тяги", _schema([
            {"key": "unit_type", "label": "Тип", "type": "select", "options": ["Наконечник", "Тяга", "Рейка"]},
            {"key": "side", "label": "Сторона", "type": "select", "options": ["Левая", "Правая"]},
        ])),
    ]),
    ("⛓️", "Тросы и Приводы", [
        ("🧵", "Тросы", _schema([
            {"key": "cable_type", "label": "Назначение", "type": "select", "options": ["Капот", "Ручник", "Газ"]},
            {"key": "length_mm", "label": "Длина", "type": "number", "unit": "мм"},
        ])),
        ("⚙️", "Приводы в сборе и ШРУСы", _schema([
            {"key": "unit_type", "label": "Тип", "type": "select", "options": ["Привод", "ШРУС"]},
            {"key": "axle", "label": "Ось", "type": "select", "options": ["Перед", "Зад"]},
            {"key": "side", "label": "Сторона", "type": "select", "options": ["Левая", "Правая"]},
        ], show_compatibility=True)),
    ]),
    ("🔩", "Крепеж и Мелочевка", [
        ("🔩", "Зажимные болты, гайки и пистоны", _schema([
            {"key": "thread", "label": "Резьба", "type": "select", "options": ["М6", "М8", "М10"]},
            {"key": "length_mm", "label": "Длина", "type": "number", "unit": "мм"},
            {"key": "pitch", "label": "Шаг", "type": "text"},
        ])),
        ("⭕", "Хомуты и Прокладки", _schema([
            {"key": "unit_type", "label": "Тип", "type": "select", "options": ["Хомут", "Прокладка", "Сальник"]},
            {"key": "size", "label": "Размер", "type": "text"},
        ])),
    ]),
    ("🛢️", "Жидкости и Расходники", [
        ("🛢️", "Автомасла", _schema([
            {"key": "viscosity", "label": "Вязкость", "type": "select", "options": ["0W-20", "5W-30", "5W-40", "10W-40"]},
            {"key": "volume", "label": "Объём", "type": "select", "options": ["1л", "4л"]},
        ])),
        ("💨", "Фильтры", _schema([
            {"key": "filter_type", "label": "Тип", "type": "select", "options": ["Масляный", "Воздушный", "Салонный", "Топливный"]},
        ], show_compatibility=True)),
        ("🛑", "Тормозные колодки и диски", _schema([
            {"key": "unit_type", "label": "Тип", "type": "select", "options": ["Колодки", "Диск"]},
            {"key": "axle", "label": "Ось", "type": "select", "options": ["Перед", "Зад"]},
        ], show_compatibility=True)),
        ("🛞", "Шины и Диски", _schema([
            {"key": "radius", "label": "Радиус", "type": "select", "options": ["R13", "R14", "R15", "R16", "R17", "R18", "R19", "R20", "R21", "R22"]},
            {"key": "width_mm", "label": "Ширина", "type": "number", "unit": "мм"},
            {"key": "profile", "label": "Профиль", "type": "number", "unit": "%"},
            {"key": "season", "label": "Сезон", "type": "select", "options": ["Лето", "Зима", "Всесезон"]},
        ])),
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
        for si, (s_icon, s_name, schema) in enumerate(children):
            _upsert_category(
                db,
                s_name,
                parent_id=group.id,
                icon=s_icon,
                sort_order=gi * 100 + si + 1,
                attribute_schema=schema,
            )
    db.commit()
    return count
