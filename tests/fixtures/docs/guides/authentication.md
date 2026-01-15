# Authentication Guide

This guide explains how to implement authentication in your application.

## Overview

Authentication is the process of verifying user identity. This library supports multiple authentication methods:

- **API Keys** - Simple token-based auth
- **OAuth 2.0** - Industry standard protocol
- **JWT** - JSON Web Tokens

## API Key Authentication

The simplest way to authenticate is using an API key:

```javascript
import { createClient } from 'test-package';

const client = createClient({
  apiKey: 'your-api-key-here'
});
```

### Generating API Keys

1. Go to your dashboard
2. Navigate to Settings > API Keys
3. Click "Generate New Key"
4. Copy and store the key securely

## OAuth 2.0 Flow

For user-facing applications, use OAuth 2.0:

```javascript
import { OAuth2Client } from 'test-package';

const oauth = new OAuth2Client({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  redirectUri: 'https://yourapp.com/callback'
});

// Start the auth flow
const authUrl = oauth.getAuthorizationUrl();
```

## Security Best Practices

1. **Never commit secrets** - Use environment variables
2. **Rotate keys regularly** - Set up key rotation
3. **Use HTTPS** - Always encrypt in transit
4. **Validate tokens** - Check expiration and signatures
