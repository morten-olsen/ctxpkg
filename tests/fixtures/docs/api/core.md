# Core API Reference

This document describes the core API functions.

## Functions

### hello(name: string)

Prints a greeting message.

**Parameters:**
- `name` - The name to greet

**Returns:** void

**Example:**
```javascript
hello('Alice'); // prints "Hello, Alice!"
```

### goodbye(name: string)

Prints a farewell message.

**Parameters:**
- `name` - The name to say goodbye to

**Returns:** void

## Types

### Config

Configuration object for the library.

```typescript
interface Config {
  debug: boolean;
  timeout: number;
  retries: number;
}
```
