# Utility Functions

Helper utilities for common operations.

## String Utilities

### capitalize(str: string)

Capitalizes the first letter of a string.

```javascript
capitalize('hello'); // 'Hello'
```

### slugify(str: string)

Converts a string to a URL-friendly slug.

```javascript
slugify('Hello World'); // 'hello-world'
```

## Array Utilities

### unique(arr: T[])

Returns an array with duplicate values removed.

```javascript
unique([1, 2, 2, 3]); // [1, 2, 3]
```

### chunk(arr: T[], size: number)

Splits an array into chunks of the specified size.

```javascript
chunk([1, 2, 3, 4, 5], 2); // [[1, 2], [3, 4], [5]]
```
