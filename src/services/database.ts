/**
 * Legacy database service - now exports the new abstracted DatabaseService
 * This maintains backward compatibility while routing through the new adapter system
 */

export { DatabaseService } from './database/DatabaseService';