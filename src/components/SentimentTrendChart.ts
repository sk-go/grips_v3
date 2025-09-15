/**
 * Sentiment Trend Visualization Component
 * Generates line chart data for sentiment trends over time
 */

export interface SentimentTrendPoint {
  date: Date;
  sentimentScore: number;
  communicationCount: number;
  averageResponseTime: number;
}

export interface ChartDataPoint {
  x: string; // Date string
  y: number; // Sentiment score
  count: number; // Communication count
  responseTime: number; // Average response time
}

export interface LineChartConfig {
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  lineColor: string;
  backgroundColor: string;
  gridColor: string;
  width: number;
  height: number;
}

export class SentimentTrendChart {
  private config: LineChartConfig;

  constructor(config: Partial<LineChartConfig> = {}) {
    this.config = {
      title: 'Sentiment Trend Over Time',
      xAxisLabel: 'Date',
      yAxisLabel: 'Sentiment Score',
      lineColor: '#3b82f6',
      backgroundColor: '#ffffff',
      gridColor: '#e5e7eb',
      width: 800,
      height: 400,
      ...config
    };
  }

  /**
   * Convert sentiment trend data to chart-ready format
   */
  prepareChartData(dataPoints: SentimentTrendPoint[]): ChartDataPoint[] {
    return dataPoints.map(point => ({
      x: this.formatDate(point.date),
      y: point.sentimentScore,
      count: point.communicationCount,
      responseTime: point.averageResponseTime
    }));
  }

  /**
   * Generate SVG line chart
   */
  generateSVGChart(dataPoints: SentimentTrendPoint[]): string {
    if (dataPoints.length === 0) {
      return this.generateEmptyChart();
    }

    const chartData = this.prepareChartData(dataPoints);
    const { width, height } = this.config;
    const margin = { top: 40, right: 40, bottom: 60, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Calculate scales
    const minSentiment = Math.min(...chartData.map(d => d.y));
    const maxSentiment = Math.max(...chartData.map(d => d.y));
    const sentimentRange = maxSentiment - minSentiment || 1;

    // Generate path data
    const pathData = chartData.map((point, index) => {
      const x = (index / (chartData.length - 1)) * chartWidth;
      const y = chartHeight - ((point.y - minSentiment) / sentimentRange) * chartHeight;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    // Generate grid lines
    const gridLines = this.generateGridLines(chartWidth, chartHeight, minSentiment, maxSentiment);

    // Generate data points
    const dataPointsCircles = chartData.map((point, index) => {
      const x = (index / (chartData.length - 1)) * chartWidth;
      const y = chartHeight - ((point.y - minSentiment) / sentimentRange) * chartHeight;
      const color = this.getSentimentColor(point.y);
      
      return `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#ffffff" stroke-width="2">
        <title>Date: ${point.x}
Sentiment: ${point.y.toFixed(2)}
Communications: ${point.count}
Avg Response Time: ${point.responseTime.toFixed(1)}h</title>
      </circle>`;
    }).join('');

    // Generate axis labels
    const xAxisLabels = this.generateXAxisLabels(chartData, chartWidth);
    const yAxisLabels = this.generateYAxisLabels(minSentiment, maxSentiment, chartHeight);

    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="${this.config.backgroundColor}"/>
        
        <!-- Chart area -->
        <g transform="translate(${margin.left}, ${margin.top})">
          <!-- Grid lines -->
          ${gridLines}
          
          <!-- Trend line -->
          <path d="${pathData}" fill="none" stroke="${this.config.lineColor}" stroke-width="2"/>
          
          <!-- Data points -->
          ${dataPointsCircles}
          
          <!-- X-axis -->
          <line x1="0" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" stroke="#374151" stroke-width="1"/>
          
          <!-- Y-axis -->
          <line x1="0" y1="0" x2="0" y2="${chartHeight}" stroke="#374151" stroke-width="1"/>
          
          <!-- Axis labels -->
          ${xAxisLabels}
          ${yAxisLabels}
        </g>
        
        <!-- Title -->
        <text x="${width / 2}" y="25" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#1f2937">
          ${this.config.title}
        </text>
        
        <!-- X-axis label -->
        <text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#6b7280">
          ${this.config.xAxisLabel}
        </text>
        
        <!-- Y-axis label -->
        <text x="15" y="${height / 2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#6b7280" transform="rotate(-90, 15, ${height / 2})">
          ${this.config.yAxisLabel}
        </text>
      </svg>
    `;
  }

  /**
   * Generate Chart.js configuration
   */
  generateChartJSConfig(dataPoints: SentimentTrendPoint[]): any {
    const chartData = this.prepareChartData(dataPoints);

    return {
      type: 'line',
      data: {
        labels: chartData.map(d => d.x),
        datasets: [{
          label: 'Sentiment Score',
          data: chartData.map(d => d.y),
          borderColor: this.config.lineColor,
          backgroundColor: this.config.lineColor + '20',
          borderWidth: 2,
          pointBackgroundColor: chartData.map(d => this.getSentimentColor(d.y)),
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: this.config.title,
            font: {
              size: 16,
              weight: 'bold'
            }
          },
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              afterLabel: (context: any) => {
                const dataIndex = context.dataIndex;
                const point = chartData[dataIndex];
                return [
                  `Communications: ${point.count}`,
                  `Avg Response Time: ${point.responseTime.toFixed(1)}h`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: this.config.xAxisLabel
            },
            grid: {
              color: this.config.gridColor
            }
          },
          y: {
            title: {
              display: true,
              text: this.config.yAxisLabel
            },
            grid: {
              color: this.config.gridColor
            },
            min: -1,
            max: 1
          }
        }
      }
    };
  }

  /**
   * Generate empty chart placeholder
   */
  private generateEmptyChart(): string {
    const { width, height } = this.config;
    
    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="${this.config.backgroundColor}"/>
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="#6b7280">
          No sentiment data available
        </text>
      </svg>
    `;
  }

  /**
   * Get color based on sentiment score
   */
  private getSentimentColor(score: number): string {
    if (score > 0.6) return '#10b981'; // Green - very positive
    if (score > 0.2) return '#84cc16'; // Light green - positive
    if (score > -0.2) return '#f59e0b'; // Yellow - neutral
    if (score > -0.6) return '#f97316'; // Orange - negative
    return '#ef4444'; // Red - very negative
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Generate grid lines
   */
  private generateGridLines(chartWidth: number, chartHeight: number, minSentiment: number, maxSentiment: number): string {
    const gridLines: string[] = [];
    
    // Horizontal grid lines (sentiment levels)
    const sentimentLevels = [-1, -0.5, 0, 0.5, 1];
    sentimentLevels.forEach(level => {
      if (level >= minSentiment && level <= maxSentiment) {
        const y = chartHeight - ((level - minSentiment) / (maxSentiment - minSentiment)) * chartHeight;
        gridLines.push(`<line x1="0" y1="${y}" x2="${chartWidth}" y2="${y}" stroke="${this.config.gridColor}" stroke-width="1" stroke-dasharray="2,2"/>`);
      }
    });

    return gridLines.join('');
  }

  /**
   * Generate X-axis labels
   */
  private generateXAxisLabels(chartData: ChartDataPoint[], chartWidth: number): string {
    const maxLabels = 6;
    const step = Math.max(1, Math.floor(chartData.length / maxLabels));
    
    return chartData
      .filter((_, index) => index % step === 0)
      .map((point, index) => {
        const x = (index * step / (chartData.length - 1)) * chartWidth;
        return `<text x="${x}" y="${chartWidth + 20}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#6b7280">
          ${point.x}
        </text>`;
      })
      .join('');
  }

  /**
   * Generate Y-axis labels
   */
  private generateYAxisLabels(minSentiment: number, maxSentiment: number, chartHeight: number): string {
    const levels = [-1, -0.5, 0, 0.5, 1];
    
    return levels
      .filter(level => level >= minSentiment && level <= maxSentiment)
      .map(level => {
        const y = chartHeight - ((level - minSentiment) / (maxSentiment - minSentiment)) * chartHeight;
        return `<text x="-10" y="${y + 4}" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="#6b7280">
          ${level.toFixed(1)}
        </text>`;
      })
      .join('');
  }

  /**
   * Update chart configuration
   */
  updateConfig(newConfig: Partial<LineChartConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): LineChartConfig {
    return { ...this.config };
  }
}