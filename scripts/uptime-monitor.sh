#!/bin/bash

# Uptime monitoring script for Relationship Care Platform
# This script monitors system health and ensures >99.9% availability

set -e

# Configuration
APP_NAME="${APP_NAME:-relationship-care-platform}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-https://your-domain.com/api/health}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
CHECK_INTERVAL=30  # seconds
LOG_FILE="/var/log/uptime-monitor.log"
METRICS_FILE="/tmp/uptime-metrics.json"
ALERT_THRESHOLD=3  # consecutive failures before alerting

# Counters
TOTAL_CHECKS=0
SUCCESSFUL_CHECKS=0
FAILED_CHECKS=0
CONSECUTIVE_FAILURES=0

# Function to log messages
log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Function to send alert
send_alert() {
    local severity=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Send SNS notification
    if [ -n "$SNS_TOPIC_ARN" ] && command -v aws &> /dev/null; then
        aws sns publish \
            --topic-arn "$SNS_TOPIC_ARN" \
            --subject "[$severity] Uptime Alert - $APP_NAME" \
            --message "$message - $timestamp" > /dev/null 2>&1 || true
    fi
    
    # Send email alert (if configured)
    if [ -n "$ALERT_EMAIL" ] && command -v mail &> /dev/null; then
        echo "$message - $timestamp" | mail -s "[$severity] Uptime Alert - $APP_NAME" "$ALERT_EMAIL" || true
    fi
    
    # Send Slack notification (if configured)
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"[$severity] $APP_NAME: $message - $timestamp\"}" \
            "$SLACK_WEBHOOK_URL" > /dev/null 2>&1 || true
    fi
    
    log "ALERT" "$severity: $message"
}

# Function to update metrics
update_metrics() {
    local status=$1
    local response_time=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    
    if [ "$status" = "SUCCESS" ]; then
        SUCCESSFUL_CHECKS=$((SUCCESSFUL_CHECKS + 1))
        CONSECUTIVE_FAILURES=0
    else
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    fi
    
    # Calculate uptime percentage
    local uptime_percentage=$(echo "scale=4; $SUCCESSFUL_CHECKS * 100 / $TOTAL_CHECKS" | bc -l)
    
    # Create metrics JSON
    cat > "$METRICS_FILE" << EOF
{
    "timestamp": "$timestamp",
    "total_checks": $TOTAL_CHECKS,
    "successful_checks": $SUCCESSFUL_CHECKS,
    "failed_checks": $FAILED_CHECKS,
    "consecutive_failures": $CONSECUTIVE_FAILURES,
    "uptime_percentage": $uptime_percentage,
    "last_response_time": $response_time,
    "status": "$status"
}
EOF
    
    # Send metrics to CloudWatch (if configured)
    if command -v aws &> /dev/null && [ -n "$AWS_REGION" ]; then
        aws cloudwatch put-metric-data \
            --region "$AWS_REGION" \
            --namespace "Custom/$APP_NAME" \
            --metric-data \
                MetricName=UptimePercentage,Value=$uptime_percentage,Unit=Percent \
                MetricName=ResponseTime,Value=$response_time,Unit=Milliseconds \
                MetricName=ConsecutiveFailures,Value=$CONSECUTIVE_FAILURES,Unit=Count \
            > /dev/null 2>&1 || true
    fi
}

# Function to check application health
check_application_health() {
    local start_time=$(date +%s%3N)
    local status="FAILED"
    local response_time=0
    
    # Perform HTTP health check
    if curl -f -s -m 10 "$HEALTH_CHECK_URL" > /dev/null 2>&1; then
        local end_time=$(date +%s%3N)
        response_time=$((end_time - start_time))
        status="SUCCESS"
        log "INFO" "Application health check passed (${response_time}ms)"
    else
        log "ERROR" "Application health check failed"
    fi
    
    update_metrics "$status" "$response_time"
    
    # Check if we need to send alerts
    if [ $CONSECUTIVE_FAILURES -ge $ALERT_THRESHOLD ]; then
        send_alert "CRITICAL" "Application health check failed $CONSECUTIVE_FAILURES consecutive times"
    fi
    
    return $([ "$status" = "SUCCESS" ] && echo 0 || echo 1)
}

# Function to check Redis health
check_redis_health() {
    if command -v redis-cli &> /dev/null; then
        if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping > /dev/null 2>&1; then
            log "INFO" "Redis health check passed"
            return 0
        else
            log "ERROR" "Redis health check failed"
            send_alert "WARNING" "Redis is not responding"
            return 1
        fi
    else
        log "WARNING" "redis-cli not available, skipping Redis health check"
        return 0
    fi
}

# Function to check database connectivity
check_database_health() {
    if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then
        # Simple connectivity test to Supabase
        local response=$(curl -s -w "%{http_code}" -o /dev/null \
            -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
            -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
            "$SUPABASE_URL/rest/v1/" 2>/dev/null || echo "000")
        
        if [ "$response" = "200" ]; then
            log "INFO" "Database health check passed"
            return 0
        else
            log "ERROR" "Database health check failed (HTTP $response)"
            send_alert "WARNING" "Database connectivity issues detected"
            return 1
        fi
    else
        log "WARNING" "Database credentials not configured, skipping database health check"
        return 0
    fi
}

# Function to check disk space
check_disk_space() {
    local usage=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    if [ "$usage" -gt 90 ]; then
        log "ERROR" "Disk usage is at ${usage}%"
        send_alert "CRITICAL" "Disk usage is critically high at ${usage}%"
        return 1
    elif [ "$usage" -gt 80 ]; then
        log "WARNING" "Disk usage is at ${usage}%"
        send_alert "WARNING" "Disk usage is high at ${usage}%"
        return 1
    else
        log "INFO" "Disk usage is at ${usage}%"
        return 0
    fi
}

# Function to check memory usage
check_memory_usage() {
    local memory_usage=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    
    if [ "$memory_usage" -gt 90 ]; then
        log "ERROR" "Memory usage is at ${memory_usage}%"
        send_alert "CRITICAL" "Memory usage is critically high at ${memory_usage}%"
        return 1
    elif [ "$memory_usage" -gt 80 ]; then
        log "WARNING" "Memory usage is at ${memory_usage}%"
        send_alert "WARNING" "Memory usage is high at ${memory_usage}%"
        return 1
    else
        log "INFO" "Memory usage is at ${memory_usage}%"
        return 0
    fi
}

# Function to check SSL certificate expiration
check_ssl_certificate() {
    local domain=$(echo "$HEALTH_CHECK_URL" | sed -e 's|^https\?://||' -e 's|/.*||')
    
    if [ -n "$domain" ]; then
        local expiry_date=$(echo | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null | \
                           openssl x509 -noout -dates | grep notAfter | cut -d= -f2)
        
        if [ -n "$expiry_date" ]; then
            local expiry_timestamp=$(date -d "$expiry_date" +%s)
            local current_timestamp=$(date +%s)
            local days_until_expiry=$(( (expiry_timestamp - current_timestamp) / 86400 ))
            
            if [ $days_until_expiry -lt 7 ]; then
                log "ERROR" "SSL certificate expires in $days_until_expiry days"
                send_alert "CRITICAL" "SSL certificate expires in $days_until_expiry days"
                return 1
            elif [ $days_until_expiry -lt 30 ]; then
                log "WARNING" "SSL certificate expires in $days_until_expiry days"
                send_alert "WARNING" "SSL certificate expires in $days_until_expiry days"
                return 1
            else
                log "INFO" "SSL certificate is valid for $days_until_expiry days"
                return 0
            fi
        else
            log "WARNING" "Could not check SSL certificate expiration"
            return 0
        fi
    else
        log "WARNING" "No domain found for SSL certificate check"
        return 0
    fi
}

# Function to generate uptime report
generate_uptime_report() {
    local report_file="/tmp/uptime-report-$(date +%Y%m%d).txt"
    
    cat > "$report_file" << EOF
Uptime Monitoring Report - $(date)
=====================================

Application: $APP_NAME
Monitoring Period: Last 24 hours
Target Uptime: 99.9%

Current Statistics:
- Total Checks: $TOTAL_CHECKS
- Successful Checks: $SUCCESSFUL_CHECKS
- Failed Checks: $FAILED_CHECKS
- Current Uptime: $(echo "scale=4; $SUCCESSFUL_CHECKS * 100 / $TOTAL_CHECKS" | bc -l)%
- Consecutive Failures: $CONSECUTIVE_FAILURES

Health Check URL: $HEALTH_CHECK_URL
Last Check: $(date)

EOF
    
    # Add recent log entries
    echo "Recent Log Entries:" >> "$report_file"
    echo "==================" >> "$report_file"
    tail -20 "$LOG_FILE" >> "$report_file" 2>/dev/null || echo "No log entries available" >> "$report_file"
    
    log "INFO" "Uptime report generated: $report_file"
    
    # Email report if configured
    if [ -n "$REPORT_EMAIL" ] && command -v mail &> /dev/null; then
        mail -s "Daily Uptime Report - $APP_NAME" "$REPORT_EMAIL" < "$report_file" || true
    fi
}

# Function to perform comprehensive health check
perform_health_check() {
    log "INFO" "Starting comprehensive health check"
    
    local overall_status="SUCCESS"
    
    # Check application health
    if ! check_application_health; then
        overall_status="FAILED"
    fi
    
    # Check Redis health
    if ! check_redis_health; then
        overall_status="FAILED"
    fi
    
    # Check database health
    if ! check_database_health; then
        overall_status="FAILED"
    fi
    
    # Check system resources
    check_disk_space
    check_memory_usage
    
    # Check SSL certificate
    check_ssl_certificate
    
    if [ "$overall_status" = "SUCCESS" ]; then
        log "INFO" "All health checks passed"
    else
        log "ERROR" "Some health checks failed"
    fi
    
    return $([ "$overall_status" = "SUCCESS" ] && echo 0 || echo 1)
}

# Function to run monitoring loop
run_monitoring_loop() {
    log "INFO" "Starting uptime monitoring for $APP_NAME"
    log "INFO" "Health check URL: $HEALTH_CHECK_URL"
    log "INFO" "Check interval: ${CHECK_INTERVAL}s"
    
    # Generate initial report
    generate_uptime_report
    
    while true; do
        perform_health_check
        
        # Generate daily report at midnight
        local current_hour=$(date +%H)
        local current_minute=$(date +%M)
        if [ "$current_hour" = "00" ] && [ "$current_minute" = "00" ]; then
            generate_uptime_report
        fi
        
        sleep $CHECK_INTERVAL
    done
}

# Function to show current status
show_status() {
    if [ -f "$METRICS_FILE" ]; then
        echo "Current Uptime Status:"
        echo "====================="
        cat "$METRICS_FILE" | jq -r '
            "Timestamp: " + .timestamp,
            "Total Checks: " + (.total_checks | tostring),
            "Successful Checks: " + (.successful_checks | tostring),
            "Failed Checks: " + (.failed_checks | tostring),
            "Uptime Percentage: " + (.uptime_percentage | tostring) + "%",
            "Last Response Time: " + (.last_response_time | tostring) + "ms",
            "Status: " + .status,
            "Consecutive Failures: " + (.consecutive_failures | tostring)
        '
    else
        echo "No metrics available yet"
    fi
}

# Main function
main() {
    case "${1:-monitor}" in
        "monitor")
            run_monitoring_loop
            ;;
        "check")
            perform_health_check
            ;;
        "status")
            show_status
            ;;
        "report")
            generate_uptime_report
            ;;
        *)
            echo "Usage: $0 [monitor|check|status|report]"
            echo "  monitor - Run continuous monitoring (default)"
            echo "  check   - Perform single health check"
            echo "  status  - Show current status"
            echo "  report  - Generate uptime report"
            exit 1
            ;;
    esac
}

# Create log file if it doesn't exist
touch "$LOG_FILE"

# Install bc if not available (for calculations)
if ! command -v bc &> /dev/null; then
    log "WARNING" "bc not found, installing..."
    if command -v apt-get &> /dev/null; then
        apt-get update && apt-get install -y bc
    elif command -v yum &> /dev/null; then
        yum install -y bc
    fi
fi

# Run main function
main "$@"