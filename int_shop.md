---
title: Get API access tokens for Dev Dashboard apps
description: >-
  Learn how to authenticate your Dev Dashboard app and get access tokens for API
  requests.
source_url:
  html: >-
    https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens?lang=node
  md: >-
    https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens.md?lang=node
---

# Get API access tokens for Dev Dashboard apps

If you've created and installed your app, you're ready to authenticate and start making API requests. This tutorial demonstrates how to use the client credentials grant—the simplest authentication option for merchants building apps for their store.

With a client credentials grant, you won't see a token in the Shopify admin. Instead, you request tokens programmatically when you need them.

**Info:**

If you're building apps for other merchants, use [Shopify CLI](https://shopify.dev/docs/apps/build/scaffold-app), which handles authentication automatically.

## What you'll learn

In this tutorial, you'll learn how to do the following tasks:

* Find your app credentials in the Dev Dashboard
* Exchange credentials for an access token programmatically
* Use the access token to call Shopify APIs

## Requirements

[Dev Dashboard app](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard)

You've created an app in the Dev Dashboard.

[Installed app](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard#install-your-app)

You've installed your app on your store.

## Project

[View on GitHub](https://github.com/Shopify/example-auth--client-credentials-grant--node)

## Get your credentials

Find your **Client ID** and **Client secret** in the Dev Dashboard. These credentials identify your app when requesting access tokens.

**Caution:**

Keep your Client secret secure. Store credentials in a `.env` file and add it to your `.gitignore`. Never commit secrets to version control.

### Locate your credentials

1. Open your app in the [Dev Dashboard](https://dev.shopify.com/dashboard/).
2. Go to **Settings**.
3. Copy your **Client ID** and **Client secret**.

![Dev Dashboard settings page showing the Client ID and Secret fields.](https://shopify.dev/assets/assets/images/apps/dev-dashboard/app-settings-BERWjF61.png)

[About the Dev Dashboard](https://shopify.dev/docs/apps/build/dev-dashboard)

## Create a `.env` file

Store your credentials in a `.env` file to keep secrets out of your code and make it easy to use different credentials per environment.

### Add your credentials

The example code on the right reads credentials from environment variables. Create a `.env` file in your project root so the code can load your values:

```bash
SHOPIFY_SHOP=your-store
SHOPIFY_CLIENT_ID=your-client-id
SHOPIFY_CLIENT_SECRET=your-client-secret
```

## /node/index.js

```javascript
import { URLSearchParams } from 'node:url';


const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;


if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    'Set SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET.'
  );
}


let token = null;
let tokenExpiresAt = 0;


async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;


  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  );


  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);


  const { access_token, expires_in } = await response.json();
  token = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return token;
}


async function graphql(query, variables = {}) {
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': await getToken(),
      },
      body: JSON.stringify({ query, variables }),
    }
  );


  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }


  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
  }
  return data;
}


async function main() {
  const query =
    '{ products(first: 3) { edges { node { id title handle } } } }';
  const data = await graphql(query);
  console.log('Products:', JSON.stringify(data, null, 2));
}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Request an access token

Use your credentials to make a programmatic request to Shopify's token endpoint. You won't copy a token from a browser page. Instead, your code requests a token when it needs it.

### Exchange credentials for a token

The code loads your credentials from the `.env` file and exchanges them for an access token. The token is cached and automatically refreshed before it expires.

***

Token response format

```json
{
  "access_token": "f85632530bf277ec9ac6f649fc327f17",
  "scope": "read_products",
  "expires_in": 86399
}
```

* `access_token` — The token to include in API requests. Store this securely.
* `scope` — The [access scopes](https://shopify.dev/docs/api/usage/access-scopes) granted to your app.
* `expires_in` — Seconds until expiration. Always 86399 (24 hours).

***

**Troubleshooting**

`shop_not_permitted` error

**Problem:** You receive the error `Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.`

**Solution:** The client credentials grant only works when the app and the store belong to the same Shopify organization. "Same organization" means both appear under the same org in the Dev Dashboard. Owning a store or having it installed doesn't automatically place it in your org.

To verify:

1. Open the [Dev Dashboard](https://dev.shopify.com/dashboard/) and click **Apps**. Confirm your app is listed.
2. Click **Dev stores** in the sidebar and confirm your target store appears in the list. If the store isn't listed, it's not in this organization.
3. Check that the `SHOPIFY_SHOP` value in your `.env` file matches the store's `*.myshopify.com` subdomain exactly (without `.myshopify.com`).

Common causes:

* **Dev store created outside the Dev Dashboard:** If you created a development store from the Shopify admin rather than from the Dev Dashboard, it won't be in your org. Create a new dev store from the **Dev stores** page in the Dev Dashboard instead.
* **Multiple organizations:** If you have access to more than one organization, the app and store might be in different ones. Check the organization ID in the URL (`dev.shopify.com/dashboard/<org-id>`) and verify both the app and store are under the same one.
* **Building for other merchants:** If you're building an app for other merchants to install, client credentials won't work. Use [Shopify CLI](https://shopify.dev/docs/apps/build/cli-for-apps) instead, which handles OAuth authentication automatically.

External tool asks you to "copy a token"

**Problem:** Some external tools ask you to copy a token or provide a "Shopify API key." These tools expect the older authentication flow.

**Solution:** Contact the tool vendor about updating their integration to use OAuth.

"Invalid API key or access token" error

**Problem:** You're sending your `client_id` or `client_secret` directly to the GraphQL Admin API.

**Solution:** First exchange your credentials for an `access_token` using the token endpoint, then use that token in your API requests.

## /node/index.js

```javascript
import { URLSearchParams } from 'node:url';


const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;


if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    'Set SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET.'
  );
}


let token = null;
let tokenExpiresAt = 0;


async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;


  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  );


  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);


  const { access_token, expires_in } = await response.json();
  token = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return token;
}


async function graphql(query, variables = {}) {
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': await getToken(),
      },
      body: JSON.stringify({ query, variables }),
    }
  );


  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }


  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
  }
  return data;
}


async function main() {
  const query =
    '{ products(first: 3) { edges { node { id title handle } } } }';
  const data = await graphql(query);
  console.log('Products:', JSON.stringify(data, null, 2));
}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Make API requests

Include the `access_token` in the `X-Shopify-Access-Token` header when calling Shopify APIs.

### Query the Graph​QL Admin API

Use the access token to authenticate requests to any Shopify API. This example queries products using the GraphQL Admin API.

***

Access tokens expire after 24 hours. The example code caches the token and automatically refreshes it before expiration—you don't need to manage this manually.

[Graph​QL Admin API](https://shopify.dev/docs/api/admin-graphql) [Access scopes](https://shopify.dev/docs/api/usage/access-scopes)

## /node/index.js

```javascript
import { URLSearchParams } from 'node:url';


const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;


if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    'Set SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET.'
  );
}


let token = null;
let tokenExpiresAt = 0;


async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;


  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  );


  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);


  const { access_token, expires_in } = await response.json();
  token = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return token;
}


async function graphql(query, variables = {}) {
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': await getToken(),
      },
      body: JSON.stringify({ query, variables }),
    }
  );


  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }


  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
  }
  return data;
}


async function main() {
  const query =
    '{ products(first: 3) { edges { node { id title handle } } } }';
  const data = await graphql(query);
  console.log('Products:', JSON.stringify(data, null, 2));
}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## /node/index.js

```javascript
import { URLSearchParams } from 'node:url';


const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;


if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    'Set SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET.'
  );
}


let token = null;
let tokenExpiresAt = 0;


async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 60_000) return token;


  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  );


  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);


  const { access_token, expires_in } = await response.json();
  token = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return token;
}


async function graphql(query, variables = {}) {
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2025-01/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': await getToken(),
      },
      body: JSON.stringify({ query, variables }),
    }
  );


  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }


  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
  }
  return data;
}


async function main() {
  const query =
    '{ products(first: 3) { edges { node { id title handle } } } }';
  const data = await graphql(query);
  console.log('Products:', JSON.stringify(data, null, 2));
}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

## Tutorial complete!

You've successfully authenticated your Dev Dashboard app using the client credentials grant and made API requests.

### Next steps

[GraphQL Admin API\
\
](https://shopify.dev/docs/api/admin-graphql)

[Start building with the GraphQL Admin API.](https://shopify.dev/docs/api/admin-graphql)

[Monitor app performance\
\
](https://shopify.dev/docs/apps/build/dev-dashboard/monitoring-and-logs)

[Access logs and metrics to understand and optimize your app's performance.](https://shopify.dev/docs/apps/build/dev-dashboard/monitoring-and-logs)