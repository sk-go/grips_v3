import fs from 'fs';
import path from 'path';

describe('Migration SQL Syntax Validation', () => {
  const migrationDir = path.join(__dirname, '../../database/migrations');
  const migrationFiles = fs.readdirSync(migrationDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  describe('SQLite-specific syntax removal', () => {
    test.each(migrationFiles)('Migration %s should not contain SQLite-specific syntax', (migrationFile) => {
      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // Check for SQLite-specific syntax that should be removed
      const sqlitePatterns = [
        /AUTOINCREMENT/i,
        /INTEGER PRIMARY KEY/i,
        /PRAGMA\s+/i,
        /ATTACH\s+DATABASE/i,
        /DETACH\s+DATABASE/i,
        /\.backup/i,
        /\.restore/i,
        /SUBSTR\(/i, // Should use SUBSTRING in PostgreSQL
        /DATE\('now'/i, // Should use CURRENT_DATE or NOW()
        /DATETIME\('now'/i, // Should use NOW()
        /STRFTIME\(/i, // PostgreSQL uses different date functions
        /REPLACE\s*\(/i, // In context of INSERT OR REPLACE
        /INSERT\s+OR\s+REPLACE/i,
        /INSERT\s+OR\s+IGNORE/i,
        /ON\s+CONFLICT\s+IGNORE/i, // Should use ON CONFLICT DO NOTHING
      ];

      for (const pattern of sqlitePatterns) {
        expect(migrationSQL).not.toMatch(pattern);
      }
    });

    test.each(migrationFiles)('Migration %s should use PostgreSQL-compatible syntax', (migrationFile) => {
      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // Check for PostgreSQL-specific features that should be present
      const postgresqlFeatures = [
        /UUID/i, // Should use UUID type
        /JSONB/i, // Should use JSONB for JSON data
        /TIMESTAMP WITH TIME ZONE/i, // Should use timezone-aware timestamps
        /gen_random_uuid\(\)/i, // Should use PostgreSQL UUID generation
        /CURRENT_TIMESTAMP/i, // Should use standard SQL timestamp
        /NOW\(\)/i, // PostgreSQL timestamp function
      ];

      // At least some PostgreSQL features should be present
      const hasPostgreSQLFeatures = postgresqlFeatures.some(pattern => 
        pattern.test(migrationSQL)
      );

      expect(hasPostgreSQLFeatures).toBe(true);
    });
  });

  describe('PostgreSQL compatibility checks', () => {
    test.each(migrationFiles)('Migration %s should have valid PostgreSQL DDL structure', (migrationFile) => {
      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // Check for basic PostgreSQL DDL structure
      const validPatterns = [
        /CREATE\s+TABLE/i,
        /CREATE\s+INDEX/i,
        /CREATE\s+TRIGGER/i,
        /CREATE\s+FUNCTION/i,
        /CREATE\s+VIEW/i,
        /ALTER\s+TABLE/i,
      ];

      // Should contain at least one DDL statement
      const hasValidDDL = validPatterns.some(pattern => 
        pattern.test(migrationSQL)
      );

      expect(hasValidDDL).toBe(true);
    });

    test.each(migrationFiles)('Migration %s should use proper PostgreSQL function syntax', (migrationFile) => {
      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // If it contains functions, they should use PostgreSQL syntax
      if (migrationSQL.includes('CREATE FUNCTION') || migrationSQL.includes('CREATE OR REPLACE FUNCTION')) {
        // Should use $$ delimiter for function bodies
        expect(migrationSQL).toMatch(/\$[^$]*\$/);
        // Should specify language
        expect(migrationSQL).toMatch(/LANGUAGE\s+['"]?plpgsql['"]?/i);
      }
    });

    test.each(migrationFiles)('Migration %s should use proper PostgreSQL trigger syntax', (migrationFile) => {
      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // If it contains triggers, they should use PostgreSQL syntax
      if (migrationSQL.includes('CREATE TRIGGER')) {
        // Should use EXECUTE FUNCTION (PostgreSQL 11+) or EXECUTE PROCEDURE
        expect(migrationSQL).toMatch(/EXECUTE\s+(FUNCTION|PROCEDURE)/i);
      }
    });

    test.each(migrationFiles)('Migration %s should use proper PostgreSQL data types', (migrationFile) => {
      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // Check for proper PostgreSQL data types
      if (migrationSQL.includes('CREATE TABLE')) {
        // Should use VARCHAR instead of TEXT for limited strings
        // Should use TIMESTAMP WITH TIME ZONE for timestamps
        // Should use JSONB for JSON data
        // Should use UUID for identifiers

        // These are recommendations, not strict requirements
        // Just ensure no obviously wrong types are used
        expect(migrationSQL).not.toMatch(/DATETIME/i); // Should use TIMESTAMP
        expect(migrationSQL).not.toMatch(/TINYINT/i); // Should use SMALLINT or INTEGER
        expect(migrationSQL).not.toMatch(/LONGTEXT/i); // Should use TEXT
      }
    });
  });

  describe('Migration file structure', () => {
    test('should have sequential migration numbers', () => {
      const migrationNumbers = migrationFiles.map(file => {
        const match = file.match(/^(\d+)_/);
        return match ? parseInt(match[1]) : 0;
      }).sort((a, b) => a - b);

      // Check for gaps in sequence (allowing for some flexibility)
      for (let i = 1; i < migrationNumbers.length; i++) {
        const current = migrationNumbers[i];
        const previous = migrationNumbers[i - 1];
        
        // Allow gaps but ensure no duplicates
        expect(current).toBeGreaterThan(previous);
      }
    });

    test.each(migrationFiles)('Migration %s should have descriptive filename', (migrationFile) => {
      // Should follow pattern: NNN_descriptive_name.sql
      expect(migrationFile).toMatch(/^\d{3}_[a-z_]+\.sql$/);
    });

    test.each(migrationFiles)('Migration %s should be valid SQL file', (migrationFile) => {
      const migrationPath = path.join(migrationDir, migrationFile);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

      // Should not be empty
      expect(migrationSQL.trim()).not.toBe('');
      
      // Should not have obvious syntax errors
      expect(migrationSQL).not.toMatch(/;\s*;/); // Double semicolons
      expect(migrationSQL).not.toMatch(/CREATE\s+TABLE\s*;/i); // Incomplete CREATE TABLE
    });
  });

  describe('Schema consistency', () => {
    test('should have consistent table naming conventions', () => {
      const allMigrations = migrationFiles.map(file => {
        const migrationPath = path.join(migrationDir, file);
        return fs.readFileSync(migrationPath, 'utf8');
      }).join('\n');

      // Extract table names from CREATE TABLE statements
      const tableMatches = allMigrations.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi);
      if (tableMatches) {
        const tableNames = tableMatches.map(match => {
          const nameMatch = match.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
          return nameMatch ? nameMatch[1].toLowerCase() : '';
        }).filter(name => name);

        // Check naming conventions (snake_case)
        for (const tableName of tableNames) {
          expect(tableName).toMatch(/^[a-z][a-z0-9_]*$/);
          expect(tableName).not.toMatch(/[A-Z]/); // No camelCase
          expect(tableName).not.toMatch(/-/); // No kebab-case
        }
      }
    });

    test('should have consistent column naming conventions', () => {
      const allMigrations = migrationFiles.map(file => {
        const migrationPath = path.join(migrationDir, file);
        return fs.readFileSync(migrationPath, 'utf8');
      }).join('\n');

      // Extract common column patterns
      const commonColumns = [
        'id', 'created_at', 'updated_at', 'user_id', 'client_id',
        'email', 'name', 'is_active', 'is_read'
      ];

      for (const column of commonColumns) {
        if (allMigrations.includes(column)) {
          // Should be consistently named across all migrations
          expect(allMigrations).toMatch(new RegExp(`\\b${column}\\b`, 'g'));
        }
      }
    });
  });
});