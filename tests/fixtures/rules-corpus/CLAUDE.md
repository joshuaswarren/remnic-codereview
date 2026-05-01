# Remnic Project Rules

## Rule 1: Always use slice guard

When using `arr.slice(-n)`, always guard against `n === 0`. A zero value returns the entire array instead of the last N elements, which is almost never what you want.

```ts
const last3 = n > 0 ? arr.slice(-n) : [];
```

## Rule 2: Never delete before write

For atomic file replaces: write to a temp file, then rename. Never `rmSync` then `renameSync` — if the write fails, the original is gone.

```ts
writeFileSync(tmpPath, content);
renameSync(tmpPath, targetPath);
```

## Rule 3: Reject invalid CLI inputs explicitly

Unknown flag values MUST throw with a clear error message. Never silently default to a fallback value. This is critical for security-sensitive commands.

## Rule 4: Coerce boolean strings at config boundaries

The strings `"false"`, `"0"`, `"no"`, `"off"` must coerce to `false`. Use a shared `coerceBool()` helper for this.

## Rule 5: Validate JSON parse results

After `JSON.parse()`, always check `typeof result === "object" && result !== null` before property access. Never assume the parsed shape.

## Rule 6: Sort object keys before hashing

Dedup keys must be order-independent. Sort keys alphabetically before computing any content hash.

```ts
const sorted = Object.keys(obj).sort().map(k => `${k}=${obj[k]}`).join('&');
```
