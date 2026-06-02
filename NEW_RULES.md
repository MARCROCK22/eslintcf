# Reglas nuevas tras el upgrade (ESLint 10 + plugins)

Reglas **añadidas** en cada paquete entre la versión que el preset usaba y la actual.
Para cada una: para qué sirve, ejemplo y link a su doc (showcase).

Rangos comparados:
- `eslint` (core / `@eslint/js`): **9.17.0 → 10.4.1**
- `typescript-eslint`: **8.19.1 → 8.60.1**
- `eslint-plugin-perfectionist`: **4.6.0 → 5.9.0**
- `@stylistic/eslint-plugin`: **2.12.1 → 5.10.0**
- `eslint-plugin-unicorn`: **64.0.0 (sin cambios — 0 reglas nuevas)**

> **Activa** = ya entra por lo que el preset extiende hoy
> (`eslint.configs.recommended` + `recommendedTypeChecked` + `stylisticTypeChecked`).
> **Opt-in** = existe pero hay que habilitarla a mano.

---

## ESLint core (9.17.0 → 10.4.1)

### `no-unassigned-vars` — ✅ Activa (recommended en v10)
Prohíbe `let`/`var` que se leen pero nunca se asignan (siempre `undefined`, casi siempre un bug).

```js
// ❌
let error;
if (cond) doThing();
return error;        // siempre undefined

// ✅
let error = null;
if (cond) error = check();
return error;
```
🔗 https://eslint.org/docs/latest/rules/no-unassigned-vars

### `preserve-caught-error` — ✅ Activa (recommended en v10)
Al relanzar un error nuevo dentro de un `catch`, obliga a conservar el original vía `{ cause }`.

```js
// ❌ se pierde la causa original
try { await db.query(); }
catch (err) { throw new Error('fallo de BD'); }

// ✅
try { await db.query(); }
catch (err) { throw new Error('fallo de BD', { cause: err }); }
```
🔗 https://eslint.org/docs/latest/rules/preserve-caught-error

> Nota: `no-useless-assignment` **no es nueva** (ya existía), pero en v10 pasó a `recommended`.

---

## typescript-eslint (8.19.1 → 8.60.1)

> Ninguna de estas entra por `recommendedTypeChecked`/`stylisticTypeChecked`: son `strict-type-checked`
> o sin preset. Todas son **opt-in** con la config actual.

### `no-misused-spread` — opt-in (strict-type-checked)
Prohíbe usar spread donde el resultado casi seguro no es lo que se quiere (string, función, Promise…).

```ts
// ❌
const chars = [...'hola'];           // ['h','o','l','a'] ¿intencional?
const o = { ...miPromesa };          // spread de Promise: no copia el valor resuelto

// ✅
const chars = 'hola'.split('');
```
🔗 https://typescript-eslint.io/rules/no-misused-spread/

### `no-unnecessary-type-conversion` — opt-in (strict-type-checked)
Marca conversiones que no cambian el tipo ni el valor.

```ts
// ❌
const s = String(yaEsString);
const n = Number(yaEsNumero);
const b = Boolean(yaEsBool);
const t = `${yaEsString}`;

// ✅
const s = yaEsString;
```
🔗 https://typescript-eslint.io/rules/no-unnecessary-type-conversion/

### `no-useless-default-assignment` — opt-in (strict-type-checked)
Marca valores por defecto que nunca se usan porque la cosa nunca es `undefined`.

```ts
// ❌
declare const obj: { a: number };
const { a = 1 } = obj;   // obj.a siempre existe → el default 1 es código muerto

// ✅
const { a } = obj;
```
🔗 https://typescript-eslint.io/rules/no-useless-default-assignment/

### `no-unused-private-class-members` — opt-in (ningún preset)
Detecta campos/métodos privados (`#x`) de clase que nunca se usan.

```ts
// ❌
class Cache {
    #store = new Map();   // nunca se lee
}

// ✅
class Cache {
    #store = new Map();
    get(k: string) { return this.#store.get(k); }
}
```
🔗 https://typescript-eslint.io/rules/no-unused-private-class-members/

### `strict-void-return` — opt-in (ningún preset)
Prohíbe pasar una función que **retorna un valor** donde se espera una función `void`
(oculta promesas/efectos no manejados).

```ts
// ❌ el callback espera () => void, pero set.add(x) retorna el Set
items.forEach(x => set.add(x));
el.addEventListener('click', () => fetchData());  // Promise ignorada en silencio

// ✅
items.forEach(x => { set.add(x); });
el.addEventListener('click', () => { void fetchData(); });
```
🔗 https://typescript-eslint.io/rules/strict-void-return/

---

## eslint-plugin-perfectionist (4.6.0 → 5.9.0)

### `sort-import-attributes` — opt-in
Ordena los atributos del bloque `with { … }` de un `import`.

```ts
// ❌
import data from './x.json' with { type: 'json', integrity: 'sha384-…' };

// ✅ (ordenado)
import data from './x.json' with { integrity: 'sha384-…', type: 'json' };
```
🔗 https://perfectionist.dev/rules/sort-import-attributes

### `sort-export-attributes` — opt-in
Igual que la anterior pero para `export … from '…' with { … }`.

```ts
export { default } from './x.json' with { type: 'json' };
```
🔗 https://perfectionist.dev/rules/sort-export-attributes

### `sort-arrays` — opt-in
Ordena los elementos de arrays literales que cumplan la condición configurada
(generaliza `sort-array-includes` más allá de `.includes()`). Úsala con cuidado: el orden
de un array suele ser significativo, por eso se filtra por nombre/condición.

```ts
// con la regla activa sobre el array objetivo:
// ❌
const dias = ['lunes', 'miércoles', 'martes'];
// ✅
const dias = ['lunes', 'martes', 'miércoles'];
```
🔗 https://perfectionist.dev/rules/sort-arrays

---

## @stylistic/eslint-plugin (2.12.1 → 5.10.0)

> Ambas son **experimentales** → se usan con el prefijo `exp-` (`@stylistic/exp-list-style`).

### `exp-list-style` — opt-in (experimental)
Estilo consistente de saltos de línea dentro de brackets (objetos, arrays, imports/exports,
parámetros…): si el primer elemento va en su propia línea, todos; si no, todos en una sola.

```ts
// ❌ (mezcla)
const a = [1, 2,
    3];
// ✅
const a = [1, 2, 3];
// ✅
const a = [
    1,
    2,
    3,
];
```
🔗 https://eslint.style/rules/list-style

### `exp-jsx-props-style` — opt-in (experimental)
Lo mismo, pero para props de JSX (todas en una línea vs una por línea, con `min/maxItems`).

```jsx
// ❌
<Comp a="1" b="2"
  c="3" />
// ✅
<Comp a="1" b="2" c="3" />
```
🔗 https://eslint.style/rules/jsx-props-style

---

## eslint-plugin-unicorn (64.0.0)
Sin cambios de versión en este upgrade → **no hay reglas nuevas**.

---

## Apéndice — cambios de comportamiento que SÍ afectan al preset actual

No son reglas nuevas, pero el upgrade cambió su comportamiento:

- **`radix` (core, v10):** las opciones string `'always'`/`'as-needed'` quedaron **deprecadas** y la
  regla **siempre exige radix**. El preset usa `radix: ['error', 'as-needed']`, que ahora se comporta
  como `'always'` → marca todo `parseInt(x)` sin radix ("Missing radix parameter").
  🔗 https://eslint.org/docs/latest/rules/radix
- **`perfectionist` `newlinesBetween` (v5):** dejó de aceptar `'always'`/`'never'` (ahora numérico,
  default `1`). El preset no lo usa, así que no afecta.
- **`@stylistic` (v5):** se eliminaron los sub-namespaces `@stylistic/js|ts|jsx/*` y los sub-paquetes
  `eslint-plugin-{js,ts,jsx}`. Todo vive ahora en `@stylistic/*`. El preset ya usa el namespace plano.
- **`perfectionist`/`@stylistic` v4+:** **ESM-only** y Node ≥ 20 (cumplido: este proyecto es ESM, Node 22/26).
