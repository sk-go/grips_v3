/**
 * Client Profile Services Export
 * Main entry point for client profile enhancement functionality
 */

export { ClientProfileService } from './clientProfileService';
export { RelationshipVisualizationService } from './relationshipVisualizationService';
export { CrmDataFetchingService } from './crmDataFetchingService';

export type {
  ClientProfileData,
  ClientRelationship,
  RelationshipGraphNode,
  RelationshipGraphEdge,
  RelationshipGraph
} from './clientProfileService';

export type {
  GraphNode,
  GraphLink,
  RelationshipGraphData,
  GraphLayoutConfig
} from './relationshipVisualizationService';

export type {
  CrmClientData,
  CrmSyncResult,
  CrmConnectionStatus
} from './crmDataFetchingService';