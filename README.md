# CrazyTrainAI

CrazyTrainAI is a full-stack subscription web application that allows customers to upload postcard designs and order printed postcards. The project demonstrates a modern TypeScript-first stack featuring a React 18 + Vite frontend, an Express backend powered by Drizzle ORM, and integrations with Google OAuth, Stripe, and Google Cloud Storage.

## Project Structure

```
/
├── client/        # React frontend (Vite + Tailwind CSS)
├── server/        # Express backend with Stripe, OAuth, and Drizzle
├── shared/        # Shared database schema and Zod validators
├── vite.config.ts # Vite configuration shared by dev + prod
└── package.json   # Single npm project (server + client)
```

## Getting Started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   Copy `.env.example` to `.env` files for the server and client (or export them in your shell). Required variables include:

   ```bash
   # Database
   DATABASE_URL=postgresql://...
   # Google OAuth
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   # Session
   SESSION_SECRET=...
   # Stripe
   STRIPE_SECRET_KEY=sk_test_...
   VITE_STRIPE_PUBLIC_KEY=pk_test_...
   # Object Storage
   DEFAULT_OBJECT_STORAGE_BUCKET_ID=your-bucket
   PUBLIC_OBJECT_SEARCH_PATHS=/objects/public
   PRIVATE_OBJECT_DIR=.private
   ```

3. **Run the development servers**

   ```bash
   npm run dev
   ```

   The command starts the Express API (port `5000`) and exposes the Vite dev server (port `5173`) with automatic proxying for API and file routes.

4. **Database migrations**

   Update the schema inside `shared/src/schema.ts` and push changes with:

   ```bash
   npm run db:push
   ```

## Deployment

The repository now builds and runs as a single Node.js project. On DigitalOcean App Platform (or any Node hosting provider) you can use the following settings:

- **Build command**: `npm run build`
- **Run command**: `npm start`

Both the Express API and the static React build are produced from the same commands, so no workspace or multi-build configuration is required.

## Key Features

- **Authentication** – Google OAuth 2.0 with Passport.js and PostgreSQL-backed sessions.
- **Subscriptions** – Stripe Billing API for $1/month recurring plans and customer portal integration.
- **Object Storage** – Google Cloud Storage signed uploads with ACL enforcement for public/private postcards.
- **Postcards Workflow** – Upload postcard designs, toggle visibility, and trigger paid print orders.
- **Type Safety** – Shared Zod schemas and TypeScript types across frontend and backend via a common package.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Starts the Express dev server with Vite middleware. |
| `npm run build` | Builds the React frontend and the Express backend bundles. |
| `npm run db:push` | Pushes the Drizzle schema to the connected PostgreSQL database. |
| `npm run db:studio` | Opens Drizzle Studio for inspecting the database. |

## Testing the Flow

1. Sign in with Google via the landing page.
2. Subscribe on `/subscribe` to activate postcard features.
3. Upload a postcard on `/postcards`, toggle visibility, and order prints.
4. Complete payment on `/postcard-checkout` and view confirmation on `/postcard-success`.

## License

This project is provided under the MIT license. See [LICENSE](./LICENSE) for details.
