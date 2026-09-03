# Real Estate CRM Backend (`real-estate-backend`)

A modular, standalone backend REST API for the Single-Tenant Real Estate CRM application featuring a bi-directional lead–property matching engine. Built with **NestJS**, **Prisma ORM**, and **PostgreSQL**.

---

## 🏛 Architecture & Standalone Repository

This backend is a **standalone git repository** that lives alongside the sibling frontend repository (`real-estate-frontend`) under a common root folder.

- **No Shared Code / Not a Monorepo**: Backend and frontend do not share code directly.
- **REST Communication**: Serves a versioned REST API (`/api/v1`) to the frontend over HTTP.
- **Single-Tenant**: Built specifically for one real estate business with one Admin and Agent team. No `organizationId` or multi-tenant scaffolding.
- **Default Port**: Runs on port `3001` (`http://localhost:3001/api/v1`).
- **CORS Enabled**: Configured in `main.ts` to accept HTTP requests from the frontend running on `http://localhost:3000` (configurable via `FRONTEND_URL`).

---

## 📁 Directory Structure

```text
real-estate-backend/
├── prisma/
│   └── schema.prisma                # Single-tenant PostgreSQL database models
├── src/
│   ├── auth/                        # JWT authentication, guards & roles
│   │   ├── decorators/              # @Roles(), @CurrentUser()
│   │   ├── dto/                     # LoginDto, RegisterDto
│   │   ├── guards/                  # JwtAuthGuard, RolesGuard
│   │   ├── strategies/              # JwtStrategy (Passport)
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── auth.module.ts
│   ├── common/                      # Shared filters & interceptors
│   │   ├── filters/                 # HttpExceptionFilter
│   │   └── interceptors/            # TransformInterceptor
│   ├── interactions/                # Lead activity & communication logs
│   │   ├── dto/
│   │   ├── interactions.controller.ts
│   │   ├── interactions.service.ts
│   │   └── interactions.module.ts
│   ├── leads/                       # Leads management & buyer preferences
│   │   ├── dto/                     # CreateLeadDto, UpdateLeadDto, LeadFilterDto
│   │   ├── leads.controller.ts
│   │   ├── leads.service.ts
│   │   └── leads.module.ts
│   ├── matches/                     # Bi-directional Matching Engine
│   │   ├── dto/                     # UpdateMatchStatusDto, MatchFilterDto
│   │   ├── matching-engine.service.ts # Isolated rule-based compatibility scoring
│   │   ├── matches.controller.ts
│   │   ├── matches.service.ts
│   │   └── matches.module.ts
│   ├── prisma/                      # Database connection lifecycle
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── properties/                  # Properties inventory & specifications
│   │   ├── dto/                     # CreatePropertyDto, UpdatePropertyDto
│   │   ├── properties.controller.ts
│   │   ├── properties.service.ts
│   │   └── properties.module.ts
│   ├── users/                       # User management & Agent assignments
│   │   ├── dto/                     # CreateUserDto, UpdateUserDto
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   └── users.module.ts
│   ├── app.module.ts                # Root NestJS module
│   └── main.ts                      # Application bootstrap, CORS & validation pipes
├── .env.example                     # Environment template (PORT, CORS, DB, JWT)
├── .eslintrc.js                     # ESLint configuration
├── .prettierrc                      # Prettier configuration
├── nest-cli.json                    # NestJS CLI configuration
├── package.json                     # Dependencies & scripts
├── tsconfig.json                    # TypeScript compiler configuration
├── tsconfig.build.json              # Build TypeScript configuration
└── README.md                        # Project documentation
```

---

## ⚙️ Environment Configuration

Create your `.env` file from `.env.example`:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | HTTP Server port | `3001` |
| `FRONTEND_URL` | Allowed CORS origin (Frontend dev server) | `http://localhost:3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/real_estate_crm?schema=public` |
| `JWT_SECRET` | Secret key for JWT signing | `super_secret_jwt_key_single_tenant_dev_change_in_prod` |
| `JWT_EXPIRES_IN`| JWT expiration duration | `7d` |

---

## 🌐 CORS & Frontend Connectivity

The backend explicitly enables CORS in `src/main.ts` for the frontend URL:

```typescript
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
app.enableCors({
  origin: [allowedOrigin, 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
});
```

When the frontend running at `http://localhost:3000` makes requests with `Authorization: Bearer <token>`, CORS preflights and headers are handled automatically.

---

## 🧮 Matching Engine Rules

The matching engine logic is isolated inside `src/matches/matching-engine.service.ts` with configurable scoring weights:

| Criterion | Scoring Rule | Max Points |
| :--- | :--- | :--- |
| **Budget Overlap** | Full match within budget range = +35; Partial match (within 10% tolerance) = +20 | **35** |
| **Location Match** | Exact match or substring overlap in preferred locations | **25** |
| **Property Type** | Matching type (Apartment, Villa, Plot, Commercial, etc.) | **20** |
| **BHK / Configuration**| Matching bedroom configuration | **10** |
| **Possession Timeline**| Ready-to-move vs immediate, or matching timeline | **10** |
| **Total** | Normalized Score (0 – 100%) | **100** |

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Start PostgreSQL Container (Docker)

```bash
docker compose up -d
```

### 3. Database Migration

```bash
# Generate Prisma Client
npx prisma generate

# Run migrations against local PostgreSQL
npx prisma migrate dev --name init
```

### 3. Run Development Server

```bash
npm run start:dev
```

The API will be available at [http://localhost:3001/api/v1](http://localhost:3001/api/v1).

### 4. Tooling Scripts

- **Build**: `npm run build`
- **Format**: `npm run format`
- **Lint**: `npm run lint`
- **Prisma Studio**: `npx prisma studio`
