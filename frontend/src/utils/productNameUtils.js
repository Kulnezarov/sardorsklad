/**
 * Авто-генерация названия товара из категории + атрибутов.
 *
 * Правила:
 * 1. Берём короткое имя категории (последнее слово или само имя).
 * 2. Добавляем значения атрибутов с флагом use_in_name: true (в порядке schema.fields).
 * 3. chip/select — берём первое слово значения (не технический ключ).
 * 4. Если vehicle_mode === 'brand_model' — опционально добавляем марку/модель.
 */

/**
 * Пытается сократить название категории для использования в авто-названии.
 * «Моторное масло» → «Масло», «Тормозные колодки» → «Колодки» (последнее слово).
 */
function shortCategoryName(name) {
  if (!name) return '';
  const clean = String(name).trim();
  // Если одно слово — вернуть как есть
  const words = clean.split(/\s+/);
  if (words.length <= 1) return clean;
  // Берём последнее слово как существительное
  return words[words.length - 1];
}

/**
 * Форматирует значение атрибута для названия.
 * Число + единица: «5W-30», «3 м», «2000 кг».
 * Chip/select: возвращает опцию как есть.
 */
function formatAttrValue(value, fieldDef) {
  const v = String(value || '').trim();
  if (!v) return '';
  const unit = fieldDef?.unit || '';
  if (unit) return `${v} ${unit}`.trim();
  return v;
}

/**
 * Генерирует авто-название товара.
 *
 * @param {string} categoryName - Название категории
 * @param {object} attributes - Атрибуты товара
 * @param {object} schema - attribute_schema категории
 * @param {{ brand?: string, model?: string }} vehicleData - Марка/модель (опционально)
 * @returns {string}
 */
export function generateProductName(categoryName, attributes, schema, vehicleData = {}) {
  const fields = schema?.fields || [];
  const attrs = attributes || {};

  // Базовое: название категории
  const base = shortCategoryName(categoryName);

  // Собираем значения полей с use_in_name: true
  const nameParts = [];
  for (const field of fields) {
    if (!field.use_in_name) continue;
    const val = attrs[field.key];
    if (val == null || String(val).trim() === '') continue;
    nameParts.push(formatAttrValue(val, field));
  }

  // Если марка/модель нужна — добавляем
  const { brand, model } = vehicleData;
  const vehicleParts = [];
  if (brand?.trim()) vehicleParts.push(brand.trim());
  if (model?.trim()) vehicleParts.push(model.trim());

  // Собираем
  const parts = [base, ...nameParts, ...vehicleParts].filter(Boolean);
  if (!parts.length) return '';

  const result = parts.join(' ');
  // Capitalize первый символ
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/**
 * Проверяет, стоит ли предложить авто-название.
 * Возвращает сгенерированное название или null.
 *
 * @param {string} currentName - Текущее значение поля «Название»
 * @param {boolean} nameTouched - Пользователь сам редактировал название
 * @param {string} categoryName
 * @param {object} attributes
 * @param {object} schema
 * @param {object} vehicleData
 */
export function suggestProductName(currentName, nameTouched, categoryName, attributes, schema, vehicleData = {}) {
  if (nameTouched) return null; // не перезаписывать ручной ввод
  if (!categoryName) return null;

  const fields = schema?.fields || [];
  const hasNameFields = fields.some((f) => f.use_in_name);
  if (!hasNameFields) return null;

  const generated = generateProductName(categoryName, attributes, schema, vehicleData);
  if (!generated) return null;
  if (generated === currentName) return null; // уже такое

  return generated;
}
