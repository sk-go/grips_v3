import { CacheService } from '../cacheService';
import { VectorSearchResult, SemanticSearchRequest } from '../../types/nlp';
import { logger } from '../../utils/logger';

export class VectorSearchService {
  private cacheService: CacheService;
  private vectorDimensions: number = 384; // Default embedding size
  private indexPrefix: string = 'vector:';

  constructor(cacheService: CacheService, vectorDimensions: number = 384) {
    this.cacheService = cacheService;
    this.vectorDimensions = vectorDimensions;
  }

  async indexDocument(
    id: string,
    content: string,
    embedding: number[],
    metadata: Record<string, any> = {}
  ): Promise<void> {
    try {
      if (embedding.length !== this.vectorDimensions) {
        throw new Error(`Embedding dimension mismatch. Expected ${this.vectorDimensions}, got ${embedding.length}`);
      }

      const document = {
        id,
        content,
        embedding,
        metadata: {
          ...metadata,
          indexed_at: new Date().toISOString(),
          content_length: content.length
        }
      };

      // Store the document
      await this.cacheService.set(
        `${this.indexPrefix}doc:${id}`,
        JSON.stringify(document),
        86400 // 24 hours TTL
      );

      // Add to search index
      await this.addToSearchIndex(id, document);

      logger.debug('Document indexed for vector search', { id, contentLength: content.length });

    } catch (error) {
      logger.error('Failed to index document', { error, id });
      throw error;
    }
  }

  async search(request: SemanticSearchRequest): Promise<VectorSearchResult[]> {
    try {
      const {
        query,
        limit = 10,
        threshold = 0.7,
        filters = {}
      } = request;

      // Get query embedding (this would typically come from the NLP service)
      const queryEmbedding = await this.getQueryEmbedding(query);

      // Get all indexed documents
      const documentIds = await this.getIndexedDocumentIds();
      
      const results: Array<VectorSearchResult & { similarity: number }> = [];

      // Calculate similarities
      for (const docId of documentIds) {
        try {
          const docData = await this.cacheService.get(`${this.indexPrefix}doc:${docId}`);
          if (!docData) continue;

          const document = JSON.parse(docData);
          
          // Apply filters
          if (!this.matchesFilters(document.metadata, filters)) {
            continue;
          }

          // Calculate cosine similarity
          const similarity = this.cosineSimilarity(queryEmbedding, document.embedding);
          
          if (similarity >= threshold) {
            results.push({
              id: document.id,
              content: document.content,
              score: similarity,
              metadata: document.metadata,
              similarity
            });
          }
        } catch (error) {
          logger.warn('Failed to process document in search', { error, docId });
        }
      }

      // Sort by similarity and limit results
      return results
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .map(({ similarity, ...result }) => result);

    } catch (error) {
      logger.error('Vector search failed', { error, query: request.query });
      return [];
    }
  }

  async findSimilarDocuments(
    documentId: string,
    limit: number = 5,
    threshold: number = 0.8
  ): Promise<VectorSearchResult[]> {
    try {
      const docData = await this.cacheService.get(`${this.indexPrefix}doc:${documentId}`);
      if (!docData) {
        throw new Error('Document not found');
      }

      const document = JSON.parse(docData);
      
      return await this.search({
        query: document.content,
        limit: limit + 1, // +1 to account for the document itself
        threshold
      }).then(results => 
        results.filter(result => result.id !== documentId).slice(0, limit)
      );

    } catch (error) {
      logger.error('Failed to find similar documents', { error, documentId });
      return [];
    }
  }

  async deleteDocument(id: string): Promise<void> {
    try {
      await this.cacheService.delete(`${this.indexPrefix}doc:${id}`);
      await this.removeFromSearchIndex(id);
      
      logger.debug('Document removed from vector search', { id });
    } catch (error) {
      logger.error('Failed to delete document from vector search', { error, id });
    }
  }

  async getDocumentCount(): Promise<number> {
    try {
      const documentIds = await this.getIndexedDocumentIds();
      return documentIds.length;
    } catch (error) {
      logger.error('Failed to get document count', error);
      return 0;
    }
  }

  private async getQueryEmbedding(query: string): Promise<number[]> {
    // This is a simple hash-based embedding for demonstration
    // In production, you'd use the same embedding service as the NLP engine
    const embedding = new Array(this.vectorDimensions).fill(0);
    const words = query.toLowerCase().split(/\s+/);
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      let hash = 0;
      
      for (let j = 0; j < word.length; j++) {
        const char = word.charCodeAt(j);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      
      const index = Math.abs(hash) % embedding.length;
      embedding[index] += 1 / words.length;
    }
    
    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }

  private cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      magnitudeA += vectorA[i] * vectorA[i];
      magnitudeB += vectorB[i] * vectorB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  private matchesFilters(metadata: Record<string, any>, filters: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(filters)) {
      if (metadata[key] !== value) {
        return false;
      }
    }
    return true;
  }

  private async addToSearchIndex(id: string, document: any): Promise<void> {
    try {
      // Add document ID to the search index
      const indexKey = `${this.indexPrefix}index`;
      const existingIndex = await this.cacheService.get(indexKey);
      
      let documentIds: string[] = [];
      if (existingIndex) {
        documentIds = JSON.parse(existingIndex);
      }
      
      if (!documentIds.includes(id)) {
        documentIds.push(id);
        await this.cacheService.set(indexKey, JSON.stringify(documentIds), 86400);
      }
    } catch (error) {
      logger.error('Failed to add document to search index', { error, id });
    }
  }

  private async removeFromSearchIndex(id: string): Promise<void> {
    try {
      const indexKey = `${this.indexPrefix}index`;
      const existingIndex = await this.cacheService.get(indexKey);
      
      if (existingIndex) {
        let documentIds: string[] = JSON.parse(existingIndex);
        documentIds = documentIds.filter(docId => docId !== id);
        await this.cacheService.set(indexKey, JSON.stringify(documentIds), 86400);
      }
    } catch (error) {
      logger.error('Failed to remove document from search index', { error, id });
    }
  }

  private async getIndexedDocumentIds(): Promise<string[]> {
    try {
      const indexKey = `${this.indexPrefix}index`;
      const indexData = await this.cacheService.get(indexKey);
      
      if (indexData) {
        return JSON.parse(indexData);
      }
      
      return [];
    } catch (error) {
      logger.error('Failed to get indexed document IDs', error);
      return [];
    }
  }

  async clearIndex(): Promise<void> {
    try {
      const documentIds = await this.getIndexedDocumentIds();
      
      // Delete all documents
      for (const id of documentIds) {
        await this.deleteDocument(id);
      }
      
      // Clear the index
      await this.cacheService.delete(`${this.indexPrefix}index`);
      
      logger.info('Vector search index cleared');
    } catch (error) {
      logger.error('Failed to clear vector search index', error);
    }
  }

  getIndexStats(): Promise<{ documentCount: number; indexSize: string }> {
    return this.getDocumentCount().then(count => ({
      documentCount: count,
      indexSize: `${count} documents`
    }));
  }
}