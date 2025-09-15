import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger';

/**
 * SQL compatibility layer for translating PostgreSQL syntax to SQLite
 */
export class SQLCompatibilityLayer {
  /**
   * Translate PostgreSQL SQL to SQLite-compatible SQL
   */
  static translateSQL(sql: string): string {
    let translatedSQL = sql;

    // Only apply translations if the SQL contains PostgreSQL-specific syntax
    if (this.needsTranslation(sql)) {
      // 1. UUID type and generation
      translatedSQL = this.translateUUID(translatedSQL);

      // 2. JSONB to TEXT with JSON validation
      translatedSQL = this.translateJSONB(translatedSQL);

      // 3. Timestamp types
      translatedSQL = this.translateTimestamps(translatedSQL);

      // 4. Boolean type (SQLite uses INTEGER)
      translatedSQL = this.translateBoolean(translatedSQL);

      // 5. Array types to JSON
      translatedSQL = this.translateArrays(translatedSQL);

      // 6. PostgreSQL-specific functions
      translatedSQL = this.translateFunctions(translatedSQL);

      // 7. Full-text search (GIN indexes)
      translatedSQL = this.translateFullTextSearch(translatedSQL);

      // 8. Materialized views
      translatedSQL = this.translateMaterializedViews(translatedSQL);

      // 9. Triggers and functions
      translatedSQL = this.translateTriggersAndFunctions(translatedSQL);

      // 10. Check constraints
      translatedSQL = this.translateCheckConstraints(translatedSQL);

      // 11. ILIKE to LIKE with LOWER()
      translatedSQL = this.translateILike(translatedSQL);
    }

    return translatedSQL;
  }

  /**
   * Check if SQL needs translation (contains PostgreSQL-specific syntax)
   */
  private static needsTranslation(sql: string): boolean {
    const postgresKeywords = [
      'UUID', 'JSONB', 'BOOLEAN', 'TIMESTAMP WITH TIME ZONE', 'NOW()',
      'gen_random_uuid()', 'CONCAT(', 'ILIKE', 'MATERIALIZED VIEW',
      'GIN', 'to_tsvector', 'plainto_tsquery', 'CREATE OR REPLACE FUNCTION',
      'true', 'false'
    ];

    return postgresKeywords.some(keyword => 
      sql.toUpperCase().includes(keyword.toUpperCase())
    );
  }

  /**
   * Translate UUID types and generation
   */
  private static translateUUID(sql: string): string {
    // Replace UUID type with TEXT
    sql = sql.replace(/\bUUID\b/gi, 'TEXT');
    
    // Replace DEFAULT gen_random_uuid() - SQLite doesn't support function calls in DEFAULT
    // We'll remove the DEFAULT and handle UUID generation at the application level
    sql = sql.replace(/DEFAULT\s+gen_random_uuid\(\)/gi, '');
    
    // Replace standalone gen_random_uuid() calls with custom function
    sql = sql.replace(/gen_random_uuid\(\)/gi, 'sqlite_generate_uuid()');
    
    return sql;
  }

  /**
   * Translate JSONB to TEXT with JSON validation
   */
  private static translateJSONB(sql: string): string {
    // Handle JSONB casting and default values BEFORE replacing JSONB with TEXT
    // This prevents ::TEXT from being created
    
    // First handle the specific case: '{}'::jsonb
    sql = sql.replace(/'\{\}'::jsonb/gi, "'{}'");
    // Then handle general pattern: 'anything'::jsonb
    sql = sql.replace(/'([^']*)'::\s*jsonb/gi, "'$1'");
    // Handle without quotes: something::jsonb
    sql = sql.replace(/([^'\s]+)::\s*jsonb/gi, '$1');
    // Remove any remaining ::jsonb casts
    sql = sql.replace(/::\s*jsonb/gi, '');
    
    // Handle PostgreSQL JSON operators (SQLite uses JSON functions instead)
    // ->0->>'address' becomes JSON_EXTRACT(column, '$[0].address')
    sql = sql.replace(/(\w+)->(\d+)->>'(\w+)'/gi, "JSON_EXTRACT($1, '$[$2].$3')");
    // ->'key' becomes JSON_EXTRACT(column, '$.key')
    sql = sql.replace(/(\w+)->'(\w+)'/gi, "JSON_EXTRACT($1, '$.$2')");
    // ->>'key' becomes JSON_EXTRACT(column, '$.key')
    sql = sql.replace(/(\w+)->>'(\w+)'/gi, "JSON_EXTRACT($1, '$.$2')");
    
    // Handle other PostgreSQL casting
    sql = sql.replace(/::text/gi, '');
    
    // Now replace JSONB with TEXT
    sql = sql.replace(/\bJSONB\b/gi, 'TEXT');
    
    return sql;
  }

  /**
   * Translate timestamp types
   */
  private static translateTimestamps(sql: string): string {
    // Replace TIMESTAMP WITH TIME ZONE with DATETIME
    sql = sql.replace(/TIMESTAMP\s+WITH\s+TIME\s+ZONE/gi, 'DATETIME');
    
    // Replace NOW() with CURRENT_TIMESTAMP
    sql = sql.replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
    
    return sql;
  }

  /**
   * Translate boolean types
   */
  private static translateBoolean(sql: string): string {
    // SQLite doesn't have native BOOLEAN, uses INTEGER (0/1)
    sql = sql.replace(/\bBOOLEAN\b/gi, 'INTEGER');
    
    // Replace boolean literals
    sql = sql.replace(/\btrue\b/gi, '1');
    sql = sql.replace(/\bfalse\b/gi, '0');
    
    return sql;
  }

  /**
   * Translate array types to JSON
   */
  private static translateArrays(sql: string): string {
    // Replace array types with TEXT (will store as JSON)
    sql = sql.replace(/(\w+)\[\]/gi, 'TEXT');
    
    return sql;
  }

  /**
   * Translate PostgreSQL-specific functions
   */
  private static translateFunctions(sql: string): string {
    // Replace COALESCE (SQLite supports this, but ensure compatibility)
    // COALESCE is actually supported in SQLite, so no change needed
    
    // Replace CONCAT with || operator (handle multiple arguments)
    sql = sql.replace(/CONCAT\s*\(\s*([^)]+)\s*\)/gi, (match, args) => {
      const argList = args.split(',').map((arg: string) => arg.trim());
      return '(' + argList.join(' || ') + ')';
    });
    
    // Replace LEFT function with SUBSTR
    sql = sql.replace(/LEFT\s*\(\s*([^,]+),\s*(\d+)\s*\)/gi, 'SUBSTR($1, 1, $2)');
    
    // Replace DATE_TRUNC (this is complex, simplified version)
    sql = sql.replace(/DATE_TRUNC\s*\(\s*'day'\s*,\s*([^)]+)\s*\)/gi, 'DATE($1)');
    
    // Replace PostgreSQL interval syntax with SQLite datetime functions
    sql = sql.replace(/INTERVAL\s+'(\d+)\s+days?'/gi, "'$1 days'");
    sql = sql.replace(/INTERVAL\s+'(\d+)\s+hours?'/gi, "'$1 hours'");
    sql = sql.replace(/INTERVAL\s+'(\d+)\s+minutes?'/gi, "'$1 minutes'");
    
    // Replace PostgreSQL date arithmetic with SQLite datetime functions
    sql = sql.replace(/(\w+)\s*-\s*INTERVAL\s+'(\d+)\s+days?'/gi, "datetime($1, '-$2 days')");
    sql = sql.replace(/(\w+)\s*\+\s*INTERVAL\s+'(\d+)\s+days?'/gi, "datetime($1, '+$2 days')");
    
    // Handle simple interval expressions like NOW() - INTERVAL '30 days'
    sql = sql.replace(/NOW\(\)\s*-\s*'(\d+)\s+days?'/gi, "datetime('now', '-$1 days')");
    sql = sql.replace(/CURRENT_TIMESTAMP\s*-\s*'(\d+)\s+days?'/gi, "datetime('now', '-$1 days')");
    sql = sql.replace(/CURRENT_DATE\s*-\s*INTERVAL\s+'(\d+)\s+days?'/gi, "datetime('now', '-$1 days')");
    sql = sql.replace(/NOW\(\)\s*\+\s*INTERVAL\s+'(\d+)\s+days?'/gi, "datetime('now', '+$1 days')");
    sql = sql.replace(/CURRENT_TIMESTAMP\s*\+\s*INTERVAL\s+'(\d+)\s+days?'/gi, "datetime('now', '+$1 days')");
    
    return sql;
  }

  /**
   * Translate full-text search (GIN indexes not supported in SQLite)
   */
  private static translateFullTextSearch(sql: string): string {
    // Remove GIN indexes (SQLite uses FTS5 for full-text search)
    sql = sql.replace(/CREATE\s+INDEX[^;]*USING\s+GIN[^;]*;/gi, '-- Full-text search index removed (use FTS5 in SQLite)');
    
    // Replace to_tsvector and plainto_tsquery (would need FTS5 implementation)
    sql = sql.replace(/to_tsvector\s*\([^)]+\)/gi, '-- FTS search placeholder');
    sql = sql.replace(/plainto_tsquery\s*\([^)]+\)/gi, '-- FTS query placeholder');
    sql = sql.replace(/@@/gi, 'MATCH'); // This would need proper FTS5 syntax
    
    return sql;
  }

  /**
   * Translate materialized views (not supported in SQLite)
   */
  private static translateMaterializedViews(sql: string): string {
    // Replace MATERIALIZED VIEW with regular VIEW
    sql = sql.replace(/CREATE\s+MATERIALIZED\s+VIEW/gi, 'CREATE VIEW');
    
    // Replace CREATE OR REPLACE VIEW with CREATE VIEW (SQLite doesn't support OR REPLACE for views)
    sql = sql.replace(/CREATE\s+OR\s+REPLACE\s+VIEW/gi, 'CREATE VIEW IF NOT EXISTS');
    
    // Replace MATERIALIZED VIEW with regular VIEW and add IF NOT EXISTS
    sql = sql.replace(/CREATE\s+MATERIALIZED\s+VIEW\s+IF\s+NOT\s+EXISTS/gi, 'CREATE VIEW IF NOT EXISTS');
    sql = sql.replace(/CREATE\s+MATERIALIZED\s+VIEW/gi, 'CREATE VIEW IF NOT EXISTS');
    
    // Remove REFRESH MATERIALIZED VIEW statements
    sql = sql.replace(/REFRESH\s+MATERIALIZED\s+VIEW[^;]*;/gi, '-- Materialized view refresh not supported in SQLite');
    
    // Remove CONCURRENTLY keyword
    sql = sql.replace(/\bCONCURRENTLY\b/gi, '');
    
    return sql;
  }

  /**
   * Translate triggers and functions (PostgreSQL PL/pgSQL to SQLite)
   */
  private static translateTriggersAndFunctions(sql: string): string {
    // This is complex - for now, we'll comment out PostgreSQL functions
    // and provide SQLite alternatives where possible
    
    // Remove PostgreSQL function definitions
    sql = sql.replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION[^$]*\$[^$]*\$[^;]*;/gi, 
      '-- PostgreSQL function removed (needs SQLite equivalent)');
    
    // Remove language specifications
    sql = sql.replace(/\$\s*LANGUAGE\s+[^;]*;/gi, '');
    
    // Simplify trigger syntax
    sql = sql.replace(/FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION/gi, 'FOR EACH ROW WHEN');
    
    return sql;
  }

  /**
   * Translate CHECK constraints
   */
  private static translateCheckConstraints(sql: string): string {
    // SQLite supports CHECK constraints, but syntax might need adjustment
    // Most CHECK constraints should work as-is
    return sql;
  }

  /**
   * Translate ILIKE to case-insensitive LIKE
   */
  private static translateILike(sql: string): string {
    // Replace ILIKE with LIKE and wrap operands in LOWER()
    sql = sql.replace(/(\w+)\s+ILIKE\s+('[^']*')/gi, 'LOWER($1) LIKE LOWER($2)');
    
    return sql;
  }

  /**
   * Generate UUID for SQLite (since it doesn't have gen_random_uuid())
   */
  static generateUUID(): string {
    return uuidv4();
  }

  /**
   * Validate JSON string for SQLite JSONB replacement
   */
  static validateJSON(jsonString: string): boolean {
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert PostgreSQL array to JSON string for SQLite storage
   */
  static arrayToJSON(array: any[]): string {
    return JSON.stringify(array);
  }

  /**
   * Convert JSON string back to array for application use
   */
  static jsonToArray(jsonString: string): any[] {
    try {
      const parsed = JSON.parse(jsonString);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Create SQLite-specific custom functions
   */
  static registerSQLiteFunctions(db: any): void {
    try {
      // Register UUID generation function
      db.function('sqlite_generate_uuid', () => {
        return uuidv4();
      });

      // Register JSON validation function
      db.function('json_valid_check', (jsonString: string) => {
        return this.validateJSON(jsonString) ? 1 : 0;
      });

      logger.debug('SQLite custom functions registered');
    } catch (error) {
      logger.error('Failed to register SQLite custom functions', { error: (error as Error).message });
    }
  }

  /**
   * Handle parameter binding differences between PostgreSQL and SQLite
   */
  static translateParameters(sql: string, params: any[]): { sql: string; params: any[] } {
    // PostgreSQL uses $1, $2, etc. SQLite uses ? placeholders
    const translatedSQL = sql.replace(/\$\d+/g, '?');

    return {
      sql: translatedSQL,
      params: params
    };
  }

  /**
   * Enhanced migration-specific SQL translation
   */
  static translateMigrationSQL(sql: string): string {
    let translatedSQL = sql;

    // Apply all standard translations
    translatedSQL = this.translateSQL(translatedSQL);

    // Additional migration-specific translations
    translatedSQL = this.translateMigrationConstraints(translatedSQL);
    translatedSQL = this.translateMigrationIndexes(translatedSQL);
    translatedSQL = this.translateMigrationTriggers(translatedSQL);

    return translatedSQL;
  }

  /**
   * Translate migration-specific constraints
   */
  private static translateMigrationConstraints(sql: string): string {
    // Handle REFERENCES with ON DELETE/UPDATE actions
    // SQLite supports these, but ensure proper syntax
    
    // Handle UNIQUE constraints
    sql = sql.replace(/UNIQUE\s*\(\s*([^)]+)\s*\)/gi, 'UNIQUE($1)');
    
    return sql;
  }

  /**
   * Translate migration-specific indexes
   */
  private static translateMigrationIndexes(sql: string): string {
    // Remove IF NOT EXISTS from CREATE INDEX for compatibility
    // Actually, SQLite supports IF NOT EXISTS, so keep it
    
    // Handle partial indexes (WHERE clause)
    // SQLite supports partial indexes, so keep as-is
    
    // Remove CONCURRENTLY keyword from index creation
    sql = sql.replace(/CREATE\s+INDEX\s+CONCURRENTLY/gi, 'CREATE INDEX');
    
    // Remove indexes on views (SQLite doesn't support this)
    // Look for CREATE INDEX statements that reference views
    sql = sql.replace(/CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*ON\s+\w*(?:view|_view)\w*[^;]*;/gi, 
      '-- Index on view removed (SQLite does not support indexes on views)');
    
    // More general approach: remove indexes that would be created after materialized views
    // This is a heuristic - if we see a comment mentioning materialized view, remove the next index
    sql = sql.replace(/(--[^\\n]*materialized view[^\\n]*\\n)\\s*CREATE\\s+(?:UNIQUE\\s+)?INDEX[^;]*;/gi,
      '$1-- Index on materialized view removed (converted to regular view in SQLite)');
    
    return sql;
  }

  /**
   * Translate migration-specific triggers and functions
   */
  private static translateMigrationTriggers(sql: string): string {
    // Handle PostgreSQL function and trigger definitions
    // Be very specific to avoid removing other SQL statements
    
    // Pattern for complete function + trigger combinations
    const functionTriggerPattern = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(\w+)\s*\(\)\s*RETURNS\s+TRIGGER\s+AS\s+\$[^$]*\$[^$]*\$\s*language\s*'[^']*'\s*;\s*CREATE\s+TRIGGER\s+(\w+)[^;]*EXECUTE\s+FUNCTION\s+\1\s*\(\s*\)\s*;/gis;
    
    sql = sql.replace(functionTriggerPattern, (match, functionName, triggerName) => {
      // Extract table name from the trigger
      const tableMatch = match.match(/ON\s+(\w+)/i);
      const tableName = tableMatch ? tableMatch[1] : 'unknown_table';
      
      // Check if this is an update_updated_at pattern
      if (functionName.includes('updated_at')) {
        return `-- Converted PostgreSQL trigger to SQLite
CREATE TRIGGER IF NOT EXISTS ${triggerName}
    AFTER UPDATE ON ${tableName}
    FOR EACH ROW
BEGIN
    UPDATE ${tableName} SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;`;
      } else {
        return `-- PostgreSQL function and trigger removed: ${functionName}/${triggerName}`;
      }
    });

    // Remove complex PostgreSQL functions with DECLARE blocks and complex logic
    sql = sql.replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+[^$]*\$\s*DECLARE[^$]*\$[^$]*\$\s*LANGUAGE\s+plpgsql\s*;/gis,
      '-- Complex PostgreSQL function removed (not compatible with SQLite)');

    // Remove any remaining standalone function definitions (be more specific)
    sql = sql.replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+\w+\s*\([^)]*\)\s*RETURNS\s+[^$]*\$[^$]*\$\s*language\s*'?[^']*'?\s*;/gis, 
      '-- PostgreSQL function removed');

    // Remove any remaining standalone trigger definitions that reference functions
    sql = sql.replace(/CREATE\s+TRIGGER\s+\w+[^;]*EXECUTE\s+FUNCTION\s+\w+\s*\(\s*\)\s*;/gis,
      '-- PostgreSQL trigger removed');

    // Remove PostgreSQL-specific function calls and complex expressions
    sql = sql.replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+get_communication_timeline[^$]*\$[^$]*\$\s*LANGUAGE\s+plpgsql\s*;/gis,
      '-- PostgreSQL function get_communication_timeline removed (complex function not compatible with SQLite)');

    // Remove refresh materialized view functions
    sql = sql.replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+refresh_[^$]*\$[^$]*\$\s*LANGUAGE\s+plpgsql\s*;/gis,
      '-- PostgreSQL refresh function removed');

    return sql;
  }

  /**
   * Log translation warnings for unsupported features
   */
  static logTranslationWarnings(originalSQL: string, translatedSQL: string): void {
    const warnings: string[] = [];

    if (originalSQL.includes('MATERIALIZED VIEW')) {
      warnings.push('Materialized views converted to regular views - manual refresh needed');
    }

    if (originalSQL.includes('GIN')) {
      warnings.push('GIN indexes removed - consider implementing FTS5 for full-text search');
    }

    if (originalSQL.includes('FUNCTION') || originalSQL.includes('TRIGGER')) {
      warnings.push('PostgreSQL functions/triggers may need manual conversion');
    }

    if (originalSQL.includes('JSONB')) {
      warnings.push('JSONB converted to TEXT - JSON validation handled at application level');
    }

    if (warnings.length > 0) {
      logger.warn('SQL translation warnings', { warnings });
    }
  }
}