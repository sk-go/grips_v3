/**
 * Tests for Sentiment Trend Chart Component
 */

import { SentimentTrendChart, SentimentTrendPoint } from '../../components/SentimentTrendChart';

describe('SentimentTrendChart', () => {
  let chart: SentimentTrendChart;

  beforeEach(() => {
    chart = new SentimentTrendChart();
  });

  describe('prepareChartData', () => {
    it('should convert sentiment trend points to chart data', () => {
      const dataPoints: SentimentTrendPoint[] = [
        {
          date: new Date('2024-01-01'),
          sentimentScore: 0.5,
          communicationCount: 3,
          averageResponseTime: 2.5
        },
        {
          date: new Date('2024-01-02'),
          sentimentScore: 0.7,
          communicationCount: 2,
          averageResponseTime: 1.8
        }
      ];

      const result = chart.prepareChartData(dataPoints);

      expect(result).toHaveLength(2);
      expect(result[0].y).toBe(0.5);
      expect(result[0].count).toBe(3);
      expect(result[0].responseTime).toBe(2.5);
      expect(result[1].y).toBe(0.7);
      expect(result[1].count).toBe(2);
      expect(result[1].responseTime).toBe(1.8);
    });

    it('should handle empty data points', () => {
      const result = chart.prepareChartData([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('generateSVGChart', () => {
    it('should generate SVG chart with data', () => {
      const dataPoints: SentimentTrendPoint[] = [
        {
          date: new Date('2024-01-01'),
          sentimentScore: 0.2,
          communicationCount: 3,
          averageResponseTime: 2.5
        },
        {
          date: new Date('2024-01-02'),
          sentimentScore: 0.7,
          communicationCount: 4,
          averageResponseTime: 1.2
        }
      ];

      const svg = chart.generateSVGChart(dataPoints);

      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('Sentiment Trend Over Time');
      expect(svg).toContain('<path'); // Trend line
      expect(svg).toContain('<circle'); // Data points
    });

    it('should generate empty chart when no data', () => {
      const svg = chart.generateSVGChart([]);

      expect(svg).toContain('<svg');
      expect(svg).toContain('No sentiment data available');
    });
  });

  describe('generateChartJSConfig', () => {
    it('should generate Chart.js configuration', () => {
      const dataPoints: SentimentTrendPoint[] = [
        {
          date: new Date('2024-01-01'),
          sentimentScore: 0.5,
          communicationCount: 3,
          averageResponseTime: 2.5
        }
      ];

      const config = chart.generateChartJSConfig(dataPoints);

      expect(config.type).toBe('line');
      expect(config.data.datasets).toHaveLength(1);
      expect(config.data.datasets[0].label).toBe('Sentiment Score');
      expect(config.data.datasets[0].data).toEqual([0.5]);
      expect(config.options.plugins.title.text).toBe('Sentiment Trend Over Time');
    });
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const config = chart.getConfig();

      expect(config.title).toBe('Sentiment Trend Over Time');
      expect(config.width).toBe(800);
      expect(config.height).toBe(400);
      expect(config.lineColor).toBe('#3b82f6');
    });

    it('should allow configuration updates', () => {
      chart.updateConfig({
        title: 'Custom Title',
        width: 600,
        lineColor: '#ff0000'
      });

      const config = chart.getConfig();

      expect(config.title).toBe('Custom Title');
      expect(config.width).toBe(600);
      expect(config.height).toBe(400); // Should keep default
      expect(config.lineColor).toBe('#ff0000');
    });
  });

  describe('color mapping', () => {
    it('should generate different colors for different sentiment scores', () => {
      const dataPoints: SentimentTrendPoint[] = [
        { date: new Date(), sentimentScore: 0.8, communicationCount: 1, averageResponseTime: 1 }, // Very positive
        { date: new Date(), sentimentScore: 0.3, communicationCount: 1, averageResponseTime: 1 }, // Positive
        { date: new Date(), sentimentScore: 0.0, communicationCount: 1, averageResponseTime: 1 }, // Neutral
        { date: new Date(), sentimentScore: -0.3, communicationCount: 1, averageResponseTime: 1 }, // Negative
        { date: new Date(), sentimentScore: -0.8, communicationCount: 1, averageResponseTime: 1 }  // Very negative
      ];

      const svg = chart.generateSVGChart(dataPoints);

      // Should contain different colors for different sentiment levels
      expect(svg).toContain('#10b981'); // Green for very positive
      expect(svg).toContain('#f59e0b'); // Yellow for neutral
      expect(svg).toContain('#ef4444'); // Red for very negative
    });
  });
});