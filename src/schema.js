// 도구 입력 스키마의 최소 검증기 (type, required, enum, properties, items)
export function validate(schema, value, path = '$') {
  const errs = [];
  const t = schema.type;
  const typeOk = {
    object: (v) => v && typeof v === 'object' && !Array.isArray(v),
    array: Array.isArray,
    string: (v) => typeof v === 'string',
    number: (v) => typeof v === 'number' && Number.isFinite(v),
    integer: Number.isInteger,
    boolean: (v) => typeof v === 'boolean',
  };
  if (t && !typeOk[t](value)) return [`${path}: ${t} 아님`];
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: 허용값 아님(${value})`);
  if (t === 'object') {
    for (const k of schema.required ?? []) if (value[k] === undefined) errs.push(`${path}.${k}: 없음`);
    for (const [k, s] of Object.entries(schema.properties ?? {}))
      if (value[k] !== undefined) errs.push(...validate(s, value[k], `${path}.${k}`));
  }
  if (t === 'array' && schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`)));
  return errs;
}
