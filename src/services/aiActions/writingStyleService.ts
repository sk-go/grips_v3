import { 
  WritingStyleProfile, 
  StyleCharacteristics, 
  WritingExample 
} from '../../types/aiActions';
import { CacheService } from '../cacheService';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class WritingStyleService {
  private cacheService: CacheService;
  private styleProfiles: Map<string, WritingStyleProfile> = new Map();

  constructor(cacheService: CacheService) {
    this.cacheService = cacheService;
  }

  async analyzeWritingStyle(
    agentId: string, 
    examples: string[], 
    contexts: string[] = []
  ): Promise<WritingStyleProfile> {
    logger.info('Analyzing writing style', { 
      agentId, 
      exampleCount: examples.length 
    });

    // Extract characteristics from examples
    const characteristics = this.extractStyleCharacteristics(examples);
    
    // Create writing examples
    const writingExamples: WritingExample[] = examples.map((content, index) => ({
      id: uuidv4(),
      type: this.detectContentType(content),
      content,
      context: contexts[index] || 'unknown',
      timestamp: new Date(),
      confidence: this.calculateExampleConfidence(content)
    }));

    // Create or update style profile
    const profile: WritingStyleProfile = {
      agentId,
      name: `Agent ${agentId} Style Profile`,
      characteristics,
      examples: writingExamples,
      lastUpdated: new Date(),
      confidence: this.calculateOverallConfidence(characteristics, writingExamples)
    };

    // Store profile
    this.styleProfiles.set(agentId, profile);
    await this.cacheStyleProfile(profile);

    logger.info('Writing style profile created', {
      agentId,
      confidence: profile.confidence,
      tone: characteristics.tone,
      formality: characteristics.formality
    });

    return profile;
  }

  async getStyleProfile(agentId: string): Promise<WritingStyleProfile | null> {
    // Try memory first
    let profile = this.styleProfiles.get(agentId);
    
    if (!profile) {
      // Try cache
      try {
        const cached = await this.cacheService.get(`style_profile:${agentId}`);
        if (cached) {
          profile = JSON.parse(cached);
          if (profile) {
            this.styleProfiles.set(agentId, profile);
          }
        }
      } catch (error) {
        logger.error('Failed to get style profile from cache', { error, agentId });
      }
    }

    return profile || null;
  }

  async mimicWritingStyle(
    agentId: string, 
    content: string, 
    contentType: 'email' | 'note' | 'message' = 'email'
  ): Promise<string> {
    const profile = await this.getStyleProfile(agentId);
    
    if (!profile) {
      logger.warn('No style profile found for agent, using default style', { agentId });
      return this.applyDefaultStyle(content, contentType);
    }

    logger.debug('Mimicking writing style', {
      agentId,
      contentType,
      tone: profile.characteristics.tone,
      formality: profile.characteristics.formality
    });

    return this.applyStyleProfile(content, profile, contentType);
  }

  private extractStyleCharacteristics(examples: string[]): StyleCharacteristics {
    // Analyze tone
    const tone = this.analyzeTone(examples);
    
    // Analyze formality
    const formality = this.analyzeFormality(examples);
    
    // Analyze verbosity
    const verbosity = this.analyzeVerbosity(examples);
    
    // Analyze personal touch
    const personalTouch = this.analyzePersonalTouch(examples);
    
    // Analyze technical level
    const technicalLevel = this.analyzeTechnicalLevel(examples);
    
    // Extract common phrases
    const commonPhrases = this.extractCommonPhrases(examples);
    
    // Extract signature elements
    const signatureElements = this.extractSignatureElements(examples);
    
    // Analyze greeting and closing styles
    const greetingStyle = this.analyzeGreetingStyle(examples);
    const closingStyle = this.analyzeClosingStyle(examples);

    return {
      tone,
      formality,
      verbosity,
      personalTouch,
      technicalLevel,
      commonPhrases,
      signatureElements,
      greetingStyle,
      closingStyle
    };
  }

  private analyzeTone(examples: string[]): StyleCharacteristics['tone'] {
    const toneIndicators = {
      formal: ['please', 'kindly', 'respectfully', 'sincerely', 'regards'],
      casual: ['hey', 'hi there', 'thanks', 'cheers', 'talk soon'],
      friendly: ['hope', 'wonderful', 'great', 'excited', 'looking forward'],
      professional: ['regarding', 'pursuant', 'accordingly', 'furthermore', 'therefore'],
      empathetic: ['understand', 'appreciate', 'sorry', 'concern', 'support']
    };

    const scores = {
      formal: 0,
      casual: 0,
      friendly: 0,
      professional: 0,
      empathetic: 0
    };

    for (const example of examples) {
      const lowerExample = example.toLowerCase();
      
      for (const [tone, indicators] of Object.entries(toneIndicators)) {
        const matches = indicators.filter(indicator => 
          lowerExample.includes(indicator)
        ).length;
        scores[tone as keyof typeof scores] += matches;
      }
    }

    // Return the tone with the highest score
    const maxScore = Math.max(...Object.values(scores));
    const dominantTone = Object.entries(scores).find(([_, score]) => score === maxScore)?.[0];
    
    return (dominantTone as StyleCharacteristics['tone']) || 'professional';
  }

  private analyzeFormality(examples: string[]): number {
    let formalityScore = 0.5; // Start with neutral
    
    const formalIndicators = [
      'dear', 'sincerely', 'respectfully', 'pursuant', 'accordingly',
      'furthermore', 'therefore', 'kindly', 'please find attached'
    ];
    
    const informalIndicators = [
      'hey', 'hi', 'thanks', 'cheers', 'talk soon', 'catch up',
      'no worries', 'sounds good', 'let me know'
    ];

    for (const example of examples) {
      const lowerExample = example.toLowerCase();
      
      const formalMatches = formalIndicators.filter(indicator => 
        lowerExample.includes(indicator)
      ).length;
      
      const informalMatches = informalIndicators.filter(indicator => 
        lowerExample.includes(indicator)
      ).length;
      
      // Adjust formality score
      formalityScore += (formalMatches * 0.1) - (informalMatches * 0.1);
    }

    return Math.max(0, Math.min(1, formalityScore));
  }

  private analyzeVerbosity(examples: string[]): number {
    if (examples.length === 0) return 0.5;

    const totalWords = examples.reduce((sum, example) => {
      return sum + example.split(/\s+/).length;
    }, 0);

    const averageWords = totalWords / examples.length;
    
    // Normalize to 0-1 scale (assuming 50 words is average)
    return Math.min(1, averageWords / 100);
  }

  private analyzePersonalTouch(examples: string[]): number {
    const personalIndicators = [
      'hope you', 'how are you', 'i hope', 'personally', 'my experience',
      'i believe', 'in my opinion', 'i think', 'i feel', 'family', 'weekend'
    ];

    let personalScore = 0;
    
    for (const example of examples) {
      const lowerExample = example.toLowerCase();
      const matches = personalIndicators.filter(indicator => 
        lowerExample.includes(indicator)
      ).length;
      
      personalScore += matches;
    }

    // Normalize based on number of examples
    return Math.min(1, personalScore / (examples.length * 2));
  }

  private analyzeTechnicalLevel(examples: string[]): number {
    const technicalTerms = [
      'api', 'database', 'system', 'process', 'configuration', 'implementation',
      'integration', 'workflow', 'algorithm', 'protocol', 'framework', 'architecture'
    ];

    let technicalScore = 0;
    
    for (const example of examples) {
      const lowerExample = example.toLowerCase();
      const matches = technicalTerms.filter(term => 
        lowerExample.includes(term)
      ).length;
      
      technicalScore += matches;
    }

    // Normalize based on number of examples and total words
    const totalWords = examples.reduce((sum, example) => 
      sum + example.split(/\s+/).length, 0
    );
    
    return totalWords > 0 ? Math.min(1, technicalScore / (totalWords / 100)) : 0;
  }

  private extractCommonPhrases(examples: string[]): string[] {
    const phrases: Map<string, number> = new Map();
    
    for (const example of examples) {
      // Extract 2-4 word phrases
      const words = example.toLowerCase().split(/\s+/);
      
      for (let i = 0; i < words.length - 1; i++) {
        for (let len = 2; len <= Math.min(4, words.length - i); len++) {
          const phrase = words.slice(i, i + len).join(' ');
          
          // Skip very common words
          if (!this.isCommonPhrase(phrase)) {
            phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
          }
        }
      }
    }

    // Return phrases that appear more than once
    return Array.from(phrases.entries())
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase, _]) => phrase);
  }

  private isCommonPhrase(phrase: string): boolean {
    const commonPhrases = [
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'i am', 'you are', 'it is', 'we are', 'they are', 'this is', 'that is'
    ];
    
    return commonPhrases.includes(phrase) || phrase.length < 4;
  }

  private extractSignatureElements(examples: string[]): string[] {
    const signatures: string[] = [];
    
    for (const example of examples) {
      // Look for signature patterns at the end of messages
      const lines = example.split('\n');
      const lastLines = lines.slice(-3); // Last 3 lines
      
      for (const line of lastLines) {
        const trimmed = line.trim();
        
        // Skip empty lines and very short lines
        if (trimmed.length < 3 || trimmed.length > 50) continue;
        
        // Look for signature patterns
        if (this.isSignatureLine(trimmed)) {
          signatures.push(trimmed);
        }
      }
    }

    // Return unique signatures
    return [...new Set(signatures)];
  }

  private isSignatureLine(line: string): boolean {
    const signaturePatterns = [
      /^best regards?/i,
      /^sincerely/i,
      /^thank you/i,
      /^thanks/i,
      /^cheers/i,
      /^talk soon/i,
      /^have a great/i,
      /^\w+\s+\w+$/  // Two words (likely name)
    ];

    return signaturePatterns.some(pattern => pattern.test(line));
  }

  private analyzeGreetingStyle(examples: string[]): string {
    const greetings: Map<string, number> = new Map();
    
    for (const example of examples) {
      const lines = example.split('\n');
      const firstLine = lines[0]?.trim().toLowerCase();
      
      if (firstLine) {
        // Extract greeting patterns
        const greetingPatterns = [
          /^(hi|hello|hey|dear)/,
          /^good (morning|afternoon|evening)/,
          /^hope you/
        ];

        for (const pattern of greetingPatterns) {
          const match = firstLine.match(pattern);
          if (match) {
            const greeting = match[0];
            greetings.set(greeting, (greetings.get(greeting) || 0) + 1);
          }
        }
      }
    }

    // Return most common greeting
    const mostCommon = Array.from(greetings.entries())
      .sort((a, b) => b[1] - a[1])[0];
    
    return mostCommon?.[0] || 'Hi';
  }

  private analyzeClosingStyle(examples: string[]): string {
    const closings: Map<string, number> = new Map();
    
    for (const example of examples) {
      const lines = example.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const lastLines = lines.slice(-2); // Last 2 non-empty lines
      
      for (const line of lastLines) {
        const lowerLine = line.toLowerCase();
        
        const closingPatterns = [
          /^(best regards?|sincerely|thank you|thanks|cheers|talk soon)/
        ];

        for (const pattern of closingPatterns) {
          const match = lowerLine.match(pattern);
          if (match) {
            const closing = match[0];
            closings.set(closing, (closings.get(closing) || 0) + 1);
          }
        }
      }
    }

    // Return most common closing
    const mostCommon = Array.from(closings.entries())
      .sort((a, b) => b[1] - a[1])[0];
    
    return mostCommon?.[0] || 'Best regards';
  }

  private detectContentType(content: string): WritingExample['type'] {
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('subject:') || lowerContent.includes('dear') || lowerContent.includes('sincerely')) {
      return 'email';
    }
    
    if (content.length < 100) {
      return 'message';
    }
    
    return 'note';
  }

  private calculateExampleConfidence(content: string): number {
    let confidence = 0.5;
    
    // Longer content generally provides better style analysis
    const wordCount = content.split(/\s+/).length;
    confidence += Math.min(0.3, wordCount / 100);
    
    // Complete sentences increase confidence
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    confidence += Math.min(0.2, sentences.length / 10);
    
    return Math.min(1, confidence);
  }

  private calculateOverallConfidence(
    characteristics: StyleCharacteristics, 
    examples: WritingExample[]
  ): number {
    if (examples.length === 0) return 0;
    
    // Base confidence from number of examples
    let confidence = Math.min(0.8, examples.length / 10);
    
    // Average example confidence
    const avgExampleConfidence = examples.reduce((sum, ex) => sum + ex.confidence, 0) / examples.length;
    confidence += avgExampleConfidence * 0.2;
    
    return Math.min(1, confidence);
  }

  private applyStyleProfile(
    content: string, 
    profile: WritingStyleProfile, 
    contentType: 'email' | 'note' | 'message'
  ): string {
    let styledContent = content;
    const characteristics = profile.characteristics;

    // Apply greeting style for emails
    if (contentType === 'email' && !content.toLowerCase().startsWith('hi') && 
        !content.toLowerCase().startsWith('hello') && !content.toLowerCase().startsWith('dear')) {
      styledContent = `${characteristics.greetingStyle},\n\n${styledContent}`;
    }

    // Apply formality adjustments
    if (characteristics.formality > 0.7) {
      styledContent = this.makeFormal(styledContent);
    } else if (characteristics.formality < 0.3) {
      styledContent = this.makeCasual(styledContent);
    }

    // Apply personal touch
    if (characteristics.personalTouch > 0.6) {
      styledContent = this.addPersonalTouch(styledContent);
    }

    // Apply common phrases
    styledContent = this.incorporateCommonPhrases(styledContent, characteristics.commonPhrases);

    // Apply closing style for emails
    if (contentType === 'email' && !this.hasClosing(content)) {
      styledContent = `${styledContent}\n\n${characteristics.closingStyle}`;
    }

    return styledContent;
  }

  private makeFormal(content: string): string {
    return content
      .replace(/\bhi\b/gi, 'Dear')
      .replace(/\bthanks\b/gi, 'Thank you')
      .replace(/\bcan't\b/gi, 'cannot')
      .replace(/\bwon't\b/gi, 'will not')
      .replace(/\bdon't\b/gi, 'do not');
  }

  private makeCasual(content: string): string {
    return content
      .replace(/\bDear\b/g, 'Hi')
      .replace(/\bThank you\b/g, 'Thanks')
      .replace(/\bcannot\b/g, "can't")
      .replace(/\bwill not\b/g, "won't")
      .replace(/\bdo not\b/g, "don't");
  }

  private addPersonalTouch(content: string): string {
    const personalPhrases = [
      'I hope this finds you well.',
      'Hope you\'re having a great day!',
      'I hope everything is going well on your end.'
    ];

    const randomPhrase = personalPhrases[Math.floor(Math.random() * personalPhrases.length)];
    
    // Add personal touch at the beginning if not already present
    if (!content.toLowerCase().includes('hope')) {
      return `${randomPhrase}\n\n${content}`;
    }
    
    return content;
  }

  private incorporateCommonPhrases(content: string, commonPhrases: string[]): string {
    // This is a simplified implementation
    // In a real system, you'd use more sophisticated NLP to naturally incorporate phrases
    return content;
  }

  private hasClosing(content: string): boolean {
    const closingPatterns = [
      /best regards?/i,
      /sincerely/i,
      /thank you/i,
      /thanks/i,
      /cheers/i,
      /talk soon/i
    ];

    return closingPatterns.some(pattern => pattern.test(content));
  }

  private applyDefaultStyle(content: string, contentType: 'email' | 'note' | 'message'): string {
    if (contentType === 'email') {
      let styledContent = content;
      
      // Add greeting if missing
      if (!content.toLowerCase().startsWith('hi') && !content.toLowerCase().startsWith('hello')) {
        styledContent = `Hi,\n\n${styledContent}`;
      }
      
      // Add closing if missing
      if (!this.hasClosing(content)) {
        styledContent = `${styledContent}\n\nBest regards`;
      }
      
      return styledContent;
    }
    
    return content;
  }

  async updateStyleProfile(
    agentId: string, 
    newExamples: string[], 
    contexts: string[] = []
  ): Promise<WritingStyleProfile> {
    const existingProfile = await this.getStyleProfile(agentId);
    
    if (existingProfile) {
      // Merge with existing examples
      const allExamples = [
        ...existingProfile.examples.map(ex => ex.content),
        ...newExamples
      ];
      
      return this.analyzeWritingStyle(agentId, allExamples, contexts);
    } else {
      return this.analyzeWritingStyle(agentId, newExamples, contexts);
    }
  }

  private async cacheStyleProfile(profile: WritingStyleProfile): Promise<void> {
    try {
      await this.cacheService.set(
        `style_profile:${profile.agentId}`,
        JSON.stringify(profile),
        86400 * 7 // 7 days TTL
      );
    } catch (error) {
      logger.error('Failed to cache style profile', { error, agentId: profile.agentId });
    }
  }

  async getAllStyleProfiles(): Promise<WritingStyleProfile[]> {
    return Array.from(this.styleProfiles.values());
  }

  async deleteStyleProfile(agentId: string): Promise<void> {
    this.styleProfiles.delete(agentId);
    
    try {
      await this.cacheService.delete(`style_profile:${agentId}`);
    } catch (error) {
      logger.error('Failed to delete style profile from cache', { error, agentId });
    }
    
    logger.info('Style profile deleted', { agentId });
  }
}