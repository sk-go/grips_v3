# Requirements Document

## Introduction

This feature involves migrating the current dual-database architecture (SQLite + PostgreSQL/Supabase) to a Supabase-only architecture. The goal is to simplify the database layer by removing SQLite dependencies and standardizing on Supabase for all database operations, including development, testing, and production environments.

## Requirements

### Requirement 1

**User Story:** As a developer, I want to use only Supabase for all database operations, so that I can simplify the codebase and reduce maintenance overhead.

#### Acceptance Criteria

1. WHEN the application starts THEN the system SHALL connect only to Supabase database
2. WHEN running in development mode THEN the system SHALL use Supabase instead of SQLite
3. WHEN running tests THEN the system SHALL use Supabase test database instead of SQLite
4. WHEN deploying to production THEN the system SHALL use only Supabase without SQLite fallback

### Requirement 2

**User Story:** As a developer, I want all SQLite-related code removed from the codebase, so that the architecture is cleaner and easier to maintain.

#### Acceptance Criteria

1. WHEN reviewing the codebase THEN there SHALL be no SQLite adapter or SQLite-specific code
2. WHEN checking dependencies THEN there SHALL be no SQLite packages in package.json
3. WHEN examining database services THEN there SHALL be only PostgreSQL/Supabase adapters
4. WHEN looking at configuration files THEN there SHALL be no SQLite configuration options

### Requirement 3

**User Story:** As a developer, I want the database abstraction layer simplified, so that it only handles Supabase connections without adapter switching logic.

#### Acceptance Criteria

1. WHEN the DatabaseService initializes THEN it SHALL directly use PostgreSQL adapter without adapter selection logic
2. WHEN database operations are performed THEN they SHALL go directly through Supabase client
3. WHEN configuration is loaded THEN it SHALL only read Supabase connection parameters
4. WHEN errors occur THEN they SHALL be PostgreSQL/Supabase specific without SQLite error handling

### Requirement 4

**User Story:** As a developer, I want all existing data migration capabilities preserved, so that I can still manage database schema changes effectively.

#### Acceptance Criteria

1. WHEN running migrations THEN the system SHALL execute them against Supabase database
2. WHEN checking migration status THEN it SHALL track migrations in Supabase tables
3. WHEN rolling back migrations THEN it SHALL work with Supabase transaction handling
4. WHEN adding new migrations THEN they SHALL be PostgreSQL-compatible SQL only

### Requirement 5

**User Story:** As a developer, I want all tests to work with Supabase, so that I can maintain test coverage without SQLite dependencies.

#### Acceptance Criteria

1. WHEN running unit tests THEN they SHALL use Supabase test database
2. WHEN running integration tests THEN they SHALL connect to Supabase without SQLite fallback
3. WHEN setting up test data THEN it SHALL be created in Supabase tables
4. WHEN cleaning up after tests THEN it SHALL remove data from Supabase test database

### Requirement 6

**User Story:** As a developer, I want the development setup simplified, so that I only need to configure Supabase connection details.

#### Acceptance Criteria

1. WHEN setting up development environment THEN I SHALL only need Supabase credentials
2. WHEN starting the application locally THEN it SHALL connect to Supabase development database
3. WHEN checking environment variables THEN there SHALL be no SQLite-related configuration
4. WHEN reading documentation THEN it SHALL only reference Supabase setup procedures