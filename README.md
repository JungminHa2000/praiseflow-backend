# PraiseFlow — Backend

AI-powered sheet music companion app for worship musicians. Upload a chord chart or lead sheet, and the AI analyses the music, generates instrument-specific improvisation suggestions, and creates note-by-note vocal harmonies.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express
- **Database**: PostgreSQL with Prisma ORM
- **AI**: Claude Vision API (Anthropic) for sheet music analysis and music generation
- **Image Processing**: Sharp for pre-processing uploaded sheet music photos

## Features

- JWT authentication (signup/login)
- File upload with automatic image enhancement for blurry photos
- Claude Vision API reads chord charts and lead sheets (English + Korean)
- Instrument-specific improv generation (keyboard, guitar, bass, etc.)
- Note-by-note vocal harmony generation aligned to song lyrics
- Intelligent melody recognition — warns users when AI cannot confidently generate vocal harmonies
- Share links with 30-day expiry for praise team collaboration
- 7-model PostgreSQL schema: User, Folder, Piece, Analysis, ImprovSuggestion, Annotation, ShareLink

## Setup

1. Install dependencies: `npm install`
2. Set up PostgreSQL and create a database called `praiseflow`
3. Copy `.env.example` to `.env` and fill in your database URL and Anthropic API key
4. Run database migrations: `npx prisma db push`
5. Generate Prisma client: `npx prisma generate`
6. Start the server: `npm run dev`

## API Endpoints

- `POST /api/auth/signup` — Create account
- `POST /api/auth/login` — Log in
- `POST /api/upload` — Upload sheet music (PDF/JPEG/PNG)
- `POST /api/analyse` — AI analysis of uploaded music
- `POST /api/improv` — Generate instrument improv or vocal harmony
- `GET /api/library` — Get user's folders and songs
- `POST /api/share` — Create shareable link
- `GET /api/share/:token` — View shared piece (no auth required)